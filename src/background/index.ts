import { WINDOW_MODES, STORAGE_KEYS, MESSAGE_TYPES } from '@constants/windowMode'
import { SERVICE_TYPES, PASSWORD_RULES } from '@constants/services'
import { EXTERNAL_SERVICE_TYPES, APPROVAL_PAYLOAD_STORAGE_KEY } from '@constants/external'
import type { NetworkConfig } from '@constants/networks'
import type {
  MessagePayload,
  MessageResponse,
  ServicePayload,
  ServiceResponse,
} from '@ext-types/index'
import {
  generateMnemonic,
  deriveKeypairRaw,
  encryptAndStoreMnemonic,
  decryptSecret,
  decryptMnemonic,
  getStoredPublicKey,
  hasWallet,
  isLegacyWallet,
  storeSessionSecret,
  getSessionSecret,
  clearSessionSecret,
  storeSessionMnemonic,
  getSessionMnemonic,
  clearSessionMnemonic,
  getAccountsStore,
  saveAccountsStore,
  upgradeEncryptionIfNeeded,
  encryptString,
  decryptString,
  validateMnemonic,
  verifyPassword,
  changePassword,
  getHDWallets,
  saveHDWallets,
  getImportedKeys,
  saveImportedKeys,
  storeSessionExtraHDMnemonics,
  getSessionExtraHDMnemonics,
  clearSessionExtraHDMnemonics,
  storeSessionImportedSecrets,
  getSessionImportedSecrets,
  clearSessionImportedSecrets,
  clearWallet,
  type AccountInfo,
} from './keyManager'
import {
  getNetworks,
  getActiveNetwork,
  setActiveNetwork,
  addNetwork,
  editNetwork,
  removeNetwork,
} from './networkManager'
import {
  isAllowed,
  grantAccess,
  revokeAccess,
  revokeAllAccess,
  getConnectedApps,
} from './allowlistManager'
import {
  prepareSend,
  revealNote,
  recoverFromSeed,
  selfReclaim,
  processNotes,
  listNotes,
  quoteSend,
  NoteNotReadyError,
  NoPoolError,
  type PrivateEnv,
  type ProcessDeps,
  type SendParams,
  type SubmitReveal,
} from './privatePayments'
import { NonRepresentableAmountError } from '../private/denominations'
import { RelayerError } from '../private/relayerClient'
import { generateProof } from './offscreenProver'
import {
  trackInstall,
  trackDailyPing,
  trackConnect,
  trackConnectRejected,
  trackSign,
  trackSignRejected,
  trackSubmit,
  trackSubmitFailed,
  trackWalletCreated,
  trackAccountAdded,
  trackNetworkSwitched,
  trackContractInvoked,
  trackError,
  setupAnalyticsAlarm,
  DAILY_ALARM,
} from './analytics'
import {
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  SorobanDataBuilder,
  xdr,
  rpc as SorobanRpc,
  contract as StellarContract,
} from '@stellar/stellar-sdk'

const SESSION_KEY = 'cyphras_session_pubkey'
const FAILED_ATTEMPTS_KEY = 'cyphras_failed_attempts'
const LOCKED_UNTIL_KEY = 'cyphras_locked_until'
const AUTO_LOCK_TIMEOUT_KEY = 'cyphras_auto_lock_timeout'
const DEFAULT_IDLE_TIMEOUT_SECONDS = 15 * 60

async function getIdleTimeoutSeconds(): Promise<number> {
  const res = await chrome.storage.local.get(AUTO_LOCK_TIMEOUT_KEY)
  const val = res[AUTO_LOCK_TIMEOUT_KEY]
  return typeof val === 'number' && val >= 0 ? val : DEFAULT_IDLE_TIMEOUT_SECONDS
}

async function applyIdleTimeout() {
  const seconds = await getIdleTimeoutSeconds()
  if (seconds === 0) {
    // "Immediately" - lock now and disable idle detection
    chrome.idle.setDetectionInterval(60)
  } else {
    chrome.idle.setDetectionInterval(Math.max(15, seconds))
  }
}
const APPROVAL_WINDOW_WIDTH = 400
const APPROVAL_WINDOW_HEIGHT = 600

const pendingRequests = new Map<string, (approved: boolean) => void>()
// Maps approval window ID - request ID so we can resolve immediately on close
const approvalWindowToRequest = new Map<number, string>()
// Maps unlock window ID - finish fn so we can resolve immediately on close
const unlockWindowResolvers = new Map<number, (pubkey: string | null) => void>()
// Tracks origins with a connect() already in flight - prevents duplicate popups
const pendingConnectOrigins = new Set<string>()

let cachedSidebarByDefault = false

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/
const CONTRACT_RE = /^C[A-Z2-7]{55}$/
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/

function isStellarAddress(v: unknown): v is string {
  return typeof v === 'string' && STELLAR_ADDRESS_RE.test(v)
}

function isAssetCode(v: unknown): v is string {
  return typeof v === 'string' && ASSET_CODE_RE.test(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

// Stores full XDR/data for approval windows so we don't truncate in URL params.

async function storeApprovalPayload(id: string, data: Record<string, string>): Promise<void> {
  const result = await chrome.storage.session?.get(APPROVAL_PAYLOAD_STORAGE_KEY)
  const store: Record<string, Record<string, string>> = result?.[APPROVAL_PAYLOAD_STORAGE_KEY] ?? {}
  store[id] = data
  await chrome.storage.session?.set({ [APPROVAL_PAYLOAD_STORAGE_KEY]: store })
}

async function clearApprovalPayload(id: string): Promise<void> {
  const result = await chrome.storage.session?.get(APPROVAL_PAYLOAD_STORAGE_KEY)
  const store: Record<string, Record<string, string>> = result?.[APPROVAL_PAYLOAD_STORAGE_KEY] ?? {}
  delete store[id]
  await chrome.storage.session?.set({ [APPROVAL_PAYLOAD_STORAGE_KEY]: store })
}

function getExplorerUrl(network: NetworkConfig, txHash: string): string {
  if (network.explorerUrl) return `${network.explorerUrl}/tx/${txHash}`
  // Fallback for networks that predate explorerUrl field
  const net = network.id === 'mainnet' ? 'public' : 'testnet'
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`
}

type ScValSpec =
  | { type: 'address'; value: string }
  | { type: 'i128' | 'u128'; value: string | bigint }
  | { type: 'i64' | 'u64'; value: string | number | bigint }
  | { type: 'i32' | 'u32'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'symbol'; value: string }
  | { type: 'bytes'; value: string }
  | { type: 'vec'; items: ScValSpec[] }
  | { type: 'map'; entries: Array<{ key: ScValSpec; value: ScValSpec }> }
  | { type: 'void' }

function scValSpecToXdr(spec: ScValSpec): xdr.ScVal {
  switch (spec.type) {
    case 'address':
      return nativeToScVal(spec.value, { type: 'address' })
    case 'i128':
      return nativeToScVal(BigInt(spec.value.toString()), { type: 'i128' })
    case 'u128':
      return nativeToScVal(BigInt(spec.value.toString()), { type: 'u128' })
    case 'i64':
      return nativeToScVal(BigInt(spec.value.toString()), { type: 'i64' })
    case 'u64':
      return nativeToScVal(BigInt(spec.value.toString()), { type: 'u64' })
    case 'i32':
      return nativeToScVal(spec.value, { type: 'i32' })
    case 'u32':
      return nativeToScVal(spec.value, { type: 'u32' })
    case 'bool':
      return xdr.ScVal.scvBool(spec.value)
    case 'string':
      return xdr.ScVal.scvString(spec.value)
    case 'symbol':
      return xdr.ScVal.scvSymbol(spec.value)
    case 'bytes':
      return xdr.ScVal.scvBytes(Buffer.from(spec.value, 'hex'))
    case 'vec':
      return xdr.ScVal.scvVec(spec.items.map(scValSpecToXdr))
    case 'map':
      return xdr.ScVal.scvMap(
        spec.entries.map(
          (e) => new xdr.ScMapEntry({ key: scValSpecToXdr(e.key), val: scValSpecToXdr(e.value) })
        )
      )
    case 'void':
      return xdr.ScVal.scvVoid()
  }
}

interface SorobanSimResult {
  results?: Array<{ xdr?: string; auth?: string[] }>
  minResourceFee?: string
  transactionData?: string
  error?: string
}

async function sorobanSimulate(rpcUrl: string, txXdr: string): Promise<SorobanSimResult | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: txXdr, resourceConfig: { instructionLeeway: 3000000 } },
      }),
    })
    const data = (await res.json()) as { result?: SorobanSimResult; error?: { message: string } }
    if (data.error) return null
    return data.result ?? null
  } catch {
    return null
  }
}

// Congestion-aware inclusion fee from fee_stats so a commit bids competitively when the network is
// busy. Falls back to the base fee when fee_stats is unavailable.
async function fetchInclusionFeeStroops(horizonUrl: string): Promise<number> {
  const fallback = parseInt(BASE_FEE, 10)
  try {
    const res = await fetch(`${horizonUrl}/fee_stats`)
    if (!res.ok) return fallback
    const data = (await res.json()) as { max_fee?: { mode?: string; p10?: string } }
    const base = Math.max(parseInt(data.max_fee?.p10 ?? '') || fallback, fallback)
    return Math.max(parseInt(data.max_fee?.mode ?? '') || fallback, base * 5)
  } catch {
    return fallback
  }
}

// Estimate the per-commit max fee by simulating one commit; never signs or submits. Returns "0" when
// simulation is unavailable so the caller can show the relayer fee alone rather than a fabricated number.
async function estimateCommitFeeStroops(
  net: NetworkConfig,
  source: string,
  pool: string,
  relayerFeeStroops: string
): Promise<string> {
  if (!net.sorobanRpcUrl) return '0'
  try {
    const inclusionFee = await fetchInclusionFeeStroops(net.horizonUrl)
    const args = [
      nativeToScVal(source, { type: 'address' }),
      nativeToScVal(Buffer.alloc(32), { type: 'bytes' }),
      nativeToScVal(BigInt(relayerFeeStroops), { type: 'i128' }),
    ]
    const op = new Contract(pool).call('commit', ...args)
    const accountRes = await fetch(`${net.horizonUrl}/accounts/${source}`)
    if (!accountRes.ok) return '0'
    const accountData = (await accountRes.json()) as { sequence: string }
    const baseTx = new TransactionBuilder(new Account(source, accountData.sequence), {
      fee: String(inclusionFee),
      networkPassphrase: net.passphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build()
    const sim = await sorobanSimulate(net.sorobanRpcUrl, baseTx.toEnvelope().toXDR('base64'))
    if (!sim || sim.error || !sim.minResourceFee) return '0'
    return String(inclusionFee + parseInt(sim.minResourceFee, 10))
  } catch {
    return '0'
  }
}

function assembleTx(
  baseTx: ReturnType<TransactionBuilder['build']>,
  sim: SorobanSimResult
): ReturnType<TransactionBuilder['build']> {
  const baseFee = parseInt(baseTx.fee, 10)
  const resourceFee = parseInt(sim.minResourceFee ?? '0', 10)

  const builder = TransactionBuilder.cloneFrom(baseTx, { fee: String(baseFee + resourceFee) })

  if (sim.transactionData) {
    builder.setSorobanData(new SorobanDataBuilder(sim.transactionData).build())
  }

  const auth = (sim.auth ?? []).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'))
  builder.clearOperations()
  const op = baseTx.operations[0] as ReturnType<typeof Operation.invokeHostFunction>
  builder.addOperation(Operation.invokeHostFunction({ ...op, auth }))

  return builder.build()
}

function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return value
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {}
    value.forEach((v, k) => {
      obj[String(k)] = toJsonSafe(v)
    })
    return obj
  }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  // Buffer / Uint8Array (bytes return type from scValToNative) - hex string
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex')
  }
  if (typeof value === 'object') {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = toJsonSafe(v)
    }
    return obj
  }
  return String(value)
}

function decodeScValResult(resultXdr: string): unknown {
  try {
    return toJsonSafe(scValToNative(xdr.ScVal.fromXDR(resultXdr, 'base64')))
  } catch {
    return null
  }
}

function formatSpecType(typeDef: any): string {
  const raw: string = typeDef.switch().name // e.g. "scSpecTypeU128", "scSpecTypeBytesN"
  const name = raw.replace('scSpecType', '').toLowerCase()
  if (name === 'udt') return typeDef.udt().name().toString()
  if (name === 'bytesn') return `bytesN(${typeDef.bytesN().n()})`
  if (name === 'vec') return `Vec<${formatSpecType(typeDef.vec().elementType())}>`
  if (name === 'option') return `Option<${formatSpecType(typeDef.option().valueType())}>`
  if (name === 'map')
    return `Map<${formatSpecType(typeDef.map().keyType())}, ${formatSpecType(typeDef.map().valueType())}>`
  if (name === 'tuple')
    return `Tuple<${(typeDef.tuple().valueTypes() as any[]).map(formatSpecType).join(', ')}>`
  return name
}

async function requireUnlockedAndAllowed(
  pubkey: string | null,
  origin: string,
  sendResponse: (r: Record<string, unknown>) => void
): Promise<string | null> {
  let resolvedPubkey = pubkey
  if (!resolvedPubkey) {
    resolvedPubkey = await openAndWaitForUnlock()
    if (!resolvedPubkey) {
      sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Please unlock your wallet first' } })
      return null
    }
  }
  const activeNetwork = await getActiveNetwork()
  const allowed = await isAllowed(origin, resolvedPubkey, activeNetwork.id)
  if (!allowed) {
    sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
    return null
  }
  return resolvedPubkey
}

const PRIVATE_ALARM = 'cyphras_private_processor'

function setupPrivateProcessorAlarm(): void {
  chrome.alarms.get(PRIVATE_ALARM, (existing: chrome.alarms.Alarm | undefined) => {
    if (!existing) {
      chrome.alarms.create(PRIVATE_ALARM, { periodInMinutes: 1 })
    }
  })
}

// Map private-payment internals to user-safe copy. Raw RPC/relayer/XDR strings leak topology, so
// anything unrecognized falls back to a generic message instead of being passed through.
function friendlyPrivateError(err: unknown, asset: string): string {
  if (err instanceof NoPoolError) {
    return `No privacy pool is available for ${asset} yet.`
  }
  if (err instanceof NonRepresentableAmountError) {
    return "This amount can't be split into the available privacy denominations. Try a rounder amount."
  }
  return 'Private payment service is temporarily unavailable. Try again shortly.'
}

// A reveal pays via SAC transfer (cannot fund a new account; wrapped assets need a trustline). Verify
// both before commit so funds never enter an undeliverable pool. Returns null on OK or transient error.
async function recipientReceiveError(
  net: NetworkConfig,
  recipient: string,
  assetCfg: { asset: string; issuer?: string }
): Promise<string | null> {
  let acc: { balances?: { asset_code?: string; asset_issuer?: string }[] }
  try {
    const res = await fetch(`${net.horizonUrl}/accounts/${recipient}`)
    if (res.status === 404) {
      return 'Recipient account is not activated yet. They need to fund it first.'
    }
    if (!res.ok) {
      return null
    }
    acc = (await res.json()) as typeof acc
  } catch {
    return null
  }
  // Any existing account can receive the native asset; no trustline needed.
  if (!assetCfg.issuer) {
    return null
  }
  const hasTrustline = (acc.balances ?? []).some(
    (b) => b.asset_code === assetCfg.asset && b.asset_issuer === assetCfg.issuer
  )
  if (!hasTrustline) {
    return `Recipient has no ${assetCfg.asset} trustline yet. They need to add it before they can receive.`
  }
  return null
}

// A payment cannot create an unfunded destination, so a never-funded account is created with XLM
// instead. A non-native asset can never reach a missing account, and a new account needs >= 1 XLM.
async function buildTransferOperation(
  horizonUrl: string,
  destination: string,
  asset: Asset,
  amount: string
) {
  const res = await fetch(`${horizonUrl}/accounts/${destination}`)
  if (res.ok) {
    return Operation.payment({ destination, asset, amount })
  }
  if (res.status === 404) {
    if (!asset.isNative()) {
      throw new Error(
        'Recipient account is not activated. Send it XLM first to create the account.'
      )
    }
    if (Number(amount) < 1) {
      throw new Error('Sending to a new account requires at least 1 XLM to activate it.')
    }
    return Operation.createAccount({ destination, startingBalance: amount })
  }
  // A transient Horizon error: fall back to payment and let submission surface the real failure.
  return Operation.payment({ destination, asset, amount })
}

// Builds the shared private-payment env. Note derivation keys off the active account's secret, so the
// secret must control the active account; a mismatch is refused. Returns null when locked or mismatched.
async function buildPrivateEnv(net: NetworkConfig): Promise<PrivateEnv | null> {
  const secret = await getSessionSecret()
  const session = await chrome.storage.session?.get(SESSION_KEY)
  const source = session?.[SESSION_KEY] as string | undefined
  if (!secret || !source) {
    return null
  }
  let derivedPublicKey: string
  try {
    derivedPublicKey = Keypair.fromSecret(secret).publicKey()
  } catch {
    return null
  }
  if (derivedPublicKey !== source) {
    return null
  }
  return {
    factory: {
      factoryId: net.privatePoolFactory ?? '',
      rpcUrl: net.sorobanRpcUrl,
      networkPassphrase: net.passphrase,
    },
    relayerUrl: net.relayerUrl ?? '',
    network: net.id,
    source,
    secret,
    horizonUrl: net.horizonUrl,
    tokens: net.privateAssets?.map((a) => a.token) ?? [],
    // Same timeout used to build the commit tx, so the resubmit window outlasts the tx validity
    // window and a still-pending commit is never double-submitted.
    txTimeout: net.txTimeout ?? 90,
  }
}

// Build the env + deps the background note processor needs, or null when the wallet is locked or the
// active network has no private-payment config.
async function buildPrivateContext(): Promise<{ env: PrivateEnv; deps: ProcessDeps } | null> {
  const net = await getActiveNetwork()
  if (!net.sorobanRpcUrl || !net.privatePoolFactory || !net.relayerUrl) {
    return null
  }
  const rpcUrl = net.sorobanRpcUrl
  const env = await buildPrivateEnv(net)
  if (!env) {
    return null
  }
  const deps: ProcessDeps = {
    submitCommit: async (pool, innerHex, relayerFee, onBroadcast) => {
      // Re-read the key at sign time so a wallet locked since the pass started aborts instead of
      // signing with a stale secret.
      const freshSecret = await getSessionSecret()
      if (!freshSecret) {
        throw new Error('wallet locked')
      }
      // Same congestion-aware inclusion fee the quote estimated, so the confirmed max fee matches what is paid.
      const inclusionFee = await fetchInclusionFeeStroops(net.horizonUrl)
      const args = [
        nativeToScVal(env.source, { type: 'address' }),
        nativeToScVal(Buffer.from(innerHex, 'hex'), { type: 'bytes' }),
        nativeToScVal(relayerFee, { type: 'i128' }),
      ]
      let feeStroops: string | undefined
      const txHash = await invokeSignedContract(
        net,
        freshSecret,
        env.source,
        pool,
        'commit',
        args,
        onBroadcast,
        String(inclusionFee),
        (fee) => {
          feeStroops = fee
        }
      )
      return { txHash, feeStroops }
    },
    generateProof: (inputs) => generateProof(inputs, env.network),
    isUnlocked: async () => {
      const s = await chrome.storage.session?.get(SESSION_KEY)
      return !!s?.[SESSION_KEY]
    },
    getTxStatus: async (txHash) => {
      const res = await new SorobanRpc.Server(rpcUrl).getTransaction(txHash)
      if (res.status === 'SUCCESS') {
        return 'success'
      }
      if (res.status === 'FAILED') {
        return 'failed'
      }
      return 'not_found'
    },
  }
  return { env, deps }
}

// Sign and submit pool.reveal from the active account for a self-reclaim (recipient = relayer = self),
// sourced and paid by the user, bypassing the relayer entirely.
function makeSubmitReveal(net: NetworkConfig, source: string): SubmitReveal {
  return async (pool, proved) => {
    const freshSecret = await getSessionSecret()
    if (!freshSecret) {
      throw new Error('wallet locked')
    }
    const inclusionFee = await fetchInclusionFeeStroops(net.horizonUrl)
    const bytes = (hex: string) => nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' })
    const args = [
      bytes(proved.proof),
      bytes(proved.root),
      bytes(proved.nullifierHash),
      bytes(proved.amountHash),
      nativeToScVal(proved.recipient, { type: 'address' }),
      nativeToScVal(proved.relayer, { type: 'address' }),
      nativeToScVal(BigInt(proved.xlmFee), { type: 'i128' }),
    ]
    const txHash = await invokeSignedContract(
      net,
      freshSecret,
      source,
      pool,
      'reveal',
      args,
      undefined,
      String(inclusionFee)
    )
    return { txHash }
  }
}

// A relayer/network blip (5xx, offline) is expected and self-heals on the next tick, so it is logged
// quietly rather than surfaced as an error; only an unexpected fault is treated as a real failure.
function isTransientPrivateError(err: unknown): boolean {
  return err instanceof RelayerError || (err instanceof TypeError && /fetch/i.test(err.message))
}

// Coalesce concurrent triggers into one active pass plus at most one queued rerun. Serialised storage
// writes are guaranteed by processNotes' per-source lock; this flag only avoids redundant passes.
let privateRunning = false
let privateRerun = false

async function kickPrivateProcessor(): Promise<void> {
  if (privateRunning) {
    privateRerun = true
    return
  }
  privateRunning = true
  try {
    do {
      privateRerun = false
      const ctx = await buildPrivateContext()
      if (!ctx) {
        return
      }
      await processNotes(ctx.env, ctx.deps)
    } while (privateRerun)
  } catch (err) {
    if (isTransientPrivateError(err)) {
      console.debug('private note processor: relayer/network unavailable, retrying later', err)
    } else {
      console.error('private note processor failed', err)
    }
  } finally {
    privateRunning = false
  }
}

// Best-effort: rebuild any note this account committed on-chain that is missing locally (cleared
// storage, reinstall, new device), then process them. Never throws.
let privateRecovering = false
const lastRecoveryAt = new Map<string, number>()
const RECOVERY_THROTTLE_MS = 120_000

// force re-scans now (unlock / account switch); throttled callers (a History refresh poll) re-scan at
// most once per window so polling does not hammer Horizon.
async function kickPrivateRecovery(force = false): Promise<void> {
  if (privateRecovering) {
    return
  }
  privateRecovering = true
  try {
    const ctx = await buildPrivateContext()
    if (ctx) {
      const last = lastRecoveryAt.get(ctx.env.source) ?? 0
      if (force || Date.now() - last >= RECOVERY_THROTTLE_MS) {
        lastRecoveryAt.set(ctx.env.source, Date.now())
        await recoverFromSeed(ctx.env)
      }
    }
  } catch (err) {
    if (isTransientPrivateError(err)) {
      console.debug('private note recovery: relayer/network unavailable, retrying later', err)
    } else {
      console.error('private note recovery failed', err)
    }
  } finally {
    privateRecovering = false
  }
  void kickPrivateProcessor()
}

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  chrome.sidePanel.setOptions({ path: 'wallet.html?ctx=sidepanel', enabled: true })
  setupAnalyticsAlarm()
  setupPrivateProcessorAlarm()
  if (details.reason === 'install') trackInstall()

  const walletExists = await hasWallet()
  if (!walletExists) {
    chrome.tabs.create({
      url: chrome.runtime.getURL('onboarding.html'),
    })
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_ALARM) trackDailyPing()
  if (alarm.name === PRIVATE_ALARM) void kickPrivateProcessor()
})

// Re-register alarms on service-worker restart (MV3 workers can be killed)
setupAnalyticsAlarm()
setupPrivateProcessorAlarm()

// Resume processing on unlock or account switch: SESSION_KEY appearing means the key needed for
// commit/reveal is back.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[SESSION_KEY]?.newValue) {
    void kickPrivateRecovery(true)
  }
})

// Resume on worker startup, picking up any note left mid-flight by a killed worker (session storage
// and the note store survive the restart). No-op while locked.
void kickPrivateProcessor()

// Restore sidebar-by-default behavior on service-worker restart
chrome.storage.local.get('cyphras_sidebar_by_default', (result) => {
  cachedSidebarByDefault = result['cyphras_sidebar_by_default'] === true
  if (cachedSidebarByDefault) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  }
})

function lockSession() {
  chrome.storage.session?.remove(SESSION_KEY)
  if (pendingRequests.size === 0) {
    clearSessionSecret()
    clearSessionMnemonic()
    clearSessionExtraHDMnemonics()
    clearSessionImportedSecrets()
  }
  notifyTabsWalletChanged()
}

applyIdleTimeout()
chrome.idle.onStateChanged.addListener((state) => {
  if (state !== 'idle' && state !== 'locked') return
  lockSession()
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'wallet-popup') {
    port.onDisconnect.addListener(async () => {
      const seconds = await getIdleTimeoutSeconds()
      if (seconds === 0) lockSession()
    })
    return
  }

  if (port.name !== 'sidepanel') return

  chrome.storage.local.set({ [STORAGE_KEYS.WINDOW_MODE]: WINDOW_MODES.SIDEPANEL })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

  port.onDisconnect.addListener(async () => {
    chrome.storage.local.get(STORAGE_KEYS.WINDOW_MODE, (result) => {
      const mode = result[STORAGE_KEYS.WINDOW_MODE]
      chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: mode === WINDOW_MODES.SIDEPANEL || cachedSidebarByDefault,
      })
    })
    const seconds = await getIdleTimeoutSeconds()
    if (seconds === 0) lockSession()
  })
})

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message.type === 'EXTERNAL_REQUEST') {
    handleExternalRequest(message, sender, sendResponse)
    return true
  }

  if (message.type === 'APPROVAL_RESPONSE') {
    const resolver = pendingRequests.get(message.id)
    if (resolver) {
      pendingRequests.delete(message.id)
      resolver(message.approved)
    }
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'GET_WALLET_STATE_FOR_BROADCAST') {
    handleGetWalletStateForBroadcast(sendResponse)
    return true
  }

  if ('type' in message && Object.values(SERVICE_TYPES).includes(message.type as any)) {
    handleService(message as ServicePayload, sendResponse)
    return true
  }

  handleWindowMessage(message as MessagePayload, sendResponse)
  return true
})

async function handleGetWalletStateForBroadcast(
  sendResponse: (r: Record<string, unknown>) => void
) {
  const session = await chrome.storage.session?.get(SESSION_KEY)
  const pubkey = session?.[SESSION_KEY] ?? null
  const activeNetwork = await getActiveNetwork()
  sendResponse({
    address: pubkey,
    network: activeNetwork.id,
    networkPassphrase: activeNetwork.passphrase,
  })
}

async function openApprovalWindow(path: string): Promise<chrome.windows.Window> {
  return new Promise((resolve) => {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL(`approval.html#${path}`),
        type: 'popup',
        width: APPROVAL_WINDOW_WIDTH,
        height: APPROVAL_WINDOW_HEIGHT,
        focused: true,
      },
      (win) => resolve(win!)
    )
  })
}

async function waitForApproval(id: string, windowPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve)

    openApprovalWindow(windowPath).then((win) => {
      if (win.id != null) approvalWindowToRequest.set(win.id, id)
    })

    setTimeout(
      () => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          resolve(false)
        }
      },
      5 * 60 * 1000
    )
  })
}

// Resolve pending approval or unlock immediately when user closes any popup window
chrome.windows.onRemoved.addListener((windowId) => {
  const requestId = approvalWindowToRequest.get(windowId)
  if (requestId) {
    approvalWindowToRequest.delete(windowId)
    const resolver = pendingRequests.get(requestId)
    if (resolver) {
      pendingRequests.delete(requestId)
      resolver(false)
    }
  }

  const unlockFinish = unlockWindowResolvers.get(windowId)
  if (unlockFinish) {
    unlockWindowResolvers.delete(windowId)
    unlockFinish(null)
  }
})

function notifyTabsWalletChanged() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'WALLET_CHANGED' }).catch(() => {})
      }
    }
  })
}

// Resolves immediately with null if the user closes the window.
async function openAndWaitForUnlock(timeoutMs = 2 * 60 * 1000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    let unlockWinId: number | null = null

    function finish(pubkey: string | null) {
      if (done) return
      done = true
      clearTimeout(timer)
      chrome.storage.onChanged.removeListener(storageListener)
      // Close the popup immediately on successful unlock so the wallet UI
      // inside it cannot navigate and open a floating window.
      if (pubkey && unlockWinId != null) {
        unlockWindowResolvers.delete(unlockWinId)
        chrome.windows.remove(unlockWinId).catch(() => {})
      }
      resolve(pubkey)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    async function storageListener(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area !== 'session') return
      if (!('cyphras_session_pubkey' in changes)) return
      const newValue = changes['cyphras_session_pubkey']?.newValue
      if (!newValue) return
      finish(newValue)
    }

    chrome.storage.onChanged.addListener(storageListener)

    chrome.windows.create(
      {
        url: chrome.runtime.getURL('wallet.html#/unlock'),
        type: 'popup',
        width: APPROVAL_WINDOW_WIDTH,
        height: APPROVAL_WINDOW_HEIGHT,
        focused: true,
      },
      (win) => {
        unlockWinId = win?.id ?? null
        if (unlockWinId != null) unlockWindowResolvers.set(unlockWinId, finish)
      }
    )
  })
}

async function handleExternalRequest(
  message: any,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (r: Record<string, unknown>) => void
) {
  try {
    const { id, requestType, origin, payload } = message

    const session = await chrome.storage.session?.get(SESSION_KEY)
    const pubkey: string | null = session?.[SESSION_KEY] ?? null

    switch (requestType) {
      case EXTERNAL_SERVICE_TYPES.IS_CONNECTED: {
        // isConnected = extension is installed AND wallet is unlocked (session active)
        sendResponse({ result: { isConnected: !!pubkey } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_ADDRESS: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const { id: gadNetId } = await getActiveNetwork()
        const allowed = await isAllowed(origin, pubkey, gadNetId)
        if (!allowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }
        sendResponse({ result: { address: pubkey } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_PUBLIC_KEY: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const { id: gpkNetId } = await getActiveNetwork()
        const gpkAllowed = await isAllowed(origin, pubkey, gpkNetId)
        if (!gpkAllowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }
        sendResponse({ result: { publicKey: pubkey, signerAddress: pubkey } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.REQUEST_ACCESS: {
        const requestedNetwork = typeof payload?.network === 'string' ? payload.network : undefined

        if (pendingConnectOrigins.has(origin)) {
          sendResponse({
            error: {
              code: 'ALREADY_PENDING',
              message: 'A connection request is already pending for this site',
            },
          })
          return
        }
        pendingConnectOrigins.add(origin)

        try {
          if (requestedNetwork != null) {
            const networks = await getNetworks()
            if (!networks.find((n) => n.id === requestedNetwork)) {
              sendResponse({
                error: {
                  code: 'NETWORK_NOT_FOUND',
                  message: `Network "${requestedNetwork}" is not configured in this wallet`,
                },
              })
              return
            }
          }

          const activeNetwork = await getActiveNetwork()
          const networkMismatch = requestedNetwork != null && requestedNetwork !== activeNetwork.id
          const grantNetworkId =
            networkMismatch && requestedNetwork ? requestedNetwork : activeNetwork.id

          const buildApprovalPath = () => {
            const p = new URLSearchParams({ id, origin })
            if (networkMismatch && requestedNetwork) {
              p.set('requestedNetwork', requestedNetwork)
              p.set('networkMismatch', 'true')
            }
            return `/grant-access?${p.toString()}`
          }

          const buildConnectResult = async (addr: string) => {
            if (networkMismatch && requestedNetwork) {
              await setActiveNetwork(requestedNetwork)
              notifyTabsWalletChanged()
              trackNetworkSwitched(requestedNetwork)
            }
            const finalNetwork = await getActiveNetwork()
            return {
              address: addr,
              network: finalNetwork.id,
              networkPassphrase: finalNetwork.passphrase,
            }
          }

          const rejectResponse = () =>
            networkMismatch
              ? {
                  error: {
                    code: 'NETWORK_MISMATCH',
                    message: `User declined switching to "${requestedNetwork}" network`,
                  },
                }
              : { error: { code: 'USER_REJECTED', message: 'User rejected the request' } }

          if (!pubkey) {
            const unlockedPubkey = await openAndWaitForUnlock()
            if (!unlockedPubkey) {
              sendResponse({
                error: { code: 'WALLET_LOCKED', message: 'Please unlock your wallet first' },
              })
              return
            }

            const alreadyAllowedAfterUnlock = await isAllowed(
              origin,
              unlockedPubkey,
              activeNetwork.id
            )
            if (alreadyAllowedAfterUnlock && !networkMismatch) {
              const result = await buildConnectResult(unlockedPubkey)
              sendResponse({ result })
              return
            }

            const approvedAfterUnlock = await waitForApproval(id, buildApprovalPath())
            if (approvedAfterUnlock) {
              // Always grant on grantNetworkId - networkMismatch means we may be granting on a
              // different network than the one alreadyAllowedAfterUnlock was checked against.
              const needsGrant = !alreadyAllowedAfterUnlock || networkMismatch
              if (needsGrant) await grantAccess(origin, unlockedPubkey, grantNetworkId)
              notifyTabsWalletChanged()
              trackConnect()
              const result = await buildConnectResult(unlockedPubkey)
              sendResponse({ result })
            } else {
              trackConnectRejected()
              sendResponse(rejectResponse())
            }
            return
          }

          const alreadyAllowed = await isAllowed(origin, pubkey, activeNetwork.id)
          if (alreadyAllowed && !networkMismatch) {
            const result = await buildConnectResult(pubkey)
            sendResponse({ result })
            return
          }

          const approved = await waitForApproval(id, buildApprovalPath())
          if (approved) {
            // Always grant on grantNetworkId - networkMismatch means we may be granting on a
            // different network than the one alreadyAllowed was checked against.
            const needsGrant = !alreadyAllowed || networkMismatch
            if (needsGrant) await grantAccess(origin, pubkey, grantNetworkId)
            notifyTabsWalletChanged()
            trackConnect()
            const result = await buildConnectResult(pubkey)
            sendResponse({ result })
          } else {
            trackConnectRejected()
            sendResponse(rejectResponse())
          }
        } finally {
          pendingConnectOrigins.delete(origin)
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_NETWORK: {
        const activeNetwork = await getActiveNetwork()
        sendResponse({
          result: {
            network: activeNetwork.id,
            networkPassphrase: activeNetwork.passphrase,
          },
        })
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_NETWORK_DETAILS: {
        const activeNetwork = await getActiveNetwork()
        sendResponse({
          result: {
            network: activeNetwork.id,
            networkName: activeNetwork.name,
            networkUrl: activeNetwork.horizonUrl,
            networkPassphrase: activeNetwork.passphrase,
            sorobanRpcUrl: activeNetwork.sorobanRpcUrl,
            friendbotUrl: activeNetwork.friendbotUrl,
          },
        })
        break
      }

      case EXTERNAL_SERVICE_TYPES.SIGN_TRANSACTION: {
        const txPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!txPubkey) return

        const sessionSecret = await getSessionSecret()
        if (!sessionSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const xdr = payload?.xdr as string
        if (!isNonEmptyString(xdr)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'xdr is required' } })
          return
        }

        const activeNetwork = await getActiveNetwork()
        const networkPassphrase = (payload?.networkPassphrase as string) ?? activeNetwork.passphrase

        // Store full XDR in session storage - approval window reads from there (no truncation)
        await storeApprovalPayload(id, { xdr, origin })
        const txParams = new URLSearchParams({ id, origin })
        const txApproved = await waitForApproval(id, `/sign-transaction?${txParams}`)
        await clearApprovalPayload(id)

        if (!txApproved) {
          trackSignRejected('transaction')
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase)
          const keypair = Keypair.fromSecret(sessionSecret)
          tx.sign(keypair)
          trackSign('transaction')
          sendResponse({
            result: { signedTxXdr: tx.toEnvelope().toXDR('base64'), signerAddress: txPubkey },
          })
        } catch {
          trackError('SIGN_FAILED')
          sendResponse({
            error: {
              code: 'SIGN_FAILED',
              message: 'Failed to sign transaction - invalid XDR or network passphrase',
            },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.SIGN_MESSAGE: {
        const msgPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!msgPubkey) return

        const sessionSecret = await getSessionSecret()
        if (!sessionSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const msg = payload?.message as string
        if (!isNonEmptyString(msg)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'message is required' } })
          return
        }

        await storeApprovalPayload(id, { message: msg, origin })
        const msgParams = new URLSearchParams({ id, origin })
        const msgApproved = await waitForApproval(id, `/sign-message?${msgParams}`)
        await clearApprovalPayload(id)

        if (!msgApproved) {
          trackSignRejected('message')
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const keypair = Keypair.fromSecret(sessionSecret)
          const msgBytes = new TextEncoder().encode(msg)
          const signature = keypair.sign(msgBytes)
          const signatureBase64 = btoa(String.fromCharCode(...signature))
          trackSign('message')
          sendResponse({ result: { signature: signatureBase64, signerAddress: msgPubkey } })
        } catch {
          trackError('SIGN_FAILED')
          sendResponse({ error: { code: 'SIGN_FAILED', message: 'Failed to sign message' } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.SUBMIT_TRANSACTION: {
        // Accept both 'xdr' (new SDK) and 'signedXdr' (legacy) for backward compat
        const signedXdr = (payload?.xdr ?? payload?.signedXdr) as string
        if (!isNonEmptyString(signedXdr)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'xdr is required' } })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const res = await fetch(`${activeNetwork.horizonUrl}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `tx=${encodeURIComponent(signedXdr)}`,
          })
          const data = (await res.json()) as {
            hash?: string
            extras?: { result_codes?: { transaction?: string } }
          }
          if (!res.ok) {
            const submitErrCode = data?.extras?.result_codes?.transaction ?? 'SUBMIT_FAILED'
            trackSubmitFailed(submitErrCode)
            sendResponse({
              error: { code: submitErrCode, message: 'Transaction submission failed' },
            })
            return
          }
          trackSubmit('submit')
          sendResponse({
            result: {
              txHash: data.hash,
              explorerUrl: getExplorerUrl(activeNetwork, data.hash ?? ''),
            },
          })
        } catch {
          trackError('SUBMIT_FAILED')
          sendResponse({
            error: { code: 'SUBMIT_FAILED', message: 'Failed to submit transaction' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.SIGN_AND_SUBMIT: {
        const sasPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!sasPubkey) return

        const sasSecret = await getSessionSecret()
        if (!sasSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const sasXdr = payload?.xdr as string
        if (!isNonEmptyString(sasXdr)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'xdr is required' } })
          return
        }

        const activeNetwork = await getActiveNetwork()
        const sasPassphrase = (payload?.networkPassphrase as string) ?? activeNetwork.passphrase

        await storeApprovalPayload(id, { xdr: sasXdr, origin })
        const sasParams = new URLSearchParams({ id, origin })
        const sasApproved = await waitForApproval(id, `/sign-transaction?${sasParams}`)
        await clearApprovalPayload(id)

        if (!sasApproved) {
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const tx = TransactionBuilder.fromXDR(sasXdr, sasPassphrase)
          const keypair = Keypair.fromSecret(sasSecret)
          tx.sign(keypair)
          const signedXdr = tx.toEnvelope().toXDR('base64')

          const res = await fetch(`${activeNetwork.horizonUrl}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `tx=${encodeURIComponent(signedXdr)}`,
          })
          const data = (await res.json()) as {
            hash?: string
            extras?: { result_codes?: { transaction?: string } }
          }
          if (!res.ok) {
            const sasErrCode = data?.extras?.result_codes?.transaction ?? 'SUBMIT_FAILED'
            trackSubmitFailed(sasErrCode)
            sendResponse({ error: { code: sasErrCode, message: 'Transaction submission failed' } })
            return
          }
          trackSubmit('sign_and_submit')
          sendResponse({
            result: {
              txHash: data.hash,
              explorerUrl: getExplorerUrl(activeNetwork, data.hash ?? ''),
            },
          })
        } catch {
          sendResponse({
            error: { code: 'SIGN_FAILED', message: 'Failed to sign or submit transaction' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.ADD_ASSET: {
        const aaPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!aaPubkey) return

        const aaSecret = await getSessionSecret()
        if (!aaSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const assetCode = payload?.assetCode as string
        // Accept both assetIssuer (new SDK) and issuer (legacy)
        const issuer = (payload?.assetIssuer ?? payload?.issuer) as string

        if (!isAssetCode(assetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'assetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (!isStellarAddress(issuer)) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'issuer must be a valid Stellar address' },
          })
          return
        }

        await storeApprovalPayload(id, { assetCode, issuer, origin })
        const aaParams = new URLSearchParams({ id, origin, assetCode, issuer })
        const aaApproved = await waitForApproval(id, `/add-asset?${aaParams}`)
        await clearApprovalPayload(id)

        if (!aaApproved) {
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${aaPubkey}`)
          if (!res.ok) throw new Error('Failed to load account')
          const accountData = (await res.json()) as { sequence: string }
          const account = new Account(aaPubkey, accountData.sequence)

          const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: activeNetwork.passphrase,
          })
            .addOperation(Operation.changeTrust({ asset: new Asset(assetCode, issuer) }))
            .setTimeout(activeNetwork.txTimeout ?? 90)
            .build()

          const keypair = Keypair.fromSecret(aaSecret)
          tx.sign(keypair)

          const submitRes = await fetch(`${activeNetwork.horizonUrl}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `tx=${encodeURIComponent(tx.toEnvelope().toXDR('base64'))}`,
          })
          const submitData = (await submitRes.json()) as {
            hash?: string
            extras?: { result_codes?: { transaction?: string } }
          }
          if (!submitRes.ok) {
            sendResponse({
              error: {
                code: submitData?.extras?.result_codes?.transaction ?? 'TRUSTLINE_FAILED',
                message: 'Failed to add trustline',
              },
            })
            return
          }
          sendResponse({ result: { txHash: submitData.hash } })
        } catch {
          sendResponse({
            error: { code: 'TRUSTLINE_FAILED', message: 'Failed to add asset trustline' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.ESTIMATE_FEE: {
        const feeXdr = payload?.xdr as string | undefined // XDR is optional - omit for classic fee estimate

        try {
          const activeNetwork = await getActiveNetwork()

          // If XDR provided and Soroban RPC available, try Soroban simulation for resource fee
          if (feeXdr && activeNetwork.sorobanRpcUrl) {
            try {
              const simRes = await fetch(activeNetwork.sorobanRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'simulateTransaction',
                  params: { transaction: feeXdr },
                }),
              })
              const simData = (await simRes.json()) as { result?: { minResourceFee?: string } }
              if (typeof simData.result?.minResourceFee === 'string') {
                sendResponse({
                  result: { fee: String(BASE_FEE), sorobanFee: simData.result.minResourceFee },
                })
                return
              }
            } catch {
              // Soroban simulation failed - fall through to classic fee_stats
            }
          }

          const feeRes = await fetch(`${activeNetwork.horizonUrl}/fee_stats`)
          const feeData = (await feeRes.json()) as { max_fee?: { mode?: string } }
          const mode = feeData?.max_fee?.mode
          const fee = typeof mode === 'string' && /^\d+$/.test(mode) ? mode : String(BASE_FEE)
          sendResponse({ result: { fee } })
        } catch {
          sendResponse({
            error: { code: 'FEE_ESTIMATE_FAILED', message: 'Failed to estimate fee' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.SIGN_AUTH_ENTRY: {
        const saePubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!saePubkey) return

        const saeSecret = await getSessionSecret()
        if (!saeSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const entryXdr = payload?.entryXdr as string
        if (!isNonEmptyString(entryXdr)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'entryXdr is required' } })
          return
        }

        const activeNetwork = await getActiveNetwork()
        const saePassphrase = (payload?.networkPassphrase as string) ?? activeNetwork.passphrase

        await storeApprovalPayload(id, { entryXdr, origin })
        const saeParams = new URLSearchParams({ id, origin })
        const saeApproved = await waitForApproval(id, `/sign-auth-entry?${saeParams}`)

        await clearApprovalPayload(id)

        if (!saeApproved) {
          trackSignRejected('authEntry')
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const { xdr: stellarXdr } = await import('@stellar/stellar-sdk')
          const keypair = Keypair.fromSecret(saeSecret)

          const entry = stellarXdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64')
          const preimage = stellarXdr.HashIdPreimage.fromXDR(
            stellarXdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
              new stellarXdr.HashIdPreimageSorobanAuthorization({
                networkId: Buffer.from(
                  new TextEncoder().encode(saePassphrase).slice(0, 32)
                ).subarray(0, 32),
                invocation: entry.credentials().address().invocation(),
                nonce: entry.credentials().address().nonce(),
                signatureExpirationLedger: entry
                  .credentials()
                  .address()
                  .signatureExpirationLedger(),
              })
            ).toXDR()
          )

          const hash = Buffer.from(await crypto.subtle.digest('SHA-256', preimage.toXDR()))
          const signature = keypair.sign(hash)

          entry
            .credentials()
            .address()
            .signature(
              stellarXdr.ScVal.scvMap([
                new stellarXdr.ScMapEntry({
                  key: stellarXdr.ScVal.scvSymbol('public_key'),
                  val: stellarXdr.ScVal.scvBytes(Buffer.from(keypair.rawPublicKey())),
                }),
                new stellarXdr.ScMapEntry({
                  key: stellarXdr.ScVal.scvSymbol('signature'),
                  val: stellarXdr.ScVal.scvBytes(Buffer.from(signature)),
                }),
              ])
            )

          const signedEntryXdr = entry.toXDR('base64')
          sendResponse({ result: { signedAuthEntry: signedEntryXdr, signerAddress: saePubkey } })
        } catch {
          sendResponse({
            error: {
              code: 'SIGN_FAILED',
              message: 'Failed to sign auth entry - invalid XDR or passphrase',
            },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.REMOVE_ASSET: {
        const raPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!raPubkey) return

        const raSecret = await getSessionSecret()
        if (!raSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const raAssetCode = payload?.assetCode as string
        const raIssuer = (payload?.assetIssuer ?? payload?.issuer) as string

        if (!isAssetCode(raAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'assetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (!isStellarAddress(raIssuer)) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'issuer must be a valid Stellar address' },
          })
          return
        }

        await storeApprovalPayload(id, { assetCode: raAssetCode, issuer: raIssuer, origin })
        const raParams = new URLSearchParams({
          id,
          origin,
          assetCode: raAssetCode,
          issuer: raIssuer,
        })
        const raApproved = await waitForApproval(id, `/remove-asset?${raParams}`)
        await clearApprovalPayload(id)

        if (!raApproved) {
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${raPubkey}`)
          if (!res.ok) throw new Error('Failed to load account')
          const accountData = (await res.json()) as { sequence: string }
          const account = new Account(raPubkey, accountData.sequence)

          const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: activeNetwork.passphrase,
          })
            .addOperation(
              Operation.changeTrust({ asset: new Asset(raAssetCode, raIssuer), limit: '0' })
            )
            .setTimeout(activeNetwork.txTimeout ?? 90)
            .build()

          const keypair = Keypair.fromSecret(raSecret)
          tx.sign(keypair)

          const submitRes = await fetch(`${activeNetwork.horizonUrl}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `tx=${encodeURIComponent(tx.toEnvelope().toXDR('base64'))}`,
          })
          const submitData = (await submitRes.json()) as {
            hash?: string
            extras?: { result_codes?: { transaction?: string } }
          }
          if (!submitRes.ok) {
            sendResponse({
              error: {
                code: submitData?.extras?.result_codes?.transaction ?? 'TRUSTLINE_FAILED',
                message: 'Failed to remove trustline',
              },
            })
            return
          }
          sendResponse({ result: { txHash: submitData.hash } })
        } catch {
          sendResponse({
            error: { code: 'TRUSTLINE_FAILED', message: 'Failed to remove asset trustline' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_ACCOUNT_INFO: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const activeNetwork = await getActiveNetwork()
        const aiAllowed = await isAllowed(origin, pubkey, activeNetwork.id)
        if (!aiAllowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }

        try {
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${pubkey}`)
          if (!res.ok) throw new Error('Account not found')
          const data = (await res.json()) as {
            account_id: string
            sequence: string
            subentry_count: number
            home_domain?: string
            balances: Array<{
              asset_type: string
              asset_code?: string
              asset_issuer?: string
              balance: string
              limit?: string
            }>
          }

          const balances = data.balances.map((b) => ({
            assetCode: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? ''),
            assetIssuer: b.asset_issuer ?? null,
            balance: b.balance,
            limit: b.limit ?? null,
          }))

          sendResponse({
            result: {
              address: data.account_id,
              sequence: data.sequence,
              balances,
              subentryCount: data.subentry_count,
              homeDomain: data.home_domain ?? null,
            },
          })
        } catch {
          sendResponse({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch account info' } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.REVOKE_ACCESS: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const { id: raNetId } = await getActiveNetwork()
        await revokeAccess(origin, pubkey, raNetId)
        notifyTabsWalletChanged()
        sendResponse({ result: { ok: true } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.REVOKE_ALL_ACCESS: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const { id: raaNetId } = await getActiveNetwork()
        await revokeAllAccess(pubkey, raaNetId)
        notifyTabsWalletChanged()
        sendResponse({ result: { ok: true } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.IS_ALLOWED: {
        if (!pubkey) {
          sendResponse({ result: { isAllowed: false } })
          return
        }
        const { id: iaNetId } = await getActiveNetwork()
        const allowed = await isAllowed(origin, pubkey, iaNetId)
        sendResponse({ result: { isAllowed: allowed } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.IS_CONNECTED_AND_ALLOWED: {
        const connected = !!pubkey
        const { id: icaNetId } = await getActiveNetwork()
        const allowed = connected ? await isAllowed(origin, pubkey!, icaNetId) : false
        const walletExists = await hasWallet()
        sendResponse({
          result: { isConnected: connected, isAllowed: allowed, hasWallet: walletExists },
        })
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_BALANCE: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const gbNetwork = await getActiveNetwork()
        const gbAllowed = await isAllowed(origin, pubkey, gbNetwork.id)
        if (!gbAllowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }
        try {
          const activeNetwork = gbNetwork
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${pubkey}`)
          if (!res.ok) throw new Error('Account not found')
          const data = (await res.json()) as {
            balances: Array<{
              asset_type: string
              asset_code?: string
              asset_issuer?: string
              balance: string
            }>
          }
          const assetCode = payload?.assetCode as string | undefined
          // Accept both assetIssuer (new SDK) and issuer (legacy)
          const issuer = (payload?.assetIssuer ?? payload?.issuer) as string | undefined
          let found: (typeof data.balances)[0] | undefined
          if (!assetCode || assetCode === 'XLM') {
            found = data.balances.find((b) => b.asset_type === 'native')
          } else {
            found = data.balances.find(
              (b) => b.asset_code === assetCode && b.asset_issuer === issuer
            )
          }
          if (!found) {
            sendResponse({
              error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found in wallet' },
            })
            return
          }
          sendResponse({
            result: {
              balance: found.balance,
              assetCode: found.asset_type === 'native' ? 'XLM' : (found.asset_code ?? ''),
              assetIssuer: found.asset_issuer ?? null,
            },
          })
        } catch {
          sendResponse({
            error: { code: 'FETCH_FAILED', message: 'Failed to fetch account balance' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_ASSETS: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const gaNetwork = await getActiveNetwork()
        const gaAllowed = await isAllowed(origin, pubkey, gaNetwork.id)
        if (!gaAllowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }
        try {
          const activeNetwork = gaNetwork
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${pubkey}`)
          if (!res.ok) throw new Error('Account not found')
          const data = (await res.json()) as {
            balances: Array<{
              asset_type: string
              asset_code?: string
              asset_issuer?: string
              balance: string
              limit?: string
            }>
          }
          const assets = data.balances.map((b) => ({
            assetCode: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? ''),
            assetIssuer: b.asset_issuer ?? null,
            balance: b.balance,
            limit: b.limit ?? null,
          }))
          sendResponse({ result: { assets } })
        } catch {
          sendResponse({
            error: { code: 'FETCH_FAILED', message: 'Failed to fetch account assets' },
          })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.HAS_TRUSTLINE: {
        if (!pubkey) {
          sendResponse({ error: { code: 'NOT_CONNECTED', message: 'Wallet is locked' } })
          return
        }
        const { id: htNetId } = await getActiveNetwork()
        const htAllowed = await isAllowed(origin, pubkey, htNetId)
        if (!htAllowed) {
          sendResponse({ error: { code: 'NOT_ALLOWED', message: 'Not connected to this site' } })
          return
        }
        const htAssetCode = payload?.assetCode as string
        const htIssuer = (payload?.assetIssuer ?? payload?.issuer) as string
        if (!isAssetCode(htAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'assetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (!isStellarAddress(htIssuer)) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'issuer must be a valid Stellar address' },
          })
          return
        }
        try {
          const activeNetwork = await getActiveNetwork()
          const res = await fetch(`${activeNetwork.horizonUrl}/accounts/${pubkey}`)
          if (!res.ok) throw new Error('Account not found')
          const data = (await res.json()) as {
            balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>
          }
          const found = data.balances.some(
            (b) => b.asset_code === htAssetCode && b.asset_issuer === htIssuer
          )
          sendResponse({ result: { hasTrustline: found } })
        } catch {
          sendResponse({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch account data' } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_TRANSACTION: {
        const txHash = payload?.txHash as string
        if (!TX_HASH_RE.test(txHash ?? '')) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'txHash must be a 64-character hex string' },
          })
          return
        }
        try {
          const activeNetwork = await getActiveNetwork()
          const res = await fetch(`${activeNetwork.horizonUrl}/transactions/${txHash}`)
          if (!res.ok) {
            sendResponse({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } })
            return
          }
          const data = (await res.json()) as {
            hash: string
            ledger: number
            created_at: string
            successful: boolean
            operation_count: number
            fee_charged: string
            memo?: string
            memo_type?: string
          }
          sendResponse({
            result: {
              txHash: data.hash,
              ledger: data.ledger,
              createdAt: data.created_at,
              successful: data.successful,
              operationCount: data.operation_count,
              feePaid: data.fee_charged,
              memo: data.memo ?? null,
              memoType: data.memo_type ?? null,
              explorerUrl: getExplorerUrl(activeNetwork, data.hash),
            },
          })
        } catch {
          sendResponse({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch transaction' } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.ADD_TOKEN: {
        const atPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!atPubkey) return

        const contractId = payload?.contractId as string
        if (!CONTRACT_RE.test(contractId ?? '')) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'contractId must be a valid Soroban contract address (C...)',
            },
          })
          return
        }

        await storeApprovalPayload(id, { contractId, origin })
        const atParams = new URLSearchParams({ id, origin })
        const atApproved = await waitForApproval(id, `/add-token?${atParams}`)
        await clearApprovalPayload(id)

        if (!atApproved) {
          sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
          return
        }
        sendResponse({ result: { contractId } })
        break
      }

      case EXTERNAL_SERVICE_TYPES.BUILD_PAYMENT_XDR: {
        const bpPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!bpPubkey) return

        const destination = payload?.destination as string
        const assetCode = payload?.assetCode as string
        const assetIssuer = payload?.assetIssuer as string | undefined
        const amount = payload?.amount as string
        const memo = payload?.memo as string | undefined
        const memoType = payload?.memoType as 'text' | 'id' | undefined
        const fee = payload?.fee as string | undefined
        const timeout = payload?.timeout as number | undefined

        if (!isStellarAddress(destination)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'destination must be a valid Stellar address',
            },
          })
          return
        }
        if (!isAssetCode(assetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'assetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (assetCode !== 'XLM' && !isStellarAddress(assetIssuer)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'assetIssuer is required for non-native assets',
            },
          })
          return
        }
        if (!isNonEmptyString(amount) || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'amount must be a positive decimal string' },
          })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const accountRes = await fetch(`${activeNetwork.horizonUrl}/accounts/${bpPubkey}`)
          if (!accountRes.ok) throw new Error('Failed to load account from Horizon')
          const accountData = (await accountRes.json()) as { sequence: string }
          const account = new Account(bpPubkey, accountData.sequence)

          const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer!)

          let txBuilder = new TransactionBuilder(account, {
            fee: fee ?? BASE_FEE,
            networkPassphrase: activeNetwork.passphrase,
          })
            .addOperation(Operation.payment({ destination, asset, amount }))
            .setTimeout(timeout ?? activeNetwork.txTimeout ?? 30)

          if (memo && memoType === 'text') txBuilder = txBuilder.addMemo(Memo.text(memo))
          else if (memo && memoType === 'id') txBuilder = txBuilder.addMemo(Memo.id(memo))

          const xdr = txBuilder.build().toEnvelope().toXDR('base64')
          sendResponse({ result: { xdr } })
        } catch (err) {
          sendResponse({ error: { code: 'BUILD_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.BUILD_PATH_PAYMENT_XDR: {
        const bppPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!bppPubkey) return

        const destination = payload?.destination as string
        const sendAssetCode = payload?.sendAssetCode as string
        const sendAssetIssuer = payload?.sendAssetIssuer as string | undefined
        const sendAmount = payload?.sendAmount as string
        const destAssetCode = payload?.destAssetCode as string
        const destAssetIssuer = payload?.destAssetIssuer as string | undefined
        const destMin = payload?.destMin as string
        const rawPath = payload?.path as
          | Array<{ assetCode: string; assetIssuer?: string }>
          | undefined
        const memo = payload?.memo as string | undefined
        const memoType = payload?.memoType as 'text' | 'id' | undefined
        const fee = payload?.fee as string | undefined
        const timeout = payload?.timeout as number | undefined

        if (!isStellarAddress(destination)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'destination must be a valid Stellar address',
            },
          })
          return
        }
        if (!isAssetCode(sendAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'sendAssetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (sendAssetCode !== 'XLM' && !isStellarAddress(sendAssetIssuer)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'sendAssetIssuer is required for non-native send asset',
            },
          })
          return
        }
        if (!isAssetCode(destAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'destAssetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (destAssetCode !== 'XLM' && !isStellarAddress(destAssetIssuer)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'destAssetIssuer is required for non-native dest asset',
            },
          })
          return
        }
        if (
          !isNonEmptyString(sendAmount) ||
          isNaN(parseFloat(sendAmount)) ||
          parseFloat(sendAmount) <= 0
        ) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'sendAmount must be a positive decimal string',
            },
          })
          return
        }
        if (!isNonEmptyString(destMin) || isNaN(parseFloat(destMin)) || parseFloat(destMin) < 0) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'destMin must be a non-negative decimal string',
            },
          })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const accountRes = await fetch(`${activeNetwork.horizonUrl}/accounts/${bppPubkey}`)
          if (!accountRes.ok) throw new Error('Failed to load account from Horizon')
          const accountData = (await accountRes.json()) as { sequence: string }
          const account = new Account(bppPubkey, accountData.sequence)

          const sendAsset =
            sendAssetCode === 'XLM' ? Asset.native() : new Asset(sendAssetCode, sendAssetIssuer!)
          const destAsset =
            destAssetCode === 'XLM' ? Asset.native() : new Asset(destAssetCode, destAssetIssuer!)
          const path = (rawPath ?? []).map((p) =>
            p.assetCode === 'XLM' ? Asset.native() : new Asset(p.assetCode, p.assetIssuer!)
          )

          let txBuilder = new TransactionBuilder(account, {
            fee: fee ?? BASE_FEE,
            networkPassphrase: activeNetwork.passphrase,
          })
            .addOperation(
              Operation.pathPaymentStrictSend({
                sendAsset,
                sendAmount,
                destination,
                destAsset,
                destMin,
                path,
              })
            )
            .setTimeout(timeout ?? activeNetwork.txTimeout ?? 30)

          if (memo && memoType === 'text') txBuilder = txBuilder.addMemo(Memo.text(memo))
          else if (memo && memoType === 'id') txBuilder = txBuilder.addMemo(Memo.id(memo))

          const xdr = txBuilder.build().toEnvelope().toXDR('base64')
          sendResponse({ result: { xdr } })
        } catch (err) {
          sendResponse({ error: { code: 'BUILD_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.BUILD_MANAGE_OFFER_XDR: {
        const bmoPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!bmoPubkey) return

        const sellingAssetCode = payload?.sellingAssetCode as string
        const sellingAssetIssuer = payload?.sellingAssetIssuer as string | undefined
        const buyingAssetCode = payload?.buyingAssetCode as string
        const buyingAssetIssuer = payload?.buyingAssetIssuer as string | undefined
        const amount = payload?.amount as string
        const price = payload?.price as string
        const offerId = (payload?.offerId as string | undefined) ?? '0'
        const fee = payload?.fee as string | undefined
        const timeout = payload?.timeout as number | undefined

        if (!isAssetCode(sellingAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'sellingAssetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (sellingAssetCode !== 'XLM' && !isStellarAddress(sellingAssetIssuer)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'sellingAssetIssuer is required for non-native selling asset',
            },
          })
          return
        }
        if (!isAssetCode(buyingAssetCode)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'buyingAssetCode must be 1-12 alphanumeric characters',
            },
          })
          return
        }
        if (buyingAssetCode !== 'XLM' && !isStellarAddress(buyingAssetIssuer)) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'buyingAssetIssuer is required for non-native buying asset',
            },
          })
          return
        }
        if (!isNonEmptyString(amount) || isNaN(parseFloat(amount)) || parseFloat(amount) < 0) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'amount must be a non-negative decimal string ("0" to delete offer)',
            },
          })
          return
        }
        if (!isNonEmptyString(price) || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'price must be a positive decimal string' },
          })
          return
        }
        if (!/^\d+$/.test(offerId) || parseInt(offerId, 10) < 0) {
          sendResponse({
            error: {
              code: 'INVALID_PARAMS',
              message: 'offerId must be a non-negative integer string',
            },
          })
          return
        }

        try {
          const activeNetwork = await getActiveNetwork()
          const accountRes = await fetch(`${activeNetwork.horizonUrl}/accounts/${bmoPubkey}`)
          if (!accountRes.ok) throw new Error('Failed to load account from Horizon')
          const accountData = (await accountRes.json()) as { sequence: string }
          const account = new Account(bmoPubkey, accountData.sequence)

          const selling =
            sellingAssetCode === 'XLM'
              ? Asset.native()
              : new Asset(sellingAssetCode, sellingAssetIssuer!)
          const buying =
            buyingAssetCode === 'XLM'
              ? Asset.native()
              : new Asset(buyingAssetCode, buyingAssetIssuer!)

          const tx = new TransactionBuilder(account, {
            fee: fee ?? BASE_FEE,
            networkPassphrase: activeNetwork.passphrase,
          })
            .addOperation(
              Operation.manageSellOffer({
                selling,
                buying,
                amount,
                price,
                offerId,
              })
            )
            .setTimeout(timeout ?? activeNetwork.txTimeout ?? 30)
            .build()

          const xdr = tx.toEnvelope().toXDR('base64')
          sendResponse({ result: { xdr } })
        } catch (err) {
          sendResponse({ error: { code: 'BUILD_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.READ_CONTRACT: {
        const rcPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!rcPubkey) return

        const rcContractId = payload?.contractId as string
        const rcMethod = payload?.method as string
        const rcArgSpecs = (payload?.args ?? []) as ScValSpec[]

        if (!isNonEmptyString(rcContractId)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'contractId is required' } })
          return
        }
        if (!isNonEmptyString(rcMethod)) {
          sendResponse({ error: { code: 'INVALID_PARAMS', message: 'method is required' } })
          return
        }

        try {
          const rcNetwork = await getActiveNetwork()
          if (!rcNetwork.sorobanRpcUrl) {
            sendResponse({
              error: {
                code: 'NOT_SUPPORTED',
                message: 'Soroban RPC not configured for this network',
              },
            })
            return
          }

          const rcScArgs = rcArgSpecs.map(scValSpecToXdr)
          const rcOp = new Contract(rcContractId).call(rcMethod, ...rcScArgs)
          const rcAccountRes = await fetch(`${rcNetwork.horizonUrl}/accounts/${rcPubkey}`)
          if (!rcAccountRes.ok) throw new Error('Failed to load account')
          const rcAccountData = (await rcAccountRes.json()) as { sequence: string }
          const rcAccount = new Account(rcPubkey, rcAccountData.sequence)

          const rcBaseTx = new TransactionBuilder(rcAccount, {
            fee: BASE_FEE,
            networkPassphrase: rcNetwork.passphrase,
          })
            .addOperation(rcOp)
            .setTimeout(0)
            .build()

          const rcSim = await sorobanSimulate(
            rcNetwork.sorobanRpcUrl,
            rcBaseTx.toEnvelope().toXDR('base64')
          )
          if (!rcSim) {
            sendResponse({
              error: { code: 'SIMULATE_FAILED', message: 'Soroban simulation failed' },
            })
            return
          }
          if (rcSim.error) {
            sendResponse({ error: { code: 'CONTRACT_ERROR', message: rcSim.error } })
            return
          }

          const rcResultXdr = rcSim.results?.[0]?.xdr ?? ''
          trackContractInvoked('read')
          sendResponse({
            result: { result: decodeScValResult(rcResultXdr), resultXdr: rcResultXdr },
          })
        } catch (err) {
          sendResponse({ error: { code: 'READ_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.SIMULATE_CONTRACT: {
        // Read-only simulation needs no signing: use the session pubkey if unlocked, else a placeholder
        // (the sequence number does not affect simulation output).
        const scContractId = payload?.contractId as string
        const scMethod = payload?.method as string
        const scArgSpecs = (payload?.args ?? []) as ScValSpec[]

        if (!isNonEmptyString(scContractId) || !isNonEmptyString(scMethod)) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'contractId and method are required' },
          })
          return
        }

        try {
          const scNetwork = await getActiveNetwork()
          if (!scNetwork.sorobanRpcUrl) {
            sendResponse({
              error: {
                code: 'NOT_SUPPORTED',
                message: 'Soroban RPC not configured for this network',
              },
            })
            return
          }

          const scArgs = scArgSpecs.map(scValSpecToXdr)
          const scOp = new Contract(scContractId).call(scMethod, ...scArgs)
          const scAccount = new Account(pubkey ?? Keypair.random().publicKey(), '0')

          const scBaseTx = new TransactionBuilder(scAccount, {
            fee: BASE_FEE,
            networkPassphrase: scNetwork.passphrase,
          })
            .addOperation(scOp)
            .setTimeout(0)
            .build()

          const [scSim, scFeeStatsRes] = await Promise.all([
            sorobanSimulate(scNetwork.sorobanRpcUrl, scBaseTx.toEnvelope().toXDR('base64')),
            fetch(`${scNetwork.horizonUrl}/fee_stats`).catch(() => null),
          ])
          let scBaseFee = parseInt(BASE_FEE, 10)
          if (scFeeStatsRes?.ok) {
            const fd = (await scFeeStatsRes.json()) as { last_ledger_base_fee?: string }
            const lb = fd.last_ledger_base_fee
            if (typeof lb === 'string' && /^\d+$/.test(lb)) scBaseFee = parseInt(lb, 10)
          }
          const scResultXdr = scSim?.results?.[0]?.xdr ?? ''
          const scResourceFee = parseInt(scSim?.minResourceFee ?? '0', 10)
          const scTotalFee = String(scBaseFee + scResourceFee)

          // Detect state-changing by checking readWrite footprint entries
          let scStateChanging = false
          if (scSim?.transactionData) {
            try {
              const scFootprint = xdr.SorobanTransactionData.fromXDR(
                scSim.transactionData,
                'base64'
              )
                .resources()
                .footprint()
                .readWrite()
              scStateChanging = scFootprint.length > 0
            } catch {
              /* fallback: unknown */
            }
          }

          trackContractInvoked('simulate')
          sendResponse({
            result: {
              success: !scSim?.error,
              result: scResultXdr ? decodeScValResult(scResultXdr) : undefined,
              resultXdr: scResultXdr || undefined,
              fee: scTotalFee,
              minResourceFee: scSim?.minResourceFee,
              error: scSim?.error,
              requiresAuth: (scSim?.auth ?? []).length > 0,
              stateChanging: scStateChanging,
            },
          })
        } catch (err) {
          sendResponse({ error: { code: 'SIMULATE_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.INVOKE_CONTRACT: {
        const icPubkey = await requireUnlockedAndAllowed(pubkey, origin, sendResponse)
        if (!icPubkey) return

        const icSecret = await getSessionSecret()
        if (!icSecret) {
          sendResponse({ error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } })
          return
        }

        const icContractId = payload?.contractId as string
        const icMethod = payload?.method as string
        const icArgSpecs = (payload?.args ?? []) as ScValSpec[]

        if (!isNonEmptyString(icContractId) || !isNonEmptyString(icMethod)) {
          sendResponse({
            error: { code: 'INVALID_PARAMS', message: 'contractId and method are required' },
          })
          return
        }

        try {
          const icNetwork = await getActiveNetwork()
          if (!icNetwork.sorobanRpcUrl) {
            sendResponse({
              error: {
                code: 'NOT_SUPPORTED',
                message: 'Soroban RPC not configured for this network',
              },
            })
            return
          }

          const icArgs = icArgSpecs.map(scValSpecToXdr)
          const icOp = new Contract(icContractId).call(icMethod, ...icArgs)
          const icAccountRes = await fetch(`${icNetwork.horizonUrl}/accounts/${icPubkey}`)
          if (!icAccountRes.ok) throw new Error('Failed to load account')
          const icAccountData = (await icAccountRes.json()) as { sequence: string }
          const icAccount = new Account(icPubkey, icAccountData.sequence)

          const icBaseTx = new TransactionBuilder(icAccount, {
            fee: BASE_FEE,
            networkPassphrase: icNetwork.passphrase,
          })
            .addOperation(icOp)
            .setTimeout(icNetwork.txTimeout ?? 90)
            .build()

          // Simulate to get resource footprint + fees
          const icSim = await sorobanSimulate(
            icNetwork.sorobanRpcUrl,
            icBaseTx.toEnvelope().toXDR('base64')
          )
          if (!icSim) {
            sendResponse({
              error: { code: 'SIMULATE_FAILED', message: 'Soroban simulation failed' },
            })
            return
          }
          if (icSim.error) {
            sendResponse({ error: { code: 'CONTRACT_ERROR', message: icSim.error } })
            return
          }

          const icAssembledTx = assembleTx(icBaseTx, icSim)
          const icAssembledXdr = icAssembledTx.toEnvelope().toXDR('base64')

          await storeApprovalPayload(id, {
            xdr: icAssembledXdr,
            contractId: icContractId,
            method: icMethod,
            origin,
          })
          const icParams = new URLSearchParams({ id, origin })
          const icApproved = await waitForApproval(id, `/sign-transaction?${icParams}`)
          await clearApprovalPayload(id)

          if (!icApproved) {
            sendResponse({ error: { code: 'USER_REJECTED', message: 'User rejected the request' } })
            return
          }

          const icKeypair = Keypair.fromSecret(icSecret)
          icAssembledTx.sign(icKeypair)
          const icSignedXdr = icAssembledTx.toEnvelope().toXDR('base64')

          // Submit via Soroban RPC sendTransaction
          const icSendRes = await fetch(icNetwork.sorobanRpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendTransaction',
              params: { transaction: icSignedXdr },
            }),
          })
          const icSendData = (await icSendRes.json()) as {
            result?: { hash?: string; status?: string; errorResultXdr?: string }
            error?: { message: string }
          }

          if (icSendData.error || !icSendData.result?.hash) {
            sendResponse({
              error: {
                code: 'SUBMIT_FAILED',
                message: icSendData.error?.message ?? 'Failed to send transaction',
              },
            })
            return
          }

          const icHash = icSendData.result.hash

          // Poll getTransaction until confirmed (max 30 attempts, 2s apart = 60s)
          let icResultXdr: string | undefined
          const icRpcServer = new SorobanRpc.Server(icNetwork.sorobanRpcUrl)
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 2000))
            const icPoll = await icRpcServer.getTransaction(icHash)
            if (icPoll.status === 'SUCCESS') {
              if (icPoll.returnValue) {
                icResultXdr = icPoll.returnValue.toXDR('base64')
              }
              break
            }
            if (icPoll.status === 'FAILED') {
              sendResponse({ error: { code: 'TX_FAILED', message: 'Transaction failed on-chain' } })
              return
            }
            // NOT_FOUND - transaction still processing, keep polling
          }

          trackContractInvoked('invoke')
          sendResponse({
            result: {
              txHash: icHash,
              explorerUrl: getExplorerUrl(icNetwork, icHash),
              result: icResultXdr ? decodeScValResult(icResultXdr) : undefined,
              resultXdr: icResultXdr,
            },
          })
        } catch (err) {
          sendResponse({ error: { code: 'INVOKE_FAILED', message: (err as Error).message } })
        }
        break
      }

      case EXTERNAL_SERVICE_TYPES.GET_CONTRACT_SPEC: {
        try {
          const contractId = payload?.contractId as string
          if (!isNonEmptyString(contractId)) {
            sendResponse({ error: { code: 'INVALID_PARAMS', message: 'contractId is required' } })
            return
          }
          const gcNetwork = await getActiveNetwork()
          if (!gcNetwork.sorobanRpcUrl) {
            sendResponse({
              error: {
                code: 'NO_SOROBAN_RPC',
                message: 'No Soroban RPC URL configured for this network',
              },
            })
            return
          }

          const gcServer = new SorobanRpc.Server(gcNetwork.sorobanRpcUrl)
          const gcContract = new Contract(contractId)

          const instanceKey = xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
              contract: gcContract.address().toScAddress(),
              key: xdr.ScVal.scvLedgerKeyContractInstance(),
              durability: xdr.ContractDataDurability.persistent(),
            })
          )
          const instanceRes = await gcServer.getLedgerEntries(instanceKey)
          if (!instanceRes.entries.length) {
            sendResponse({
              error: { code: 'CONTRACT_NOT_FOUND', message: 'Contract not found on this network' },
            })
            return
          }

          const executable = instanceRes.entries[0].val.contractData().val().instance().executable()
          if (executable.switch().name !== 'contractExecutableWasm') {
            sendResponse({ error: { code: 'INVALID_CONTRACT', message: 'Not a WASM contract' } })
            return
          }

          const wasmHash = executable.wasmHash()
          const codeKey = xdr.LedgerKey.contractCode(
            new xdr.LedgerKeyContractCode({ hash: wasmHash })
          )
          const codeRes = await gcServer.getLedgerEntries(codeKey)
          const wasmBytes = codeRes.entries[0].val.contractCode().code()

          const spec = StellarContract.Spec.fromWasm(wasmBytes)

          const functions = spec.funcs().map((f: any) => ({
            name: f.name().toString(),
            doc: f.doc().toString().trim() || undefined,
            inputs: f.inputs().map((i: any) => ({
              name: i.name().toString(),
              type: formatSpecType(i.type()),
              doc: i.doc().toString().trim() || undefined,
            })),
            outputs: (f.outputs() as any[]).map(formatSpecType),
          }))

          const structKind = xdr.ScSpecEntryKind.scSpecEntryUdtStructV0().value
          const enumKind = xdr.ScSpecEntryKind.scSpecEntryUdtEnumV0().value
          const unionKind = xdr.ScSpecEntryKind.scSpecEntryUdtUnionV0().value
          const voidCaseKind = xdr.ScSpecUdtUnionCaseV0Kind.scSpecUdtUnionCaseVoidV0().value

          const structs = (spec.entries as any[])
            .filter((e: any) => e.switch().value === structKind)
            .map((e: any) => {
              const s = e.udtStructV0()
              return {
                name: s.name().toString(),
                doc: s.doc()?.toString().trim() || undefined,
                fields: (s.fields() as any[]).map((field: any) => ({
                  name: field.name().toString(),
                  type: formatSpecType(field.type()),
                  doc: field.doc()?.toString().trim() || undefined,
                })),
              }
            })

          const enums = (spec.entries as any[])
            .filter((e: any) => e.switch().value === enumKind)
            .map((e: any) => {
              const en = e.udtEnumV0()
              return {
                name: en.name().toString(),
                doc: en.doc()?.toString().trim() || undefined,
                cases: (en.cases() as any[]).map((c: any) => ({
                  name: c.name().toString(),
                  value: c.value() as number,
                })),
              }
            })

          const unions = (spec.entries as any[])
            .filter((e: any) => e.switch().value === unionKind)
            .map((e: any) => {
              const u = e.udtUnionV0()
              return {
                name: u.name().toString(),
                doc: u.doc()?.toString().trim() || undefined,
                cases: (u.cases() as any[]).map((c: any) => {
                  const isVoid = c.switch().value === voidCaseKind
                  const name = c.value().name().toString()
                  if (isVoid) return { name, types: [] as string[] }
                  const types = (c.tupleCase().type() as any[]).map(formatSpecType)
                  return { name, types }
                }),
              }
            })

          sendResponse({ result: { functions, structs, enums, unions } })
        } catch (err) {
          sendResponse({ error: { code: 'SPEC_FETCH_FAILED', message: (err as Error).message } })
        }
        break
      }

      default:
        sendResponse({ error: { code: 'UNKNOWN_METHOD', message: 'Unknown method' } })
    }
  } catch (err) {
    sendResponse({
      error: { code: 'EXTENSION_ERROR', message: (err as Error)?.message ?? 'Unexpected error' },
    })
  }
}

async function getFailedAttempts(): Promise<number> {
  const result = await chrome.storage.local.get(FAILED_ATTEMPTS_KEY)
  return result[FAILED_ATTEMPTS_KEY] ?? 0
}

async function getLockedUntil(): Promise<number> {
  const result = await chrome.storage.local.get(LOCKED_UNTIL_KEY)
  return result[LOCKED_UNTIL_KEY] ?? 0
}

async function incrementFailedAttempts(): Promise<number> {
  const attempts = (await getFailedAttempts()) + 1
  await chrome.storage.local.set({ [FAILED_ATTEMPTS_KEY]: attempts })

  if (attempts >= PASSWORD_RULES.MAX_ATTEMPTS) {
    const lockedUntil = Date.now() + PASSWORD_RULES.LOCKOUT_MINUTES * 60 * 1000
    await chrome.storage.local.set({ [LOCKED_UNTIL_KEY]: lockedUntil })
  }

  return attempts
}

async function resetFailedAttempts(): Promise<void> {
  await chrome.storage.local.remove([FAILED_ATTEMPTS_KEY, LOCKED_UNTIL_KEY])
}

async function checkLockout(): Promise<{ locked: boolean; minutesLeft?: number }> {
  const lockedUntil = await getLockedUntil()
  if (!lockedUntil) return { locked: false }

  const now = Date.now()
  if (now < lockedUntil) {
    const minutesLeft = Math.ceil((lockedUntil - now) / 60000)
    return { locked: true, minutesLeft }
  }

  await resetFailedAttempts()
  return { locked: false }
}

// Build, sign, submit, and confirm a contract call signed by the active account. Mirrors the
// INVOKE_CONTRACT path without an approval window: the private-send confirm screen is the approval.
async function invokeSignedContract(
  net: NetworkConfig,
  secret: string,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  onBroadcast?: (hash: string) => Promise<void>,
  // Inclusion-fee bid in stroops; defaults to the base fee. A commit passes a congestion-aware value
  // so it is not outbid when the network is busy.
  inclusionFee?: string,
  // Reports the confirmed tx's fee_charged (stroops) on SUCCESS so the caller can persist the exact cost; not fired on the broadcast-but-unconfirmed path.
  onConfirmed?: (feeStroops: string) => void
): Promise<string> {
  if (!net.sorobanRpcUrl) {
    throw new Error('Soroban RPC not configured for this network')
  }
  const op = new Contract(contractId).call(method, ...args)
  const accountRes = await fetch(`${net.horizonUrl}/accounts/${source}`)
  if (!accountRes.ok) throw new Error('Failed to load account')
  const accountData = (await accountRes.json()) as { sequence: string }
  const baseTx = new TransactionBuilder(new Account(source, accountData.sequence), {
    fee: inclusionFee ?? BASE_FEE,
    networkPassphrase: net.passphrase,
  })
    .addOperation(op)
    .setTimeout(net.txTimeout ?? 90)
    .build()

  const sim = await sorobanSimulate(net.sorobanRpcUrl, baseTx.toEnvelope().toXDR('base64'))
  if (!sim) throw new Error('Soroban simulation failed')
  if (sim.error) throw new Error(sim.error)

  const baseFee = parseInt(baseTx.fee, 10)
  const resourceFee = parseInt(sim.minResourceFee ?? '0', 10)
  const builder = TransactionBuilder.cloneFrom(baseTx, { fee: String(baseFee + resourceFee) })
  if (sim.transactionData) {
    builder.setSorobanData(new SorobanDataBuilder(sim.transactionData).build())
  }
  // Soroban RPC returns auth under results[0].auth, not the top level. commit's auth is the source
  // account, satisfied by the envelope signature; attach it or require_auth traps on-chain.
  const auth = (sim.results?.[0]?.auth ?? []).map((a) =>
    xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64')
  )
  builder.clearOperations()
  const baseOp = baseTx.operations[0] as ReturnType<typeof Operation.invokeHostFunction>
  builder.addOperation(Operation.invokeHostFunction({ ...baseOp, auth }))
  const assembled = builder.build()
  assembled.sign(Keypair.fromSecret(secret))

  const sendRes = await fetch(net.sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: assembled.toEnvelope().toXDR('base64') },
    }),
  })
  const sendData = (await sendRes.json()) as {
    result?: { hash?: string }
    error?: { message: string }
  }
  if (sendData.error || !sendData.result?.hash) {
    throw new Error(sendData.error?.message ?? 'Failed to send transaction')
  }
  const hash = sendData.result.hash
  // Surface the hash before the slow confirmation poll so the caller can persist it and avoid
  // resubmitting if the worker is killed mid-confirmation.
  if (onBroadcast) {
    await onBroadcast(hash)
  }

  const server = new SorobanRpc.Server(net.sorobanRpcUrl)
  const attempts = Math.ceil((net.txTimeout ?? 90) / 2)
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await server.getTransaction(hash)
    if (poll.status === 'SUCCESS') {
      if (onConfirmed) {
        try {
          const result = (poll as { resultXdr?: { feeCharged(): { toString(): string } } })
            .resultXdr
          if (result) {
            onConfirmed(result.feeCharged().toString())
          }
        } catch {
          /* the fee is a display-only extra; a parse miss just falls back to a Horizon fetch */
        }
      }
      return hash
    }
    if (poll.status === 'FAILED') {
      let detail = ''
      try {
        detail = `: ${(poll as { resultXdr?: { toXDR(f: string): string } }).resultXdr?.toXDR('base64') ?? ''}`
      } catch {
        /* ignore */
      }
      throw new Error(`Transaction failed on-chain ${hash}${detail}`)
    }
  }
  // Broadcast but unconfirmed: the commit may still land, so return the hash and let the caller
  // reconcile against the relayer's indexed leaves.
  return hash
}

async function handleService(message: ServicePayload, sendResponse: (r: ServiceResponse) => void) {
  switch (message.type) {
    case SERVICE_TYPES.CREATE_WALLET: {
      if (!message.password) {
        sendResponse({ error: 'Password required' })
        return
      }
      const mnemonic = generateMnemonic()
      const { secret } = await deriveKeypairRaw(mnemonic, 0)
      const keypair = Keypair.fromSecret(secret)
      const publicKey = keypair.publicKey()
      await encryptAndStoreMnemonic(mnemonic, message.password)
      await saveAccountsStore({
        accounts: [{ index: 0, publicKey, label: 'Account 1', walletId: 'primary' }],
        activeIndex: 0,
        activePublicKey: publicKey,
      })
      await chrome.storage.session?.set({ [SESSION_KEY]: publicKey })
      await storeSessionSecret(secret)
      await storeSessionMnemonic(mnemonic)
      await resetFailedAttempts()
      sendResponse({ publicKey, mnemonic })
      break
    }

    case SERVICE_TYPES.IMPORT_WALLET: {
      if (!message.password || !message.mnemonic) {
        sendResponse({ error: 'Password and mnemonic required' })
        return
      }
      const { secret } = await deriveKeypairRaw(message.mnemonic, 0)
      const keypair = Keypair.fromSecret(secret)
      const publicKey = keypair.publicKey()
      await encryptAndStoreMnemonic(message.mnemonic, message.password)
      await saveAccountsStore({
        accounts: [{ index: 0, publicKey, label: 'Account 1', walletId: 'primary' }],
        activeIndex: 0,
        activePublicKey: publicKey,
      })
      await chrome.storage.session?.set({ [SESSION_KEY]: publicKey })
      await storeSessionSecret(secret)
      await storeSessionMnemonic(message.mnemonic)
      await resetFailedAttempts()
      sendResponse({ publicKey })
      break
    }

    case SERVICE_TYPES.UNLOCK_WALLET: {
      if (!message.password) {
        sendResponse({ error: 'Password required' })
        return
      }

      const lockout = await checkLockout()
      if (lockout.locked) {
        sendResponse({
          error: `Too many attempts. Try again in ${lockout.minutesLeft} minute${lockout.minutesLeft === 1 ? '' : 's'}`,
        })
        return
      }

      // Try new format (encrypted mnemonic) first
      const mnemonic = await decryptMnemonic(message.password)
      if (mnemonic) {
        let store = await getAccountsStore()

        // Migration: add walletId='primary' to accounts that predate multi-wallet
        let needsSave = false
        for (const account of store.accounts) {
          if (!(account as any).walletId) {
            ;(account as any).walletId = 'primary'
            needsSave = true
          }
        }

        // Migration: populate accounts store if empty
        if (store.accounts.length === 0) {
          const { secret: s0 } = await deriveKeypairRaw(mnemonic, 0)
          const pk0 = Keypair.fromSecret(s0).publicKey()
          store = {
            accounts: [{ index: 0, publicKey: pk0, label: 'Account 1', walletId: 'primary' }],
            activeIndex: 0,
            activePublicKey: pk0,
          }
          await saveAccountsStore(store)
          needsSave = false
        } else if (!store.activePublicKey) {
          const defaultActive =
            store.accounts.find((a) => a.index === (store.activeIndex ?? 0)) ?? store.accounts[0]
          if (defaultActive) store.activePublicKey = defaultActive.publicKey
          needsSave = true
        }
        if (needsSave) await saveAccountsStore(store)

        const hdWallets = await getHDWallets()
        const extraMnemonics: Record<string, string> = {}
        for (const hw of hdWallets) {
          const m = await decryptString(hw.encryptedMnemonic, message.password)
          if (m) extraMnemonics[hw.id] = m
        }
        await storeSessionExtraHDMnemonics(extraMnemonics)

        const importedKeys = await getImportedKeys()
        const importedSecrets: Record<string, string> = {}
        for (const ik of importedKeys) {
          const s = await decryptString(ik.encryptedSecret, message.password)
          if (s) importedSecrets[ik.id] = s
        }
        await storeSessionImportedSecrets(importedSecrets)

        const activeAccount =
          store.accounts.find((a) => a.publicKey === store.activePublicKey) ??
          store.accounts.find(
            (a) => a.index === (store.activeIndex ?? 0) && (!a.walletId || a.walletId === 'primary')
          ) ??
          store.accounts[0]

        let activeSecret: string
        let activePublicKey: string
        // Set when the active account's key is missing and primary is used instead; the stored active
        // account is realigned below so session and UI never diverge.
        let coercedToPrimary = false

        if (!activeAccount || !activeAccount.walletId || activeAccount.walletId === 'primary') {
          const { secret } = await deriveKeypairRaw(mnemonic, activeAccount?.index ?? 0)
          activeSecret = secret
          activePublicKey = Keypair.fromSecret(secret).publicKey()
        } else if (activeAccount.walletId.startsWith('sk:')) {
          const importedSecret = importedSecrets[activeAccount.walletId]
          if (importedSecret) {
            activeSecret = importedSecret
            activePublicKey = activeAccount.publicKey
          } else {
            const { secret } = await deriveKeypairRaw(mnemonic, 0)
            activeSecret = secret
            activePublicKey = Keypair.fromSecret(secret).publicKey()
            coercedToPrimary = true
          }
        } else {
          const extraMnemonic = extraMnemonics[activeAccount.walletId]
          if (extraMnemonic) {
            const { secret } = await deriveKeypairRaw(extraMnemonic, activeAccount.index)
            activeSecret = secret
            activePublicKey = Keypair.fromSecret(secret).publicKey()
          } else {
            const { secret } = await deriveKeypairRaw(mnemonic, 0)
            activeSecret = secret
            activePublicKey = Keypair.fromSecret(secret).publicKey()
            coercedToPrimary = true
          }
        }

        // Match the stored active account, or the session signs as primary while the UI shows the
        // unreachable account and a send silently spends primary's funds.
        if (coercedToPrimary && store.activePublicKey !== activePublicKey) {
          store.activePublicKey = activePublicKey
          await saveAccountsStore(store)
        }

        await chrome.storage.session?.set({ [SESSION_KEY]: activePublicKey })
        await storeSessionSecret(activeSecret)
        await storeSessionMnemonic(mnemonic)
        await resetFailedAttempts()
        sendResponse({ publicKey: activePublicKey, isUnlocked: true })
        break
      }

      // Legacy format fallback (single account, no mnemonic stored)
      const secret = await decryptSecret(message.password)
      if (!secret) {
        const attempts = await incrementFailedAttempts()
        const remaining = PASSWORD_RULES.MAX_ATTEMPTS - attempts
        if (remaining <= 0) {
          sendResponse({
            error: `Too many attempts. Wallet locked for ${PASSWORD_RULES.LOCKOUT_MINUTES} minutes`,
          })
        } else {
          sendResponse({
            error: `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining`,
          })
        }
        return
      }

      const keypair = Keypair.fromSecret(secret)
      const publicKey = keypair.publicKey()
      await chrome.storage.session?.set({ [SESSION_KEY]: publicKey })
      await storeSessionSecret(secret)
      const legacyStore = await getAccountsStore()
      if (legacyStore.accounts.length === 0) {
        await saveAccountsStore({
          accounts: [{ index: 0, publicKey, label: 'Account 1', walletId: 'primary' }],
          activeIndex: 0,
          activePublicKey: publicKey,
        })
      }
      await resetFailedAttempts()
      upgradeEncryptionIfNeeded(message.password).catch(() => {})
      sendResponse({ publicKey, isUnlocked: true })
      break
    }

    case SERVICE_TYPES.LOCK_WALLET: {
      await chrome.storage.session?.remove(SESSION_KEY)
      await clearSessionSecret()
      await clearSessionMnemonic()
      await clearSessionExtraHDMnemonics()
      await clearSessionImportedSecrets()
      notifyTabsWalletChanged()
      sendResponse({ isUnlocked: false })
      break
    }

    case SERVICE_TYPES.RESET_WALLET: {
      if (message.password) {
        const isValid = await verifyPassword(message.password)
        if (!isValid) {
          sendResponse({ error: 'Incorrect password' })
          return
        }
      }
      await chrome.storage.session?.remove(SESSION_KEY)
      await clearSessionSecret()
      await clearSessionMnemonic()
      await clearSessionExtraHDMnemonics()
      await clearSessionImportedSecrets()
      await clearWallet()
      await chrome.storage.local.remove([
        FAILED_ATTEMPTS_KEY,
        LOCKED_UNTIL_KEY,
        'cyphras_allowlist',
      ])
      const allLocal = await chrome.storage.local.get(null)
      const assetKeys = Object.keys(allLocal).filter((k) => k.startsWith('cyphras_custom_assets_'))
      if (assetKeys.length > 0) await chrome.storage.local.remove(assetKeys)
      notifyTabsWalletChanged()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.GET_WALLET_STATUS: {
      const walletExists = await hasWallet()
      const legacy = await isLegacyWallet()
      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY] ?? null
      const failedAttempts = await getFailedAttempts()
      const lockedUntil = await getLockedUntil()
      sendResponse({
        hasWallet: walletExists,
        isLegacy: legacy,
        isUnlocked: !!pubkey,
        publicKey: pubkey ?? undefined,
        failedAttempts,
        lockedUntil,
      })
      break
    }

    case SERVICE_TYPES.GET_PUBLIC_KEY: {
      const store = await getAccountsStore()
      const activeAccount = store.accounts.find((a) => a.index === store.activeIndex)
      const pubkey = activeAccount?.publicKey ?? (await getStoredPublicKey())
      sendResponse({ publicKey: pubkey ?? undefined })
      break
    }

    case SERVICE_TYPES.GET_FAILED_ATTEMPTS: {
      const failedAttempts = await getFailedAttempts()
      const lockedUntil = await getLockedUntil()
      sendResponse({ failedAttempts, lockedUntil })
      break
    }

    case SERVICE_TYPES.RESET_FAILED_ATTEMPTS: {
      await resetFailedAttempts()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.GET_NETWORKS: {
      const networks = await getNetworks()
      const activeNetwork = await getActiveNetwork()
      sendResponse({ networks, activeNetwork })
      break
    }

    case SERVICE_TYPES.GET_ACTIVE_NETWORK: {
      const activeNetwork = await getActiveNetwork()
      sendResponse({ activeNetwork })
      break
    }

    case SERVICE_TYPES.SET_ACTIVE_NETWORK: {
      if (!message.networkId) {
        sendResponse({ error: 'Network ID required' })
        return
      }
      await setActiveNetwork(message.networkId)
      const activeNetwork = await getActiveNetwork()
      notifyTabsWalletChanged()
      trackNetworkSwitched(message.networkId)
      sendResponse({ activeNetwork })
      break
    }

    case SERVICE_TYPES.ADD_NETWORK: {
      if (!message.network) {
        sendResponse({ error: 'Network config required' })
        return
      }
      try {
        const networks = await addNetwork(message.network)
        sendResponse({ networks })
      } catch (e) {
        sendResponse({ error: (e as Error).message })
      }
      break
    }

    case SERVICE_TYPES.EDIT_NETWORK: {
      if (!message.network) {
        sendResponse({ error: 'Network config required' })
        return
      }
      try {
        const networks = await editNetwork(message.network)
        sendResponse({ networks })
      } catch (e) {
        sendResponse({ error: (e as Error).message })
      }
      break
    }

    case SERVICE_TYPES.REMOVE_NETWORK: {
      if (!message.networkId) {
        sendResponse({ error: 'Network ID required' })
        return
      }
      try {
        const networks = await removeNetwork(message.networkId)
        const activeNetwork = await getActiveNetwork()
        sendResponse({ networks, activeNetwork })
      } catch (e) {
        sendResponse({ error: (e as Error).message })
      }
      break
    }

    case SERVICE_TYPES.BUILD_PAYMENT_XDR: {
      if (!message.payment || !message.horizonUrl || !message.networkPassphrase) {
        sendResponse({ error: 'Missing payment params' })
        return
      }

      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY]
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      try {
        const { destination, amount, assetCode, assetIssuer, memo, memoType, fee, timeout } =
          message.payment

        const res = await fetch(`${message.horizonUrl}/accounts/${pubkey}`)
        if (!res.ok) throw new Error('Failed to load account')
        const accountData = (await res.json()) as { sequence: string }
        const account = new Account(pubkey, accountData.sequence)

        const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer)
        const op = await buildTransferOperation(message.horizonUrl, destination, asset, amount)

        let txBuilder = new TransactionBuilder(account, {
          fee: fee ?? BASE_FEE,
          networkPassphrase: message.networkPassphrase,
        })
          .addOperation(op)
          .setTimeout(timeout ?? 30)

        if (memo && memoType === 'text') txBuilder = txBuilder.addMemo(Memo.text(memo))
        else if (memo && memoType === 'id') txBuilder = txBuilder.addMemo(Memo.id(memo))

        const tx = txBuilder.build()
        const xdr = tx.toEnvelope().toXDR('base64')
        sendResponse({ xdr })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.SIGN_AND_SUBMIT_PAYMENT: {
      if (!message.payment || !message.horizonUrl || !message.networkPassphrase) {
        sendResponse({ error: 'Missing payment params' })
        return
      }

      const sessionSecret = await getSessionSecret()
      if (!sessionSecret) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY]
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      try {
        const { destination, amount, assetCode, assetIssuer, memo, memoType, fee, timeout } =
          message.payment

        const res = await fetch(`${message.horizonUrl}/accounts/${pubkey}`)
        if (!res.ok) throw new Error('Failed to load account')
        const accountData = (await res.json()) as { sequence: string }
        const account = new Account(pubkey, accountData.sequence)

        const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer)
        const op = await buildTransferOperation(message.horizonUrl, destination, asset, amount)

        let txBuilder = new TransactionBuilder(account, {
          fee: fee ?? BASE_FEE,
          networkPassphrase: message.networkPassphrase,
        })
          .addOperation(op)
          .setTimeout(timeout ?? 30)

        if (memo && memoType === 'text') {
          txBuilder = txBuilder.addMemo(Memo.text(memo))
        } else if (memo && memoType === 'id') {
          txBuilder = txBuilder.addMemo(Memo.id(memo))
        }

        const tx = txBuilder.build()
        const keypair = Keypair.fromSecret(sessionSecret)
        tx.sign(keypair)

        const submitRes = await fetch(`${message.horizonUrl}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `tx=${encodeURIComponent(tx.toEnvelope().toXDR('base64'))}`,
        })

        const submitData = (await submitRes.json()) as {
          hash?: string
          extras?: { result_codes?: { transaction?: string } }
        }

        if (!submitRes.ok) {
          const errMsg = submitData?.extras?.result_codes?.transaction ?? 'Transaction failed'
          sendResponse({ error: errMsg })
          return
        }

        sendResponse({ txHash: submitData.hash })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_QUOTE: {
      const pqNet = await getActiveNetwork()
      if (!pqNet.relayerUrl || !pqNet.privatePoolFactory) {
        sendResponse({ error: 'Private payments are not available on this network' })
        return
      }
      const pqEnv = await buildPrivateEnv(pqNet)
      if (!pqEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      const pq = message as unknown as { asset: string; amount: string; recipient?: string }
      if (!/^[0-9]+$/.test(pq.amount)) {
        sendResponse({ error: 'amount must be a positive integer in stroops' })
        return
      }
      try {
        // Block early (at the quote step) if the recipient cannot receive, before the user confirms.
        const pqAsset = pqNet.privateAssets?.find((a) => a.asset === pq.asset)
        if (pq.recipient && pqAsset) {
          const pqRecvErr = await recipientReceiveError(pqNet, pq.recipient, pqAsset)
          if (pqRecvErr) {
            sendResponse({ error: pqRecvErr })
            return
          }
        }
        const quote = await quoteSend(pq.asset, BigInt(pq.amount), pqEnv)
        const commitFeeStroops = await estimateCommitFeeStroops(
          pqNet,
          pqEnv.source,
          quote.samplePool,
          quote.feeStroops
        )
        sendResponse({
          privateQuote: {
            feeStroops: quote.feeStroops,
            pieces: quote.pieces,
            totalNotes: quote.totalNotes,
            commitFeeStroops,
          },
        })
      } catch (err) {
        sendResponse({ error: friendlyPrivateError(err, pq.asset) })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_PREPARE_SEND: {
      const ppNet = await getActiveNetwork()
      if (!ppNet.sorobanRpcUrl || !ppNet.privatePoolFactory || !ppNet.relayerUrl) {
        sendResponse({ error: 'Private payments are not available on this network' })
        return
      }
      const ppEnv = await buildPrivateEnv(ppNet)
      if (!ppEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      const m = message as unknown as {
        recipient: string
        asset: string
        amount: string
        privacyLevel: SendParams['privacyLevel']
      }
      try {
        // amount is in stroops to match the pool denominations; reject non-integers before BigInt.
        if (!/^[0-9]+$/.test(m.amount)) {
          sendResponse({ error: 'amount must be a positive integer in stroops' })
          return
        }
        // The SAC is a trust anchor: resolve it from shipped config, never the message, so a caller
        // cannot make the commit move a different asset than the user chose.
        const ppAsset = ppNet.privateAssets?.find((a) => a.asset === m.asset)
        if (!ppAsset) {
          sendResponse({ error: `asset ${m.asset} is not available for private payments` })
          return
        }
        // Recipient receivability is checked at the preceding quote step, and a failed reveal is
        // recoverable, so it is not rechecked here to avoid a redundant round-trip.
        const created = await prepareSend(
          {
            recipient: m.recipient,
            asset: m.asset,
            token: ppAsset.token,
            amount: BigInt(m.amount),
            privacyLevel: m.privacyLevel,
          },
          ppEnv
        )
        sendResponse({ notes: created })
        // Commit and reveal run in the background processor so the send returns instantly and keeps
        // progressing even if this page closes or the worker restarts.
        void kickPrivateProcessor()
      } catch (err) {
        sendResponse({ error: friendlyPrivateError(err, m.asset) })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_REVEAL_NOTE: {
      const prNet = await getActiveNetwork()
      if (!prNet.sorobanRpcUrl || !prNet.privatePoolFactory || !prNet.relayerUrl) {
        sendResponse({ error: 'Private payments are not available on this network' })
        return
      }
      const prEnv = await buildPrivateEnv(prNet)
      if (!prEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      try {
        const m = message as unknown as {
          counter: number
          privacyLevel: SendParams['privacyLevel']
        }
        if (!Number.isInteger(m.counter) || m.counter < 0) {
          sendResponse({ error: 'counter must be a non-negative integer' })
          return
        }
        await revealNote(Number(m.counter), prEnv, {
          generateProof: (inputs) => generateProof(inputs, prEnv.network),
        })
        sendResponse({ ok: true })
        // The reveal is now scheduled; let the processor confirm delivery and pick up other notes.
        void kickPrivateProcessor()
      } catch (err) {
        const notReady = err instanceof NoteNotReadyError
        sendResponse({
          error: (err as Error).message,
          code: notReady ? 'NOT_READY' : 'REVEAL_FAILED',
        })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_SELF_RECLAIM: {
      const sclNet = await getActiveNetwork()
      if (!sclNet.sorobanRpcUrl || !sclNet.privatePoolFactory || !sclNet.relayerUrl) {
        sendResponse({ error: 'Private payments are not available on this network' })
        return
      }
      const sclEnv = await buildPrivateEnv(sclNet)
      if (!sclEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      try {
        const m = message as unknown as { counter: number }
        if (!Number.isInteger(m.counter) || m.counter < 0) {
          sendResponse({ error: 'counter must be a non-negative integer' })
          return
        }
        await selfReclaim(Number(m.counter), sclEnv, {
          generateProof: (inputs) => generateProof(inputs, sclEnv.network),
          submitReveal: makeSubmitReveal(sclNet, sclEnv.source),
        })
        sendResponse({ ok: true })
        void kickPrivateProcessor()
      } catch (err) {
        const notReady = err instanceof NoteNotReadyError
        sendResponse({
          error: (err as Error).message,
          code: notReady ? 'NOT_READY' : 'RECLAIM_FAILED',
        })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_RECOVER_FROM_SEED: {
      const rsNet = await getActiveNetwork()
      if (!rsNet.sorobanRpcUrl || !rsNet.privatePoolFactory || !rsNet.relayerUrl) {
        sendResponse({ error: 'Private payments are not available on this network' })
        return
      }
      const rsEnv = await buildPrivateEnv(rsNet)
      if (!rsEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      try {
        const recovered = await recoverFromSeed(rsEnv)
        sendResponse({ recovered: recovered.length })
        // Recovered notes are committed; let the processor reveal them back to the owner.
        void kickPrivateProcessor()
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_LIST_NOTES: {
      const plNet = await getActiveNetwork()
      const plEnv = await buildPrivateEnv(plNet)
      if (!plEnv) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      // Viewing history surfaces on-chain notes missing locally without needing a lock/unlock; throttled
      // and not awaited, so the list returns now and a recovered note shows on the next poll.
      void kickPrivateRecovery()
      try {
        const notes = await listNotes(plEnv)
        sendResponse({ notes })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.PRIVATE_PROCESS_NOTES: {
      // Manual nudge for the background processor (e.g. opening Private Notes or a manual retry).
      // No-ops if the wallet is locked or private payments are unavailable on this network.
      void kickPrivateProcessor()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.ADD_TRUSTLINE:
    case SERVICE_TYPES.REMOVE_TRUSTLINE: {
      if (!message.trustline || !message.horizonUrl || !message.networkPassphrase) {
        sendResponse({ error: 'Missing trustline params' })
        return
      }

      const sessionSecret = await getSessionSecret()
      if (!sessionSecret) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY]
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      try {
        const { assetCode, assetIssuer, limit } = message.trustline

        const res = await fetch(`${message.horizonUrl}/accounts/${pubkey}`)
        if (!res.ok) throw new Error('Failed to load account')
        const accountData = (await res.json()) as { sequence: string }
        const account = new Account(pubkey, accountData.sequence)

        const asset = new Asset(assetCode, assetIssuer)
        const isRemove = message.type === SERVICE_TYPES.REMOVE_TRUSTLINE

        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: message.networkPassphrase,
        })
          .addOperation(
            Operation.changeTrust({
              asset,
              limit: isRemove ? '0' : (limit ?? undefined),
            })
          )
          .setTimeout(30)
          .build()

        const keypair = Keypair.fromSecret(sessionSecret)
        tx.sign(keypair)

        const submitRes = await fetch(`${message.horizonUrl}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `tx=${encodeURIComponent(tx.toEnvelope().toXDR('base64'))}`,
        })

        const submitData = (await submitRes.json()) as {
          hash?: string
          extras?: { result_codes?: { transaction?: string } }
        }

        if (!submitRes.ok) {
          const errMsg = submitData?.extras?.result_codes?.transaction ?? 'Transaction failed'
          sendResponse({ error: errMsg })
          return
        }

        sendResponse({ txHash: submitData.hash })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.GET_SWAP_QUOTE: {
      if (!message.swap || !message.horizonUrl || !message.networkPassphrase) {
        sendResponse({ error: 'Missing swap params' })
        return
      }

      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY]
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      try {
        const {
          fromAssetCode,
          fromAssetIssuer,
          toAssetCode,
          toAssetIssuer,
          amount,
          slippage,
          fee,
          timeout,
        } = message.swap

        const fromAsset =
          fromAssetCode === 'XLM' ? Asset.native() : new Asset(fromAssetCode, fromAssetIssuer)
        const toAsset =
          toAssetCode === 'XLM' ? Asset.native() : new Asset(toAssetCode, toAssetIssuer)

        const pathsRes = await fetch(
          `${message.horizonUrl}/paths/strict-send?source_asset_type=${fromAssetCode === 'XLM' ? 'native' : 'credit_alphanum12'}&source_asset_code=${fromAssetCode === 'XLM' ? '' : fromAssetCode}&source_asset_issuer=${fromAssetIssuer}&source_amount=${amount}&destination_assets=${toAssetCode === 'XLM' ? 'native' : `${toAssetCode}:${toAssetIssuer}`}`
        )

        if (!pathsRes.ok) {
          sendResponse({ error: 'No swap path found' })
          return
        }

        const pathsData = (await pathsRes.json()) as {
          _embedded: {
            records: Array<{
              destination_amount: string
              path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>
            }>
          }
        }

        const records = pathsData._embedded?.records ?? []
        if (records.length === 0) {
          sendResponse({ error: 'No swap path found' })
          return
        }

        const bestPath = records[0]
        const destinationAmount = bestPath.destination_amount
        const slippageNum = parseFloat(slippage) / 100
        const destMin = (parseFloat(destinationAmount) * (1 - slippageNum)).toFixed(7)
        const pathAssets = bestPath.path.map((p) =>
          p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)
        )

        const res = await fetch(`${message.horizonUrl}/accounts/${pubkey}`)
        if (!res.ok) throw new Error('Failed to load account')
        const accountData = (await res.json()) as { sequence: string }
        const account = new Account(pubkey, accountData.sequence)

        const tx = new TransactionBuilder(account, {
          fee: fee ?? BASE_FEE,
          networkPassphrase: message.networkPassphrase,
        })
          .addOperation(
            Operation.pathPaymentStrictSend({
              sendAsset: fromAsset,
              sendAmount: amount,
              destination: pubkey,
              destAsset: toAsset,
              destMin,
              path: pathAssets,
            })
          )
          .setTimeout(timeout ?? 30)
          .build()

        const xdr = tx.toEnvelope().toXDR('base64')
        const pathForResponse = bestPath.path.map((p) => ({
          assetCode: p.asset_type === 'native' ? 'XLM' : (p.asset_code ?? ''),
          assetIssuer: p.asset_issuer ?? '',
        }))

        sendResponse({ quote: { destinationAmount, destMin, path: pathForResponse, xdr } })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.SIGN_AND_SUBMIT_SWAP: {
      if (!message.swap || !message.horizonUrl || !message.networkPassphrase) {
        sendResponse({ error: 'Missing swap params' })
        return
      }

      const sessionSecret = await getSessionSecret()
      if (!sessionSecret) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = session?.[SESSION_KEY]
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }

      try {
        const {
          fromAssetCode,
          fromAssetIssuer,
          toAssetCode,
          toAssetIssuer,
          amount,
          slippage,
          fee,
          timeout,
        } = message.swap

        const fromAsset =
          fromAssetCode === 'XLM' ? Asset.native() : new Asset(fromAssetCode, fromAssetIssuer)
        const toAsset =
          toAssetCode === 'XLM' ? Asset.native() : new Asset(toAssetCode, toAssetIssuer)

        const pathsRes = await fetch(
          `${message.horizonUrl}/paths/strict-send?source_asset_type=${fromAssetCode === 'XLM' ? 'native' : 'credit_alphanum12'}&source_asset_code=${fromAssetCode === 'XLM' ? '' : fromAssetCode}&source_asset_issuer=${fromAssetIssuer}&source_amount=${amount}&destination_assets=${toAssetCode === 'XLM' ? 'native' : `${toAssetCode}:${toAssetIssuer}`}`
        )

        if (!pathsRes.ok) throw new Error('No swap path found')

        const pathsData = (await pathsRes.json()) as {
          _embedded: {
            records: Array<{
              destination_amount: string
              path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>
            }>
          }
        }

        const records = pathsData._embedded?.records ?? []
        if (records.length === 0) throw new Error('No swap path found')

        const bestPath = records[0]
        const destinationAmount = bestPath.destination_amount
        const slippageNum = parseFloat(slippage) / 100
        const destMin = (parseFloat(destinationAmount) * (1 - slippageNum)).toFixed(7)
        const pathAssets = bestPath.path.map((p) =>
          p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)
        )

        const res = await fetch(`${message.horizonUrl}/accounts/${pubkey}`)
        if (!res.ok) throw new Error('Failed to load account')
        const accountData = (await res.json()) as { sequence: string }
        const account = new Account(pubkey, accountData.sequence)

        const tx = new TransactionBuilder(account, {
          fee: fee ?? BASE_FEE,
          networkPassphrase: message.networkPassphrase,
        })
          .addOperation(
            Operation.pathPaymentStrictSend({
              sendAsset: fromAsset,
              sendAmount: amount,
              destination: pubkey,
              destAsset: toAsset,
              destMin,
              path: pathAssets,
            })
          )
          .setTimeout(timeout ?? 30)
          .build()

        const keypair = Keypair.fromSecret(sessionSecret)
        tx.sign(keypair)

        const submitRes = await fetch(`${message.horizonUrl}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `tx=${encodeURIComponent(tx.toEnvelope().toXDR('base64'))}`,
        })

        const submitData = (await submitRes.json()) as {
          hash?: string
          extras?: { result_codes?: { transaction?: string } }
        }

        if (!submitRes.ok) {
          const errMsg = submitData?.extras?.result_codes?.transaction ?? 'Swap failed'
          sendResponse({ error: errMsg })
          return
        }

        sendResponse({ txHash: submitData.hash })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.GET_CONNECTED_APPS: {
      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = (session?.[SESSION_KEY] ?? null) as string | null
      if (!pubkey) {
        sendResponse({ connectedApps: [] })
        return
      }
      const { id: svcGcaNetId } = await getActiveNetwork()
      const apps = await getConnectedApps(pubkey, svcGcaNetId)
      sendResponse({ connectedApps: apps })
      break
    }

    case SERVICE_TYPES.REVOKE_ACCESS: {
      if (!message.origin) {
        sendResponse({ error: 'Origin required' })
        return
      }
      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = (session?.[SESSION_KEY] ?? null) as string | null
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      const { id: svcRaNetId } = await getActiveNetwork()
      await revokeAccess(message.origin, pubkey, svcRaNetId)
      notifyTabsWalletChanged()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.REVOKE_ALL_ACCESS: {
      const session = await chrome.storage.session?.get(SESSION_KEY)
      const pubkey = (session?.[SESSION_KEY] ?? null) as string | null
      if (!pubkey) {
        sendResponse({ error: 'Wallet locked' })
        return
      }
      const { id: svcRaaNetId } = await getActiveNetwork()
      await revokeAllAccess(pubkey, svcRaaNetId)
      notifyTabsWalletChanged()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.GET_ACCOUNTS: {
      const store = await getAccountsStore()

      // Migration: add walletId and activePublicKey for pre-multi-wallet data
      let needsSave = false
      for (const account of store.accounts) {
        if (!(account as any).walletId) {
          ;(account as any).walletId = 'primary'
          needsSave = true
        }
      }
      if (!store.activePublicKey && store.accounts.length > 0) {
        const active =
          store.accounts.find((a) => a.index === (store.activeIndex ?? 0)) ?? store.accounts[0]
        store.activePublicKey = active.publicKey
        needsSave = true
      }
      if (needsSave) await saveAccountsStore(store)

      const hdWallets = await getHDWallets()
      const importedKeys = await getImportedKeys()

      sendResponse({
        accounts: store.accounts,
        activePublicKey: store.activePublicKey,
        hdWallets: hdWallets.map((w) => ({
          id: w.id,
          label: w.label,
          accountCount: store.accounts.filter((a) => a.walletId === w.id).length,
        })),
        importedKeys: importedKeys.map((k) => ({
          id: k.id,
          publicKey: k.publicKey,
          label: k.label,
        })),
      })
      break
    }

    case SERVICE_TYPES.ADD_ACCOUNT: {
      const targetWalletId = message.walletId || 'primary'

      if (message.password) {
        const isValid = await verifyPassword(message.password)
        if (!isValid) {
          sendResponse({ error: 'Incorrect password' })
          return
        }
      }

      let addMnemonic: string | null = null
      if (targetWalletId === 'primary') {
        addMnemonic = await getSessionMnemonic()
      } else {
        const extraMnemonics = await getSessionExtraHDMnemonics()
        addMnemonic = extraMnemonics[targetWalletId] ?? null
      }

      if (!addMnemonic) {
        sendResponse({
          error:
            'Multi-account requires re-importing your wallet. Legacy wallets only support one account.',
        })
        return
      }

      const store = await getAccountsStore()
      const walletAccounts = store.accounts.filter((a) => a.walletId === targetWalletId)
      const nextIndex =
        walletAccounts.length > 0
          ? Math.max(...walletAccounts.map((a: AccountInfo) => a.index)) + 1
          : 1
      const label = message.label || `Account ${store.accounts.length + 1}`
      const { secret } = await deriveKeypairRaw(addMnemonic, nextIndex)
      const keypair = Keypair.fromSecret(secret)
      const publicKey = keypair.publicKey()
      const newAccount: AccountInfo = {
        index: nextIndex,
        publicKey,
        label,
        walletId: targetWalletId,
      }
      store.accounts.push(newAccount)
      await saveAccountsStore(store)
      sendResponse({ account: newAccount })
      break
    }

    case SERVICE_TYPES.SWITCH_ACCOUNT: {
      const switchPubkey = message.publicKey as string | undefined
      const store = await getAccountsStore()
      const target = switchPubkey
        ? store.accounts.find((a) => a.publicKey === switchPubkey)
        : store.accounts.find(
            (a) => a.index === message.index && (!a.walletId || a.walletId === 'primary')
          )

      if (!target) {
        sendResponse({ error: 'Account not found' })
        return
      }

      let switchSecret: string | null = null
      if (!target.walletId || target.walletId === 'primary') {
        const sessionMnemonic = await getSessionMnemonic()
        if (!sessionMnemonic) {
          sendResponse({ error: 'Wallet is locked' })
          return
        }
        const result = await deriveKeypairRaw(sessionMnemonic, target.index)
        switchSecret = result.secret
      } else if (target.walletId.startsWith('sk:')) {
        const secrets = await getSessionImportedSecrets()
        switchSecret = secrets[target.walletId] ?? null
      } else {
        const extraMnemonics = await getSessionExtraHDMnemonics()
        const extraMnemonic = extraMnemonics[target.walletId]
        if (!extraMnemonic) {
          sendResponse({ error: 'Wallet is locked' })
          return
        }
        const result = await deriveKeypairRaw(extraMnemonic, target.index)
        switchSecret = result.secret
      }

      if (!switchSecret) {
        sendResponse({ error: 'Wallet is locked' })
        return
      }

      const switchPk = Keypair.fromSecret(switchSecret).publicKey()
      store.activeIndex = target.index
      store.activePublicKey = switchPk
      await saveAccountsStore(store)
      await chrome.storage.session?.set({ [SESSION_KEY]: switchPk })
      await storeSessionSecret(switchSecret)
      notifyTabsWalletChanged()
      sendResponse({ publicKey: switchPk })
      break
    }

    case SERVICE_TYPES.RENAME_ACCOUNT: {
      if (!message.label) {
        sendResponse({ error: 'Label required' })
        return
      }
      const store = await getAccountsStore()
      const renameAccount = message.publicKey
        ? store.accounts.find((a) => a.publicKey === message.publicKey)
        : store.accounts.find((a) => a.index === message.index)
      if (!renameAccount) {
        sendResponse({ error: 'Account not found' })
        return
      }
      renameAccount.label = message.label

      if (renameAccount.walletId?.startsWith('sk:')) {
        const importedKeys = await getImportedKeys()
        const ik = importedKeys.find((k) => k.id === renameAccount.walletId)
        if (ik) ik.label = message.label
        await saveImportedKeys(importedKeys)
      }

      await saveAccountsStore(store)
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.REMOVE_ACCOUNT: {
      if (message.password) {
        const isValid = await verifyPassword(message.password)
        if (!isValid) {
          sendResponse({ error: 'Incorrect password' })
          return
        }
      }
      const store = await getAccountsStore()
      if (store.accounts.length <= 1) {
        sendResponse({ error: 'Cannot remove the last account' })
        return
      }

      const removeTarget = message.publicKey
        ? store.accounts.find((a) => a.publicKey === message.publicKey)
        : store.accounts.find((a) => a.index === message.index)
      if (!removeTarget) {
        sendResponse({ error: 'Account not found' })
        return
      }

      // Primary (index 0) is the seed-derived anchor every unlock falls back to; removing it would
      // leave the active account pointing at a missing entry.
      if (
        (!removeTarget.walletId || removeTarget.walletId === 'primary') &&
        removeTarget.index === 0
      ) {
        sendResponse({ error: 'Cannot remove the primary account' })
        return
      }

      const activePk =
        store.activePublicKey ??
        store.accounts.find((a) => a.index === store.activeIndex)?.publicKey
      if (removeTarget.publicKey === activePk) {
        sendResponse({
          error: 'Cannot remove the active account. Switch to another account first.',
        })
        return
      }

      store.accounts = store.accounts.filter((a) => a.publicKey !== removeTarget.publicKey)
      await saveAccountsStore(store)

      if (removeTarget.walletId?.startsWith('sk:')) {
        const importedKeys = await getImportedKeys()
        await saveImportedKeys(importedKeys.filter((k) => k.id !== removeTarget.walletId))
        const secrets = await getSessionImportedSecrets()
        delete secrets[removeTarget.walletId]
        await storeSessionImportedSecrets(secrets)
      }

      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.CREATE_HD_WALLET: {
      if (!message.password) {
        sendResponse({ error: 'Password required' })
        return
      }
      const isPasswordValid = await verifyPassword(message.password)
      if (!isPasswordValid) {
        sendResponse({ error: 'Incorrect password' })
        return
      }

      const existingHD = await getHDWallets()
      const newWalletId = crypto.randomUUID()
      const newWalletLabel = message.walletLabel || `Wallet ${existingHD.length + 2}`
      const newMnemonic = generateMnemonic()
      const encryptedMnemonic = await encryptString(newMnemonic, message.password)

      existingHD.push({ id: newWalletId, label: newWalletLabel, encryptedMnemonic })
      await saveHDWallets(existingHD)

      const { secret: newSecret } = await deriveKeypairRaw(newMnemonic, 0)
      const newPubkey = Keypair.fromSecret(newSecret).publicKey()
      const newAccount: AccountInfo = {
        index: 0,
        publicKey: newPubkey,
        label: `Account ${store.accounts.length + 1}`,
        walletId: newWalletId,
      }

      const store = await getAccountsStore()
      store.accounts.push(newAccount)
      await saveAccountsStore(store)

      const extraMnemonics = await getSessionExtraHDMnemonics()
      extraMnemonics[newWalletId] = newMnemonic
      await storeSessionExtraHDMnemonics(extraMnemonics)

      trackWalletCreated('hd_wallet')
      trackAccountAdded('hd_derive')
      sendResponse({ account: newAccount, mnemonic: newMnemonic })
      break
    }

    case SERVICE_TYPES.IMPORT_HD_WALLET: {
      if (!message.password || !message.mnemonic) {
        sendResponse({ error: 'Password and recovery phrase required' })
        return
      }
      const isPasswordValid = await verifyPassword(message.password)
      if (!isPasswordValid) {
        sendResponse({ error: 'Incorrect password' })
        return
      }
      if (!validateMnemonic(message.mnemonic)) {
        sendResponse({ error: 'Invalid recovery phrase' })
        return
      }

      const { secret: testSecret } = await deriveKeypairRaw(message.mnemonic, 0)
      const testPk = Keypair.fromSecret(testSecret).publicKey()
      const store = await getAccountsStore()
      if (store.accounts.some((a) => a.publicKey === testPk)) {
        sendResponse({ error: 'This wallet is already added' })
        return
      }

      const existingHD = await getHDWallets()
      const importedWalletId = crypto.randomUUID()
      const importedWalletLabel = message.walletLabel || `Wallet ${existingHD.length + 2}`
      const encryptedMnemonic = await encryptString(message.mnemonic, message.password)

      existingHD.push({ id: importedWalletId, label: importedWalletLabel, encryptedMnemonic })
      await saveHDWallets(existingHD)

      const importedAccount: AccountInfo = {
        index: 0,
        publicKey: testPk,
        label: `Account ${store.accounts.length + 1}`,
        walletId: importedWalletId,
      }
      store.accounts.push(importedAccount)
      await saveAccountsStore(store)

      const extraMnemonics = await getSessionExtraHDMnemonics()
      extraMnemonics[importedWalletId] = message.mnemonic
      await storeSessionExtraHDMnemonics(extraMnemonics)

      trackWalletCreated('hd_wallet')
      trackAccountAdded('hd_derive')
      sendResponse({ account: importedAccount })
      break
    }

    case SERVICE_TYPES.IMPORT_SECRET_KEY: {
      if (!message.password || !message.secretKey) {
        sendResponse({ error: 'Password and secret key required' })
        return
      }
      const isPasswordValid = await verifyPassword(message.password)
      if (!isPasswordValid) {
        sendResponse({ error: 'Incorrect password' })
        return
      }

      let importKp: ReturnType<typeof Keypair.fromSecret>
      try {
        importKp = Keypair.fromSecret(message.secretKey)
      } catch {
        sendResponse({ error: 'Invalid Stellar secret key' })
        return
      }
      const importPubkey = importKp.publicKey()

      const store = await getAccountsStore()
      if (store.accounts.some((a) => a.publicKey === importPubkey)) {
        sendResponse({ error: 'This account is already added' })
        return
      }

      const skId = `sk:${crypto.randomUUID()}`
      const skLabel = message.walletLabel || `Account ${store.accounts.length + 1}`
      const encryptedSecret = await encryptString(message.secretKey, message.password)

      const importedKeys = await getImportedKeys()
      importedKeys.push({ id: skId, publicKey: importPubkey, label: skLabel, encryptedSecret })
      await saveImportedKeys(importedKeys)

      const skAccount: AccountInfo = {
        index: -1,
        publicKey: importPubkey,
        label: skLabel,
        walletId: skId,
      }
      store.accounts.push(skAccount)
      await saveAccountsStore(store)

      const importedSecrets = await getSessionImportedSecrets()
      importedSecrets[skId] = message.secretKey
      await storeSessionImportedSecrets(importedSecrets)

      trackWalletCreated('import_key')
      trackAccountAdded('import_key')
      sendResponse({ account: skAccount })
      break
    }

    case SERVICE_TYPES.REORDER_ACCOUNTS: {
      const newOrder = message.order as string[] | undefined
      if (!Array.isArray(newOrder)) {
        sendResponse({ error: 'Order array required' })
        return
      }
      const store = await getAccountsStore()
      const reordered: AccountInfo[] = []
      for (const pk of newOrder) {
        const acc = store.accounts.find((a) => a.publicKey === pk)
        if (acc) reordered.push(acc)
      }
      // Append any accounts missing from the order (safety net)
      for (const acc of store.accounts) {
        if (!reordered.find((a) => a.publicKey === acc.publicKey)) reordered.push(acc)
      }
      store.accounts = reordered
      await saveAccountsStore(store)
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.REMOVE_HD_WALLET: {
      if (!message.walletId) {
        sendResponse({ error: 'Wallet ID required' })
        return
      }
      if (message.walletId === 'primary') {
        sendResponse({ error: 'Cannot remove the primary wallet' })
        return
      }

      const store = await getAccountsStore()
      const activePk =
        store.activePublicKey ??
        store.accounts.find((a) => a.index === store.activeIndex)?.publicKey
      const activeAccount = store.accounts.find((a) => a.publicKey === activePk)
      if (activeAccount?.walletId === message.walletId) {
        sendResponse({
          error: 'Cannot remove wallet with active account. Switch to another account first.',
        })
        return
      }

      store.accounts = store.accounts.filter((a) => a.walletId !== message.walletId)
      await saveAccountsStore(store)

      if (message.walletId.startsWith('sk:')) {
        const importedKeys = await getImportedKeys()
        await saveImportedKeys(importedKeys.filter((k) => k.id !== message.walletId))
        const secrets = await getSessionImportedSecrets()
        delete secrets[message.walletId]
        await storeSessionImportedSecrets(secrets)
      } else {
        const hdWallets = await getHDWallets()
        await saveHDWallets(hdWallets.filter((w) => w.id !== message.walletId))
        const mnemonics = await getSessionExtraHDMnemonics()
        delete mnemonics[message.walletId]
        await storeSessionExtraHDMnemonics(mnemonics)
      }

      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.CHANGE_PASSWORD: {
      if (!message.currentPassword || !message.newPassword) {
        sendResponse({ error: 'currentPassword and newPassword required' })
        return
      }
      const cpIsValid = await verifyPassword(message.currentPassword)
      if (!cpIsValid) {
        sendResponse({ error: 'Incorrect current password' })
        return
      }
      try {
        await changePassword(message.currentPassword, message.newPassword)
        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ error: (err as Error).message })
      }
      break
    }

    case SERVICE_TYPES.GET_RECOVERY_PHRASE: {
      if (!message.password) {
        sendResponse({ error: 'password required' })
        return
      }
      const grpIsValid = await verifyPassword(message.password)
      if (!grpIsValid) {
        sendResponse({ error: 'Incorrect password' })
        return
      }
      const grpMnemonic = await decryptMnemonic(message.password)
      if (!grpMnemonic) {
        sendResponse({ error: 'Failed to decrypt wallet' })
        return
      }
      sendResponse({ mnemonic: grpMnemonic })
      break
    }

    case SERVICE_TYPES.GET_SECRET_KEY: {
      if (!message.password || !message.publicKey) {
        sendResponse({ error: 'Password and public key required' })
        return
      }
      const gskIsValid = await verifyPassword(message.password)
      if (!gskIsValid) {
        sendResponse({ error: 'Incorrect password' })
        return
      }
      const gskStore = await getAccountsStore()
      const gskAccount = gskStore.accounts.find((a) => a.publicKey === message.publicKey)
      if (!gskAccount) {
        sendResponse({ error: 'Account not found' })
        return
      }
      const gskWalletId = gskAccount.walletId
      if (gskWalletId?.startsWith('sk:')) {
        const importedKeys = await getImportedKeys()
        const entry = importedKeys.find((k) => k.id === gskWalletId)
        if (!entry) {
          sendResponse({ error: 'Key not found' })
          return
        }
        const secret = await decryptString(entry.encryptedSecret, message.password)
        if (!secret) {
          sendResponse({ error: 'Failed to decrypt key' })
          return
        }
        sendResponse({ secretKey: secret })
        return
      }
      if (!gskWalletId || gskWalletId === 'primary') {
        const gskMnemonic = await decryptMnemonic(message.password)
        if (!gskMnemonic) {
          sendResponse({ error: 'Failed to decrypt wallet' })
          return
        }
        const { secret } = await deriveKeypairRaw(gskMnemonic, gskAccount.index ?? 0)
        sendResponse({ secretKey: secret })
        return
      }
      const gskHDWallets = await getHDWallets()
      const gskHW = gskHDWallets.find((w) => w.id === gskWalletId)
      if (!gskHW) {
        sendResponse({ error: 'Wallet not found' })
        return
      }
      const gskHDMnemonic = await decryptString(gskHW.encryptedMnemonic, message.password)
      if (!gskHDMnemonic) {
        sendResponse({ error: 'Failed to decrypt wallet' })
        return
      }
      const { secret: gskSecret } = await deriveKeypairRaw(gskHDMnemonic, gskAccount.index ?? 0)
      sendResponse({ secretKey: gskSecret })
      break
    }

    case SERVICE_TYPES.GET_AUTO_LOCK_TIMEOUT: {
      const currentTimeout = await getIdleTimeoutSeconds()
      sendResponse({ timeoutSeconds: currentTimeout })
      break
    }

    case SERVICE_TYPES.SET_AUTO_LOCK_TIMEOUT: {
      if (typeof message.timeoutSeconds !== 'number' || message.timeoutSeconds < 0) {
        sendResponse({ error: 'timeoutSeconds must be a non-negative number' })
        return
      }
      await chrome.storage.local.set({ [AUTO_LOCK_TIMEOUT_KEY]: message.timeoutSeconds })
      await applyIdleTimeout()
      sendResponse({ ok: true })
      break
    }

    case SERVICE_TYPES.FETCH_HORIZON_ACCOUNT: {
      if (!message.publicKey) {
        sendResponse({ error: 'publicKey required' })
        return
      }
      const network = await getActiveNetwork()
      const res = await fetch(`${network.horizonUrl}/accounts/${message.publicKey}`).catch(
        () => null
      )
      if (!res || !res.ok) {
        sendResponse({ unfunded: !res || res.status === 404, rawBalances: null, subentryCount: 0 })
        return
      }
      const data = (await res.json()) as {
        balances: Array<{ balance: string; asset_type: string; asset_code?: string }>
        subentry_count?: number
      }
      sendResponse({
        unfunded: false,
        rawBalances: data.balances,
        subentryCount: data.subentry_count ?? 0,
      })
      break
    }

    default:
      sendResponse({ error: 'Unknown service type' })
  }
}

function handleWindowMessage(message: MessagePayload, sendResponse: (r: MessageResponse) => void) {
  switch (message.type) {
    case MESSAGE_TYPES.OPEN_SIDEPANEL:
      handleOpenSidePanel(sendResponse)
      break
    case MESSAGE_TYPES.CLOSE_SIDEPANEL:
      handleCloseSidePanel(sendResponse)
      break
    case MESSAGE_TYPES.OPEN_TAB:
      handleOpenTab(message.route ?? '/', sendResponse)
      break
    case MESSAGE_TYPES.SET_WINDOW_MODE: {
      const enableSidebar = message.mode === WINDOW_MODES.SIDEPANEL
      cachedSidebarByDefault = enableSidebar
      chrome.storage.local.set({ cyphras_sidebar_by_default: enableSidebar })
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enableSidebar })
      sendResponse({ ok: true })
      break
    }
    default:
      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` })
  }
}

function handleOpenSidePanel(sendResponse: (r: MessageResponse) => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) return sendResponse({ ok: false, error: 'No active tab' })
    chrome.storage.local.set({ [STORAGE_KEYS.WINDOW_MODE]: WINDOW_MODES.SIDEPANEL })
    chrome.sidePanel.open({ tabId })
    sendResponse({ ok: true })
  })
}

function handleCloseSidePanel(sendResponse: (r: MessageResponse) => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (!tabId) return sendResponse({ ok: false, error: 'No active tab' })
    chrome.storage.local.set({ [STORAGE_KEYS.WINDOW_MODE]: WINDOW_MODES.POPUP })
    if (!cachedSidebarByDefault) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
    }
    chrome.sidePanel.open({ tabId })
    sendResponse({ ok: true })
  })
}

function handleOpenTab(route: string, sendResponse: (r: MessageResponse) => void) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(`wallet.html#${route}`),
  })
  sendResponse({ ok: true })
}
