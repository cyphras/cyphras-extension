// Foreground-only CCTP burn submission, both directions. The background
// processor never submits a burn: an EVM tx has no validity window, so an
// automated resubmission can land alongside the original and burn twice.
// Each tx is signed and broadcast exactly once, with its hash persisted BEFORE
// the broadcast so a worker death mid-submit never leaves an untracked tx.
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Operation,
  rpc as SorobanRpc,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import type { CctpEnvAnchors } from '../../constants/cctp'
import { CCTP_FINALITY_FAST, CCTP_FINALITY_STANDARD } from '../../constants/cctp'
import {
  encodeDepositForBurnWithHook,
  encodeErc20Approve,
  encodeHookData,
  evmAddressToBytes32,
  evmTxHash,
  stellarContractIdToBytes32,
} from './encoding'
import { listCctpJobs, patchCctpJob, withCctpAccountLock, type CctpJob } from './store'
import { evmAddressFromPrivateKey, signEip1559 } from '../signers/evm'

export const CCTP_DOMAIN_ETHEREUM = 0
export const CCTP_DOMAIN_STELLAR = 27

function finalityThresholdFor(job: CctpJob): number {
  return job.speed === 'fast' ? CCTP_FINALITY_FAST : CCTP_FINALITY_STANDARD
}
// Ledgers until the Stellar approve allowance expires: enough to cover
// retries without leaving an open-ended allowance outstanding.
const APPROVAL_LEDGER_MARGIN = 100_000

export function decimalToBaseUnits(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) throw new Error('invalid amount')
  const [, whole, frac = ''] = match
  if (frac.length > decimals) throw new Error('too many decimal places')
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

export function baseUnitsToDecimal(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac === '' ? whole.toString() : `${whole}.${frac}`
}

// No secrets, just enough to poll chain and Iris state, so the processor's
// keyless steps (reconciliation, burn_submitted, burned) run even while locked.
export interface CctpReadEnv {
  networkId: string
  horizonUrl: string
  sorobanRpcUrl: string
  passphrase: string
  txTimeout: number
  evmRpcUrl: string
  evmChainId: number
  anchors: CctpEnvAnchors
}

export interface CctpEnv extends CctpReadEnv {
  // Captured once for the whole approve+burn sequence, not re-read from the
  // session per step: a session lock mid-sequence (idle timeout, popup closed)
  // would otherwise kill the burn after the approve landed.
  stellarSecret: string
  evmPrivateKey: Uint8Array
}

export async function evmRpcCall(
  evmRpcUrl: string,
  method: string,
  params: unknown[]
): Promise<string> {
  const res = await fetch(evmRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  })
  const data = (await res.json()) as { result?: string; error?: { message?: string } }
  if (data.error || data.result === undefined) {
    throw new Error(data.error?.message ?? `${method} failed`)
  }
  return data.result
}

export async function sorobanRpcCall<T>(
  sorobanRpcUrl: string,
  method: string,
  params?: unknown
): Promise<T> {
  const res = await fetch(sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  })
  const data = (await res.json()) as { result?: T; error?: { message?: string } }
  if (data.error) throw new Error(data.error.message ?? `${method} failed`)
  if (data.result === undefined) throw new Error(`${method} returned no result`)
  return data.result
}

// onHash runs with the signed tx hash before the broadcast POST, so a worker
// death mid-broadcast leaves a persisted hash, never an untracked live tx.
export async function submitStellarInvoke(
  env: CctpEnv,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  onHash: (hash: string) => Promise<void>
): Promise<string> {
  const source = Keypair.fromSecret(env.stellarSecret).publicKey()
  const op = new Contract(contractId).call(method, ...args)
  const accountRes = await fetch(`${env.horizonUrl}/accounts/${source}`)
  if (!accountRes.ok) throw new Error('failed to load stellar account')
  const accountData = (await accountRes.json()) as { sequence: string }
  const baseTx = new TransactionBuilder(new Account(source, accountData.sequence), {
    fee: BASE_FEE,
    networkPassphrase: env.passphrase,
  })
    .addOperation(op)
    .setTimeout(env.txTimeout)
    .build()

  const sim = await sorobanRpcCall<{
    error?: string
    minResourceFee?: string
    transactionData?: string
    results?: { auth?: string[] }[]
  }>(env.sorobanRpcUrl, 'simulateTransaction', {
    transaction: baseTx.toEnvelope().toXDR('base64'),
    resourceConfig: { instructionLeeway: 3_000_000 },
  })
  if (sim.error) throw new Error(sim.error)

  const baseFee = parseInt(baseTx.fee, 10)
  const resourceFee = parseInt(sim.minResourceFee ?? '0', 10)
  const builder = TransactionBuilder.cloneFrom(baseTx, { fee: String(baseFee + resourceFee) })
  if (sim.transactionData) {
    builder.setSorobanData(new SorobanDataBuilder(sim.transactionData).build())
  }
  const auth = (sim.results?.[0]?.auth ?? []).map((a) =>
    xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64')
  )
  builder.clearOperations()
  const baseOp = baseTx.operations[0] as Operation.InvokeHostFunction
  builder.addOperation(Operation.invokeHostFunction({ ...baseOp, auth }))
  const assembled = builder.build()
  assembled.sign(Keypair.fromSecret(env.stellarSecret))

  const hash = assembled.hash().toString('hex')
  await onHash(hash)

  const sendData = await sorobanRpcCall<{
    hash?: string
    status?: string
    errorResultXdr?: string
  }>(env.sorobanRpcUrl, 'sendTransaction', { transaction: assembled.toEnvelope().toXDR('base64') })
  if (sendData.status === 'ERROR') {
    throw new Error(`stellar submit rejected: ${sendData.errorResultXdr ?? 'unknown error'}`)
  }
  return hash
}

// Only the approve is awaited, since deposit_for_burn debits its allowance;
// the burn's confirmation is left to the background processor.
async function waitForStellarConfirmation(env: CctpEnv, hash: string): Promise<void> {
  const server = new SorobanRpc.Server(env.sorobanRpcUrl)
  const attempts = Math.ceil(env.txTimeout / 2)
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await server.getTransaction(hash)
    if (poll.status === 'SUCCESS') return
    if (poll.status === 'FAILED') throw new Error(`stellar tx failed on-chain: ${hash}`)
  }
  throw new Error(`stellar tx not confirmed within timeout: ${hash}`)
}

// onHash runs with keccak256 of the signed raw tx before
// eth_sendRawTransaction, for the same reason as submitStellarInvoke.
export async function submitEvmRaw(
  env: CctpEnv,
  to: string,
  data: Uint8Array,
  nonce: bigint,
  onHash: (hash: string) => Promise<void>
): Promise<string> {
  const dataHex = `0x${Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')}`
  const from = evmAddressFromPrivateKey(env.evmPrivateKey)

  const [prioHex, gasPriceHex] = await Promise.all([
    evmRpcCall(env.evmRpcUrl, 'eth_maxPriorityFeePerGas', []).catch(() => '0x59682f00'),
    evmRpcCall(env.evmRpcUrl, 'eth_gasPrice', []),
  ])
  const gasLimitHex = await evmRpcCall(env.evmRpcUrl, 'eth_estimateGas', [
    { from, to, value: '0x0', data: dataHex },
  ])

  const maxPriorityFeePerGas = BigInt(prioHex)
  const maxFeePerGas = BigInt(gasPriceHex) * 2n + maxPriorityFeePerGas
  const gasLimit = (BigInt(gasLimitHex) * 12n) / 10n

  // estimateGas does not check the balance. Without this, a node would reject the
  // broadcast after the hash is persisted, leaving a tx that can never land.
  const gasCeiling = gasLimit * maxFeePerGas
  const balance = BigInt(await evmRpcCall(env.evmRpcUrl, 'eth_getBalance', [from, 'pending']))
  if (balance < gasCeiling) {
    throw new Error(
      `Not enough ETH for network fees: this step needs up to ${baseUnitsToDecimal(gasCeiling, 18)} ETH`
    )
  }

  const raw = signEip1559(
    {
      chainId: BigInt(env.evmChainId),
      nonce,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to,
      value: 0n,
      data,
    },
    env.evmPrivateKey
  )

  const hash = evmTxHash(raw)
  await onHash(hash)

  const sentHash = await evmRpcCall(env.evmRpcUrl, 'eth_sendRawTransaction', [raw])
  if (sentHash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error('evm node returned an unexpected tx hash for the broadcast tx')
  }
  return hash
}

// eth_getTransactionReceipt returns null (not a string) until mined, so it
// needs its own fetch rather than the string-only evmRpcCall helper.
export async function fetchEvmReceipt(
  evmRpcUrl: string,
  hash: string
): Promise<{ status: string; blockNumber?: string; to?: string } | null> {
  const res = await fetch(evmRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [hash],
    }),
    signal: AbortSignal.timeout(15000),
  })
  const data = (await res.json()) as {
    result?: { status: string; blockNumber?: string; to?: string } | null
    error?: { message?: string }
  }
  if (data.error) throw new Error(data.error.message ?? 'eth_getTransactionReceipt failed')
  return data.result ?? null
}

async function waitForEvmInclusion(env: CctpEnv, hash: string): Promise<void> {
  const deadline = Date.now() + env.txTimeout * 1000
  while (Date.now() < deadline) {
    const receipt = await fetchEvmReceipt(env.evmRpcUrl, hash)
    if (receipt) {
      if (receipt.status === '0x1') return
      throw new Error(`evm tx reverted on-chain: ${hash}`)
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`evm tx not confirmed within timeout: ${hash}`)
}

// The approve-inclusion waits below are setTimeout+fetch loops, which do not
// keep the service worker alive. If it is torn down mid-wait, the job stays at
// 'approving' with approveTxHash persisted and the processor moves it to
// 'approved' once the approve confirms, so no funds are at risk.

async function submitStellarBurn(job: CctpJob, env: CctpEnv, stellarPk: string): Promise<void> {
  const amount7 = decimalToBaseUnits(job.amount, 7)
  const maxFee7 = decimalToBaseUnits(job.maxFee, 7)
  const mintRecipient = evmAddressToBytes32(job.destAddress)
  await submitStellarInvoke(
    env,
    env.anchors.stellar.tokenMessengerMinter,
    'deposit_for_burn',
    [
      nativeToScVal(job.sourceAddress, { type: 'address' }),
      nativeToScVal(amount7, { type: 'i128' }),
      nativeToScVal(CCTP_DOMAIN_ETHEREUM, { type: 'u32' }),
      nativeToScVal(Buffer.from(mintRecipient), { type: 'bytes' }),
      nativeToScVal(env.anchors.stellar.usdcSac, { type: 'address' }),
      nativeToScVal(Buffer.alloc(32), { type: 'bytes' }), // destination_caller: zero, anyone may complete the mint
      nativeToScVal(maxFee7, { type: 'i128' }),
      nativeToScVal(finalityThresholdFor(job), { type: 'u32' }),
    ],
    (hash) =>
      patchCctpJob(env.networkId, stellarPk, job.id, {
        status: 'burn_submitted',
        burnTxHash: hash,
        burnBroadcastAt: Date.now(),
        lastError: undefined,
      }).then(() => undefined)
  )
}

async function submitEvmBurn(
  job: CctpJob,
  env: CctpEnv,
  stellarPk: string,
  nonce: number
): Promise<void> {
  const forwarderBytes32 = stellarContractIdToBytes32(env.anchors.stellar.cctpForwarder)
  const burnData = encodeDepositForBurnWithHook({
    amount: decimalToBaseUnits(job.amount, 6),
    destinationDomain: CCTP_DOMAIN_STELLAR,
    mintRecipient: forwarderBytes32,
    burnToken: env.anchors.evm.usdc,
    destinationCaller: forwarderBytes32,
    maxFee: decimalToBaseUnits(job.maxFee, 6),
    minFinalityThreshold: finalityThresholdFor(job),
    hookData: encodeHookData(job.destAddress),
  })
  await submitEvmRaw(env, env.anchors.evm.tokenMessengerV2, burnData, BigInt(nonce), (hash) =>
    patchCctpJob(env.networkId, stellarPk, job.id, {
      status: 'burn_submitted',
      burnNonce: nonce,
      burnTxHash: hash,
      burnBroadcastAt: Date.now(),
      lastError: undefined,
    }).then(() => undefined)
  )
}

async function runStellarToEvm(job: CctpJob, env: CctpEnv, stellarPk: string): Promise<void> {
  const amount7 = decimalToBaseUnits(job.amount, 7)

  const latest = await sorobanRpcCall<{ sequence: number }>(env.sorobanRpcUrl, 'getLatestLedger')
  const expirationLedger = latest.sequence + APPROVAL_LEDGER_MARGIN

  const approveHash = await submitStellarInvoke(
    env,
    env.anchors.stellar.usdcSac,
    'approve',
    [
      nativeToScVal(job.sourceAddress, { type: 'address' }),
      nativeToScVal(env.anchors.stellar.tokenMessengerMinter, { type: 'address' }),
      nativeToScVal(amount7, { type: 'i128' }),
      nativeToScVal(expirationLedger, { type: 'u32' }),
    ],
    (hash) =>
      patchCctpJob(env.networkId, stellarPk, job.id, {
        status: 'approving',
        approveTxHash: hash,
        approveBroadcastAt: Date.now(),
      }).then(() => undefined)
  )
  await waitForStellarConfirmation(env, approveHash)
  await submitStellarBurn(job, env, stellarPk)
}

async function runEvmToStellar(job: CctpJob, env: CctpEnv, stellarPk: string): Promise<void> {
  const amount6 = decimalToBaseUnits(job.amount, 6)
  const from = evmAddressFromPrivateKey(env.evmPrivateKey)

  const preBurnNonce = Number(
    BigInt(await evmRpcCall(env.evmRpcUrl, 'eth_getTransactionCount', [from, 'pending']))
  )
  await patchCctpJob(env.networkId, stellarPk, job.id, { preBurnNonce })

  const approveData = encodeErc20Approve(env.anchors.evm.tokenMessengerV2, amount6)
  const approveHash = await submitEvmRaw(
    env,
    env.anchors.evm.usdc,
    approveData,
    BigInt(preBurnNonce),
    (hash) =>
      patchCctpJob(env.networkId, stellarPk, job.id, {
        status: 'approving',
        approveTxHash: hash,
        approveBroadcastAt: Date.now(),
      }).then(() => undefined)
  )
  await waitForEvmInclusion(env, approveHash)
  await submitEvmBurn(job, env, stellarPk, preBurnNonce + 1)
}

// Called unawaited by CCTP_START once the job is persisted. The account lock
// is held for the ENTIRE approve+burn sequence, not per write, so a processor
// pass never acts on a status this submission is about to change.
export async function runCctpBurn(job: CctpJob, env: CctpEnv, stellarPk: string): Promise<void> {
  try {
    await withCctpAccountLock(`${env.networkId}:${stellarPk}`, () =>
      job.direction === 'stellar-to-evm'
        ? runStellarToEvm(job, env, stellarPk)
        : runEvmToStellar(job, env, stellarPk)
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    try {
      await withCctpAccountLock(`${env.networkId}:${stellarPk}`, async () => {
        const current = (await listCctpJobs(env.networkId, stellarPk)).find((j) => j.id === job.id)
        // Once the processor has seen the approve confirm, this error (typically the
        // approve wait timing out) no longer describes the job.
        if (!current || current.status === 'approved') return
        // Gated on approveTxHash, not burnTxHash: a signed approve may have landed,
        // and the processor turns that into 'approved' for the user to continue.
        // Only a job where nothing was ever signed is safe to fail here.
        await patchCctpJob(
          env.networkId,
          stellarPk,
          job.id,
          current.approveTxHash ? { lastError: message } : { lastError: message, status: 'failed' }
        )
      })
    } catch (recoveryError) {
      // Fire-and-forget caller, so never reject; the job just keeps its last
      // persisted state, which is never half-written.
      console.error('cctp: failed to record burn failure', recoveryError)
    }
  }
}

/**
 * Sends the burn for a job whose approve confirmed but whose burn never went out.
 * User-initiated only, like the first attempt: burnTxHash is persisted before any
 * broadcast, so its absence proves no burn was ever broadcast and this cannot double-burn.
 */
export async function resumeCctpBurn(
  jobId: string,
  env: CctpEnv,
  stellarPk: string
): Promise<void> {
  await withCctpAccountLock(`${env.networkId}:${stellarPk}`, async () => {
    const job = (await listCctpJobs(env.networkId, stellarPk)).find((j) => j.id === jobId)
    if (!job || job.status !== 'approved' || job.burnTxHash) {
      throw new Error('This bridge is not waiting to continue')
    }
    try {
      if (job.direction === 'stellar-to-evm') {
        await submitStellarBurn(job, env, stellarPk)
        return
      }
      // The original burn slot may have been taken by another tx since the approve.
      const from = evmAddressFromPrivateKey(env.evmPrivateKey)
      const nonce = Number(
        BigInt(await evmRpcCall(env.evmRpcUrl, 'eth_getTransactionCount', [from, 'pending']))
      )
      await submitEvmBurn(job, env, stellarPk, nonce)
    } catch (e) {
      try {
        const current = (await listCctpJobs(env.networkId, stellarPk)).find((j) => j.id === jobId)
        // A failure after the hash was persisted is the processor's to reconcile.
        if (current && !current.burnTxHash) {
          await patchCctpJob(env.networkId, stellarPk, jobId, {
            lastError: e instanceof Error ? e.message : String(e),
          })
        }
      } catch {
        // recording the reason is best-effort; the caller still gets the original error
      }
      throw e
    }
  })
}
