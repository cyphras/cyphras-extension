// Background CCTP processor: reconciliation, attestation polling, mint submission
// and reattest/re-arm. Each pass scans every account+network's jobs, not just the
// active one, and steps that need no signing key run while locked.
// It never submits a burn; burns are foreground-only (burn.ts).
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import {
  CCTP_MINT_GAS_LIMIT_CEILING,
  CCTP_MINT_MAX_FEE_PER_GAS_CEILING,
  CCTP_MINT_MAX_PRIORITY_FEE_PER_GAS_CEILING,
  cctpAnchorsForEnv,
  cctpProxyBase,
} from '../../constants/cctp'
import {
  bytesEqual,
  decodeCctpMessage,
  decodeHookData,
  encodeReceiveMessage,
  encodeUsedNoncesCall,
  evmAddressToBytes32,
  evmTxHash,
  stellarContractIdToBytes32,
  usedNoncesResultIsUsed,
} from './encoding'
import {
  CCTP_DOMAIN_ETHEREUM,
  CCTP_DOMAIN_STELLAR,
  decimalToBaseUnits,
  evmRpcCall,
  fetchEvmReceipt,
  sorobanRpcCall,
  submitStellarInvoke,
  type CctpEnv,
  type CctpReadEnv,
} from './burn'
import {
  CCTP_TERMINAL_STATUSES,
  listAllCctpJobKeys,
  listCctpJobs,
  parseCctpJobsKey,
  patchCctpJob,
  withCctpAccountLock,
  cctpAccountLockKey,
  type CctpJob,
} from './store'
import { evmAddressFromPrivateKey, signEip1559 } from '../signers/evm'

// Indexer-lag margin: a Stellar tx cannot still be pending once its validity
// window plus this has elapsed.
const STELLAR_INDEXER_MARGIN_MS = 150_000
// Long enough for an EVM tx to sit unmined through a base-fee spike.
const EVM_MINT_REARM_MS = 10 * 60 * 1000
// Under the ~24h attestation expiry; past that a reattest is needed anyway.
const MINT_WALLCLOCK_CAP_MS = 20 * 60 * 60 * 1000
const MAX_MINT_ATTEMPTS = 5
// Conservative preflight floors, not simulations (the mint's args do not exist
// until attested): enough to tell "cannot succeed" from "might work".
const STELLAR_MINT_FEE_FLOOR_STROOPS = 5_000_000n // 0.5 XLM
const STELLAR_BASE_RESERVE_STROOPS = 5_000_000n // 0.5 XLM per reserve unit
const EVM_MINT_GAS_FLOOR_WEI = 2_000_000_000_000_000n // 0.002 ETH

export interface CctpProcessorDeps {
  isUnlocked: () => Promise<boolean>
  // Keys for the job's account, not the active one. Null when locked or when that
  // account's mnemonic is not decrypted this session; the job then stays parked.
  buildSigningEnv: (networkId: string, stellarPk: string) => Promise<CctpEnv | null>
}

function buildReadEnv(
  networkId: string,
  horizonUrl: string,
  sorobanRpcUrl: string,
  passphrase: string,
  txTimeout: number
): CctpReadEnv | null {
  const anchors = cctpAnchorsForEnv(networkId)
  if (!anchors) return null
  return {
    networkId,
    horizonUrl,
    sorobanRpcUrl,
    passphrase,
    txTimeout,
    evmRpcUrl: `https://api.cyphras.com/evm/eip155:${anchors.evm.chainId}/rpc`,
    evmChainId: anchors.evm.chainId,
    anchors,
  }
}

export async function runCctpProcessorPass(
  deps: CctpProcessorDeps,
  networkConfigs: Map<
    string,
    { horizonUrl: string; sorobanRpcUrl: string; passphrase: string; txTimeout: number }
  >
): Promise<void> {
  const keys = await listAllCctpJobKeys()
  for (const key of keys) {
    const parsed = parseCctpJobsKey(key)
    if (!parsed) continue
    const netCfg = networkConfigs.get(parsed.networkId)
    if (!netCfg) continue // custom network, no shipped Stellar RPC config to poll with
    const readEnv = buildReadEnv(
      parsed.networkId,
      netCfg.horizonUrl,
      netCfg.sorobanRpcUrl,
      netCfg.passphrase,
      netCfg.txTimeout
    )
    if (!readEnv) continue // no CCTP anchors for this network
    try {
      await processAccountJobs(parsed.networkId, parsed.stellarPk, readEnv, deps)
    } catch (e) {
      // One account's failure must not abort the pass for every other account.
      console.error('cctp: processor account pass failed', parsed.networkId, parsed.stellarPk, e)
    }
  }
}

async function processAccountJobs(
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv,
  deps: CctpProcessorDeps
): Promise<void> {
  const snapshot = await listCctpJobs(networkId, stellarPk)
  const activeIds = snapshot
    .filter((j) => !CCTP_TERMINAL_STATUSES.includes(j.status))
    .map((j) => j.id)
  for (const jobId of activeIds) {
    await withCctpAccountLock(cctpAccountLockKey(networkId, stellarPk), async () => {
      try {
        const jobs = await listCctpJobs(networkId, stellarPk)
        const job = jobs.find((j) => j.id === jobId)
        if (!job || CCTP_TERMINAL_STATUSES.includes(job.status)) return // resolved by a concurrent op already
        await processOneJob(job, networkId, stellarPk, readEnv, deps)
      } catch (e) {
        // Leave the job untouched for the next pass; one job's transient failure
        // (including the re-read above) must not skip the account's other jobs.
        console.error('cctp: processor step failed', jobId, e)
      }
    })
  }
}

async function processOneJob(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv,
  deps: CctpProcessorDeps
): Promise<void> {
  switch (job.status) {
    case 'created':
    case 'approving':
      return processCreatedOrApproving(job, networkId, stellarPk, readEnv)
    case 'burn_submitted':
      return processBurnSubmitted(job, networkId, stellarPk, readEnv)
    case 'burned':
      return processBurned(job, networkId, stellarPk, readEnv)
    case 'attested':
    case 'blocked_trustline':
    case 'blocked_gas':
      return processAttested(job, networkId, stellarPk, readEnv, deps)
    case 'mint_submitted':
      return processMintSubmitted(job, networkId, stellarPk, readEnv)
  }
}

type TxOutcome = 'confirmed' | 'reverted' | 'pending'

async function checkEvmTxByHash(readEnv: CctpReadEnv, hash: string): Promise<TxOutcome> {
  const receipt = await fetchEvmReceipt(readEnv.evmRpcUrl, hash)
  if (!receipt) return 'pending'
  return receipt.status === '0x1' ? 'confirmed' : 'reverted'
}

async function evmNonceHasPassed(
  readEnv: CctpReadEnv,
  address: string,
  nonce: number
): Promise<boolean> {
  const currentHex = await evmRpcCall(readEnv.evmRpcUrl, 'eth_getTransactionCount', [
    address,
    'latest',
  ])
  return Number(BigInt(currentHex)) > nonce
}

async function checkStellarTxByHash(readEnv: CctpReadEnv, hash: string): Promise<TxOutcome> {
  const result = await sorobanRpcCall<{ status: string }>(readEnv.sorobanRpcUrl, 'getTransaction', {
    hash,
  })
  if (result.status === 'SUCCESS') return 'confirmed'
  if (result.status === 'FAILED') return 'reverted'
  return 'pending'
}

async function checkStellarTxViaHorizon(
  readEnv: CctpReadEnv,
  hash: string
): Promise<TxOutcome | 'not_found'> {
  const res = await fetch(`${readEnv.horizonUrl}/transactions/${hash}`)
  if (res.status === 404) return 'not_found'
  if (!res.ok) return 'not_found'
  const data = (await res.json()) as { successful: boolean }
  return data.successful ? 'confirmed' : 'reverted'
}

function stellarTxDefinitivelyExpired(broadcastAt: number | undefined, txTimeout: number): boolean {
  if (broadcastAt == null) return false
  const reArmAfterMs = txTimeout * 1000 + STELLAR_INDEXER_MARGIN_MS
  return Date.now() - broadcastAt >= reArmAfterMs
}

// Receipts carry no revert reason, so replay the same call at the block the tx
// was mined in to recover it.
async function evmRevertReason(
  readEnv: CctpReadEnv,
  hash: string,
  to: string,
  dataHex: string,
  from: string
): Promise<string> {
  const receipt = await fetchEvmReceipt(readEnv.evmRpcUrl, hash)
  if (!receipt?.blockNumber) return ''
  try {
    await evmRpcCall(readEnv.evmRpcUrl, 'eth_call', [
      { from, to, data: dataHex },
      receipt.blockNumber,
    ])
    return '' // replay did not revert (race or transient); treat as unknown
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Stellar has no eth_call-style replay; Horizon's result_codes are the best
// signal short of parsing XDR diagnostic events.
async function stellarFailureResultCodes(readEnv: CctpReadEnv, hash: string): Promise<string> {
  const res = await fetch(`${readEnv.horizonUrl}/transactions/${hash}`)
  if (!res.ok) return ''
  const data = (await res.json()) as {
    result_codes?: { transaction?: string; operations?: string[] }
  }
  return JSON.stringify(data.result_codes ?? {})
}

interface IrisMessageResult {
  found: boolean
  complete: boolean
  message?: string
  attestation?: string
  delayReason?: string
  // What POST /reattest/{nonce} expects; not the message body's 32-byte nonce.
  eventNonce?: string
}

async function checkBurnViaIris(
  readEnv: CctpReadEnv,
  srcDomain: number,
  txHash: string
): Promise<IrisMessageResult> {
  const base = cctpProxyBase(readEnv.networkId as 'mainnet' | 'testnet')
  const res = await fetch(`${base}/messages/${srcDomain}?transactionHash=${txHash}`)
  if (!res.ok) return { found: false, complete: false }
  const data = (await res.json()) as {
    messages?: {
      status: string
      message?: string
      attestation?: string | null
      delayReason?: string | null
      eventNonce?: string
    }[]
  }
  const msg = data.messages?.[0]
  if (!msg) return { found: false, complete: false }
  return {
    found: true,
    complete: msg.status === 'complete',
    message: msg.message,
    attestation: msg.attestation && msg.attestation !== 'PENDING' ? msg.attestation : undefined,
    delayReason: msg.delayReason ?? undefined,
    eventNonce: msg.eventNonce,
  }
}

async function processCreatedOrApproving(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv
): Promise<void> {
  // The hash is persisted before broadcast, so without one nothing reached the chain.
  if (!job.approveTxHash) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'bridge was never submitted',
    })
    return
  }

  const isStellarSource = job.direction === 'stellar-to-evm'
  const outcome = isStellarSource
    ? await checkStellarTxByHash(readEnv, job.approveTxHash)
    : await checkEvmTxByHash(readEnv, job.approveTxHash)

  if (outcome === 'reverted') {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'approve failed on-chain',
    })
    return
  }
  if (outcome === 'confirmed') {
    // Approved but not burned: stays at 'approving' so a foreground Retry can
    // burn with the live allowance, since the processor never burns.
    return
  }

  // Pending. EVM: nonce past preBurnNonce with no receipt for this hash means
  // another tx took the slot. Stellar: same expiry rule as burn_submitted.
  if (isStellarSource) {
    if (stellarTxDefinitivelyExpired(job.approveBroadcastAt, readEnv.txTimeout)) {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'failed',
        lastError: 'approve tx expired without inclusion',
      })
    }
    return
  }
  if (
    job.preBurnNonce != null &&
    (await evmNonceHasPassed(readEnv, job.sourceAddress, job.preBurnNonce))
  ) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'approve tx superseded by a later transaction',
    })
    return
  }
  // Nonce unchanged: never broadcast, or still pending (EVM txs do not expire).
  // Bound the wait anyway, or a never-broadcast approve would hold this
  // direction's one-active-job guard forever with no path to Retry.
  const broadcastAt = job.approveBroadcastAt ?? job.createdAt
  if (Date.now() - broadcastAt >= EVM_MINT_REARM_MS) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'approve did not confirm and the nonce never advanced; likely never broadcast',
    })
  }
}

// Runs before anything is signed from an Iris-returned message, so a compromised
// Iris or proxy can only attest this job's own burn, never substitute another.
function validateCctpMessageAgainstJob(
  job: CctpJob,
  messageHex: string,
  readEnv: CctpReadEnv
): { valid: true } | { valid: false; reason: string } {
  let decoded: ReturnType<typeof decodeCctpMessage>
  try {
    decoded = decodeCctpMessage(messageHex)
  } catch (e) {
    return {
      valid: false,
      reason: `message decode failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const isStellarSource = job.direction === 'stellar-to-evm'
  const expectedSrcDomain = isStellarSource ? CCTP_DOMAIN_STELLAR : CCTP_DOMAIN_ETHEREUM
  const expectedDstDomain = isStellarSource ? CCTP_DOMAIN_ETHEREUM : CCTP_DOMAIN_STELLAR
  if (decoded.sourceDomain !== expectedSrcDomain)
    return { valid: false, reason: 'wrong sourceDomain' }
  if (decoded.destinationDomain !== expectedDstDomain)
    return { valid: false, reason: 'wrong destinationDomain' }

  if (isStellarSource) {
    const expectedBurnToken = stellarContractIdToBytes32(readEnv.anchors.stellar.usdcSac)
    if (!bytesEqual(decoded.body.burnToken, expectedBurnToken)) {
      return { valid: false, reason: 'wrong burnToken' }
    }
    const expectedMintRecipient = evmAddressToBytes32(job.destAddress)
    if (!bytesEqual(decoded.body.mintRecipient, expectedMintRecipient)) {
      return { valid: false, reason: 'wrong mintRecipient' }
    }
  } else {
    const expectedBurnToken = evmAddressToBytes32(readEnv.anchors.evm.usdc)
    if (!bytesEqual(decoded.body.burnToken, expectedBurnToken)) {
      return { valid: false, reason: 'wrong burnToken' }
    }
    const expectedForwarder = stellarContractIdToBytes32(readEnv.anchors.stellar.cctpForwarder)
    if (!bytesEqual(decoded.body.mintRecipient, expectedForwarder)) {
      return { valid: false, reason: 'mintRecipient is not the CctpForwarder' }
    }
    let hook: ReturnType<typeof decodeHookData>
    try {
      hook = decodeHookData(decoded.body.hookData)
    } catch (e) {
      return {
        valid: false,
        reason: `hook decode failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    if (hook.forwardRecipient !== job.destAddress) {
      return { valid: false, reason: 'hook forwardRecipient does not match job destination' }
    }
  }

  // The message amount is 6-decimal whatever the source chain, as is job.amount.
  const expectedAmount = decimalToBaseUnits(job.amount, 6)
  if (decoded.body.amount !== expectedAmount) return { valid: false, reason: 'wrong amount' }

  return { valid: true }
}

async function processBurnSubmitted(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv
): Promise<void> {
  const isStellarSource = job.direction === 'stellar-to-evm'
  const hash = job.burnTxHash
  if (!hash) return // unreachable per store invariants, but never guess
  const srcDomain = isStellarSource ? CCTP_DOMAIN_STELLAR : CCTP_DOMAIN_ETHEREUM

  const chainOutcome = isStellarSource
    ? await checkStellarTxByHash(readEnv, hash)
    : await checkEvmTxByHash(readEnv, hash)

  if (chainOutcome === 'confirmed') {
    await patchCctpJob(networkId, stellarPk, job.id, { status: 'burned' })
    return
  }
  if (chainOutcome === 'reverted') {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'burn tx failed on-chain; funds never left',
    })
    return
  }

  // Source RPC retention is bounded, so a missing tx proves nothing; Iris
  // independently shows whether the burn landed.
  const iris = await checkBurnViaIris(readEnv, srcDomain, hash).catch(
    () => ({ found: false, complete: false }) as const
  )
  if (iris.found) {
    if (iris.complete && iris.message && iris.attestation) {
      const validation = validateCctpMessageAgainstJob(job, iris.message, readEnv)
      if (!validation.valid) {
        await patchCctpJob(networkId, stellarPk, job.id, {
          status: 'failed',
          lastError: `message validation failed: ${validation.reason}`,
        })
        return
      }
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'attested',
        message: iris.message,
        attestation: iris.attestation,
        eventNonce: iris.eventNonce,
        attestedAt: Date.now(),
      })
    } else {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'burned',
        lastError: iris.delayReason,
      })
    }
    return
  }

  if (isStellarSource) {
    const horizon = await checkStellarTxViaHorizon(readEnv, hash).catch(() => 'not_found' as const)
    if (horizon === 'confirmed') {
      await patchCctpJob(networkId, stellarPk, job.id, { status: 'burned' })
      return
    }
    if (horizon === 'reverted') {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'failed',
        lastError: 'burn tx failed on-chain; funds never left',
      })
      return
    }
    if (stellarTxDefinitivelyExpired(job.burnBroadcastAt, readEnv.txTimeout)) {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'failed',
        lastError: 'burn tx expired without inclusion; funds never left',
      })
    }
    return
  }

  // EVM txs never expire, so only a superseded nonce proves the burn is dead. But
  // this burn landing also advances the nonce, possibly after the checks above.
  // Recheck the receipt, then Iris, before failing: a wrong "superseded" would
  // terminalize a landed burn and it would never be minted.
  if (
    job.burnNonce != null &&
    (await evmNonceHasPassed(readEnv, job.sourceAddress, job.burnNonce))
  ) {
    const recheck = await checkEvmTxByHash(readEnv, hash)
    if (recheck === 'confirmed') {
      await patchCctpJob(networkId, stellarPk, job.id, { status: 'burned' })
      return
    }
    if (recheck === 'reverted') {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'failed',
        lastError: 'burn tx failed on-chain; funds never left',
      })
      return
    }
    const irisRecheck = await checkBurnViaIris(readEnv, srcDomain, hash).catch(
      () => ({ found: false }) as const
    )
    if (irisRecheck.found) {
      // Iris proves the burn landed; the next pass's iris.found branch takes over.
      await patchCctpJob(networkId, stellarPk, job.id, { status: 'burn_submitted' })
      return
    }
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: 'burn tx superseded by a later transaction; funds never left',
    })
  }
}

async function processBurned(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv
): Promise<void> {
  const isStellarSource = job.direction === 'stellar-to-evm'
  const srcDomain = isStellarSource ? CCTP_DOMAIN_STELLAR : CCTP_DOMAIN_ETHEREUM
  const hash = job.burnTxHash
  if (!hash) return

  const iris = await checkBurnViaIris(readEnv, srcDomain, hash)
  if (!iris.found || !iris.complete || !iris.message || !iris.attestation) {
    if (iris.delayReason && iris.delayReason !== job.lastError) {
      await patchCctpJob(networkId, stellarPk, job.id, { lastError: iris.delayReason })
    }
    return
  }

  const validation = validateCctpMessageAgainstJob(job, iris.message, readEnv)
  if (!validation.valid) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError: `message validation failed: ${validation.reason}`,
    })
    return
  }
  await patchCctpJob(networkId, stellarPk, job.id, {
    status: 'attested',
    message: iris.message,
    attestation: iris.attestation,
    eventNonce: iris.eventNonce,
    attestedAt: Date.now(),
  })
}

async function isEvmNonceUsed(
  readEnv: CctpReadEnv,
  messageTransmitter: string,
  nonce: Uint8Array
): Promise<boolean> {
  const data = `0x${Buffer.from(encodeUsedNoncesCall(nonce)).toString('hex')}`
  const result = await evmRpcCall(readEnv.evmRpcUrl, 'eth_call', [
    { to: messageTransmitter, data },
    'latest',
  ])
  return usedNoncesResultIsUsed(result)
}

const STELLAR_SIM_SOURCE = Keypair.random().publicKey()

async function isStellarNonceUsed(
  readEnv: CctpReadEnv,
  messageTransmitter: string,
  nonce: Uint8Array
): Promise<boolean> {
  const source = new Account(STELLAR_SIM_SOURCE, '0')
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: readEnv.passphrase,
  })
    .addOperation(
      new Contract(messageTransmitter).call(
        'is_nonce_used',
        nativeToScVal(Buffer.from(nonce), { type: 'bytes' })
      )
    )
    .setTimeout(30)
    .build()
  // Raw JSON-RPC returns the value at results[0].xdr; `retval` exists only in the
  // SDK's Server.simulateTransaction() wrapper, which this call bypasses.
  const sim = await sorobanRpcCall<{ error?: string; results?: { xdr: string }[] }>(
    readEnv.sorobanRpcUrl,
    'simulateTransaction',
    { transaction: tx.toEnvelope().toXDR('base64') }
  )
  if (sim.error) throw new Error(sim.error)
  const retvalXdr = sim.results?.[0]?.xdr
  if (!retvalXdr) throw new Error('is_nonce_used simulate returned no result')
  return Boolean(scValToNative(xdr.ScVal.fromXDR(retvalXdr, 'base64')))
}

async function stellarTrustlineReady(
  readEnv: CctpReadEnv,
  destAddress: string,
  amount6: string
): Promise<'ready' | 'no_account' | 'no_trustline' | 'insufficient_headroom'> {
  const res = await fetch(`${readEnv.horizonUrl}/accounts/${destAddress}`)
  if (res.status === 404) return 'no_account'
  if (!res.ok) throw new Error(`horizon account fetch failed: ${res.status}`)
  const data = (await res.json()) as {
    balances: { asset_code?: string; asset_issuer?: string; balance: string; limit?: string }[]
  }
  const asset = readEnv.anchors.stellar.usdcAsset
  const line = data.balances.find(
    (b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer
  )
  if (!line || line.limit === undefined) return 'no_trustline'
  const balance = decimalToBaseUnits(line.balance, 7)
  const limit = decimalToBaseUnits(line.limit, 7)
  const needed = decimalToBaseUnits(amount6, 7)
  return limit - balance < needed ? 'insufficient_headroom' : 'ready'
}

async function stellarMintFeeReady(readEnv: CctpReadEnv, address: string): Promise<boolean> {
  const res = await fetch(`${readEnv.horizonUrl}/accounts/${address}`)
  // Throw rather than return false: like evmGasReady, the caller fails this
  // preflight open on errors instead of blocking on a Horizon hiccup.
  if (!res.ok) throw new Error(`horizon account fetch failed: ${res.status}`)
  const data = (await res.json()) as {
    balances: { asset_type: string; balance: string }[]
    subentry_count: number
  }
  const native = data.balances.find((b) => b.asset_type === 'native')
  if (!native) return false
  const balance = decimalToBaseUnits(native.balance, 7)
  const reserve = (2n + BigInt(data.subentry_count)) * STELLAR_BASE_RESERVE_STROOPS
  return balance - reserve >= STELLAR_MINT_FEE_FLOOR_STROOPS
}

async function evmGasReady(readEnv: CctpReadEnv, address: string): Promise<boolean> {
  const hex = await evmRpcCall(readEnv.evmRpcUrl, 'eth_getBalance', [address, 'latest'])
  return BigInt(hex) >= EVM_MINT_GAS_FLOOR_WEI
}

// Gas is quoted once and those exact values are both ceiling-checked and signed;
// a second fetch would let a compromised proxy pass the check, then overcharge.
async function submitEvmMint(
  env: CctpEnv,
  networkId: string,
  stellarPk: string,
  job: CctpJob
): Promise<{ signed: true } | { signed: false; reason: 'ceiling' }> {
  const message = Buffer.from(job.message!.replace(/^0x/, ''), 'hex')
  const attestation = Buffer.from(job.attestation!.replace(/^0x/, ''), 'hex')
  const data = encodeReceiveMessage(message, attestation)
  const from = evmAddressFromPrivateKey(env.evmPrivateKey)
  const dataHex = `0x${Buffer.from(data).toString('hex')}`

  const [nonceHex, prioHex, gasPriceHex, gasLimitHex] = await Promise.all([
    evmRpcCall(env.evmRpcUrl, 'eth_getTransactionCount', [from, 'pending']),
    evmRpcCall(env.evmRpcUrl, 'eth_maxPriorityFeePerGas', []).catch(() => '0x59682f00'),
    evmRpcCall(env.evmRpcUrl, 'eth_gasPrice', []),
    evmRpcCall(env.evmRpcUrl, 'eth_estimateGas', [
      { from, to: env.anchors.evm.messageTransmitterV2, value: '0x0', data: dataHex },
    ]),
  ])
  const maxPriorityFeePerGas = BigInt(prioHex)
  const maxFeePerGas = BigInt(gasPriceHex) * 2n + maxPriorityFeePerGas
  const gasLimit = (BigInt(gasLimitHex) * 12n) / 10n

  if (
    gasLimit > CCTP_MINT_GAS_LIMIT_CEILING ||
    maxFeePerGas > CCTP_MINT_MAX_FEE_PER_GAS_CEILING ||
    maxPriorityFeePerGas > CCTP_MINT_MAX_PRIORITY_FEE_PER_GAS_CEILING
  ) {
    return { signed: false, reason: 'ceiling' }
  }

  const raw = signEip1559(
    {
      chainId: BigInt(env.evmChainId),
      nonce: BigInt(nonceHex),
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to: env.anchors.evm.messageTransmitterV2,
      value: 0n,
      data,
    },
    env.evmPrivateKey
  )
  const hash = evmTxHash(raw)
  await patchCctpJob(networkId, stellarPk, job.id, {
    status: 'mint_submitted',
    mintTxHash: hash,
    mintBroadcastAt: Date.now(),
  })
  const sentHash = await evmRpcCall(env.evmRpcUrl, 'eth_sendRawTransaction', [raw])
  if (sentHash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error('evm node returned an unexpected tx hash for the mint tx')
  }
  return { signed: true }
}

async function submitStellarMint(
  env: CctpEnv,
  networkId: string,
  stellarPk: string,
  job: CctpJob
): Promise<void> {
  const message = Buffer.from(job.message!.replace(/^0x/, ''), 'hex')
  const attestation = Buffer.from(job.attestation!.replace(/^0x/, ''), 'hex')
  await submitStellarInvoke(
    env,
    env.anchors.stellar.cctpForwarder,
    'mint_and_forward',
    [nativeToScVal(message, { type: 'bytes' }), nativeToScVal(attestation, { type: 'bytes' })],
    (hash) =>
      patchCctpJob(networkId, stellarPk, job.id, {
        status: 'mint_submitted',
        mintTxHash: hash,
        mintBroadcastAt: Date.now(),
      }).then(() => undefined)
  )
}

async function processAttested(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv,
  deps: CctpProcessorDeps
): Promise<void> {
  if (!job.message || !job.attestation) return // shouldn't happen; wait for a fresh burned->attested transition

  const isStellarDest = job.direction === 'evm-to-stellar'

  // Recheck every attempt: destination trustline and gas can change after the burn.
  if (isStellarDest) {
    const trustline = await stellarTrustlineReady(readEnv, job.destAddress, job.amount)
    if (trustline !== 'ready') {
      if (job.status !== 'blocked_trustline') {
        await patchCctpJob(networkId, stellarPk, job.id, {
          status: 'blocked_trustline',
          lastError: trustline,
        })
      }
      return
    }
    const feeReady = await stellarMintFeeReady(readEnv, job.destAddress).catch(() => true)
    if (!feeReady) {
      if (job.status !== 'blocked_gas') {
        await patchCctpJob(networkId, stellarPk, job.id, {
          status: 'blocked_gas',
          lastError: 'destination needs more XLM for the mint fee',
        })
      }
      return
    }
  } else {
    const gasReady = await evmGasReady(readEnv, job.destAddress).catch(() => true)
    if (!gasReady) {
      if (job.status !== 'blocked_gas') {
        await patchCctpJob(networkId, stellarPk, job.id, {
          status: 'blocked_gas',
          lastError: 'destination needs more ETH for gas',
        })
      }
      return
    }
  }
  if (job.status !== 'attested') {
    await patchCctpJob(networkId, stellarPk, job.id, { status: 'attested', lastError: undefined })
  }

  // Ground truth before signing: an earlier attempt may already have minted.
  const decoded = decodeCctpMessage(job.message)
  const messageTransmitter = isStellarDest
    ? readEnv.anchors.stellar.messageTransmitter
    : readEnv.anchors.evm.messageTransmitterV2
  const used = isStellarDest
    ? await isStellarNonceUsed(readEnv, messageTransmitter, decoded.nonce)
    : await isEvmNonceUsed(readEnv, messageTransmitter, decoded.nonce)
  if (used) {
    await patchCctpJob(networkId, stellarPk, job.id, { status: 'done' })
    return
  }

  if (!(await deps.isUnlocked())) return
  const env = await deps.buildSigningEnv(networkId, stellarPk)
  if (!env) return // this account's key isn't available this session; stay parked

  if (isStellarDest) {
    await submitStellarMint(env, networkId, stellarPk, job)
    return
  }

  const result = await submitEvmMint(env, networkId, stellarPk, job)
  if (!result.signed) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      lastError: 'network fee too high, retrying later',
    })
  }
}

async function reattestAndRewind(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv
): Promise<void> {
  // Without an eventNonce there is nothing to reattest with; rewinding to
  // 'burned' still keeps re-polling the messages lookup.
  if (job.eventNonce) {
    const base = cctpProxyBase(readEnv.networkId as 'mainnet' | 'testnet')
    await fetch(`${base}/reattest/${job.eventNonce}`, { method: 'POST' }).catch(() => undefined)
  }
  await patchCctpJob(networkId, stellarPk, job.id, {
    status: 'burned',
    message: undefined,
    attestation: undefined,
    lastError: 'attestation expired; re-attesting',
  })
}

async function processMintSubmitted(
  job: CctpJob,
  networkId: string,
  stellarPk: string,
  readEnv: CctpReadEnv
): Promise<void> {
  const isStellarDest = job.direction === 'evm-to-stellar'
  const hash = job.mintTxHash
  if (!hash) return

  const outcome = isStellarDest
    ? await checkStellarTxByHash(readEnv, hash)
    : await checkEvmTxByHash(readEnv, hash)

  if (outcome === 'confirmed') {
    await patchCctpJob(networkId, stellarPk, job.id, { status: 'done' })
    return
  }

  if (outcome === 'reverted') {
    const decoded = decodeCctpMessage(job.message!)
    const messageTransmitter = isStellarDest
      ? readEnv.anchors.stellar.messageTransmitter
      : readEnv.anchors.evm.messageTransmitterV2
    const used = isStellarDest
      ? await isStellarNonceUsed(readEnv, messageTransmitter, decoded.nonce)
      : await isEvmNonceUsed(readEnv, messageTransmitter, decoded.nonce)
    if (used) {
      // This attempt lost a race to an earlier one that did mint.
      await patchCctpJob(networkId, stellarPk, job.id, { status: 'done' })
      return
    }

    // Use this revert's own reason, never job.lastError: a stale "expired" there
    // would loop reattest forever, paying gas for each doomed retry.
    let reasonText: string
    if (isStellarDest) {
      reasonText = await stellarFailureResultCodes(readEnv, hash).catch(() => '')
    } else {
      const message = Buffer.from(job.message!.replace(/^0x/, ''), 'hex')
      const attestation = Buffer.from(job.attestation!.replace(/^0x/, ''), 'hex')
      const dataHex = `0x${Buffer.from(encodeReceiveMessage(message, attestation)).toString('hex')}`
      reasonText = await evmRevertReason(
        readEnv,
        hash,
        readEnv.anchors.evm.messageTransmitterV2,
        dataHex,
        job.destAddress
      ).catch(() => '')
    }
    const lower = reasonText.toLowerCase()

    if (lower.includes('expired')) {
      await reattestAndRewind(job, networkId, stellarPk, readEnv)
      return
    }
    if (!isStellarDest && (lower.includes('paused') || lower.includes('denylist'))) {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'blocked_gas',
        lastError: reasonText,
      })
      return
    }
    if (
      isStellarDest &&
      (lower.includes('trustline') || lower.includes('underfunded') || lower.includes('no_trust'))
    ) {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'blocked_trustline',
        lastError: reasonText,
      })
      return
    }

    const attempts = job.attempts + 1
    if (attempts >= MAX_MINT_ATTEMPTS) {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'failed',
        attempts,
        lastError:
          reasonText ||
          'mint kept reverting; burned funds are still recoverable via reattest/manual completion',
      })
    } else {
      await patchCctpJob(networkId, stellarPk, job.id, {
        status: 'attested',
        attempts,
        lastError: reasonText || undefined,
      })
    }
    return
  }

  // Pending: re-arm after a bounded wait, or fail at the cap (Retry keeps the
  // burned funds recoverable). The cap counts from attestedAt, set once per
  // attestation; mintBroadcastAt resets on every re-arm and would never hit it.
  const attestedAt = job.attestedAt ?? job.mintBroadcastAt ?? job.createdAt
  const capAge = Date.now() - attestedAt
  if (capAge >= MINT_WALLCLOCK_CAP_MS) {
    await patchCctpJob(networkId, stellarPk, job.id, {
      status: 'failed',
      lastError:
        'mint did not confirm in time; burned funds are still recoverable via reattest/manual completion',
    })
    return
  }
  const broadcastAt = job.mintBroadcastAt ?? job.createdAt
  const age = Date.now() - broadcastAt
  const rearmMs = isStellarDest
    ? readEnv.txTimeout * 1000 + STELLAR_INDEXER_MARGIN_MS
    : EVM_MINT_REARM_MS
  if (age >= rearmMs) {
    // No answer is not an on-chain failure, so re-arm without counting an attempt;
    // the next pass re-quotes and rechecks nonce-used before resubmitting.
    await patchCctpJob(networkId, stellarPk, job.id, { status: 'attested' })
  }
}
