import {
  CyphrasError,
  PrivateWallet,
  keySource,
  type DepositInfo,
  type PlanView,
  type Submission,
  type TransactionSigner,
} from '@cyphras/private'
import { Keypair } from '@stellar/stellar-sdk'
import { TESTNET_PASSPHRASE, type NetworkConfig } from '@constants/networks'
import type {
  ShieldedDepositView,
  ShieldedErrorView,
  ShieldedLimitsView,
  ShieldedPlanView,
  ShieldedQuoteView,
  ShieldedReceiptView,
  ShieldedStatusView,
  ShieldedStep,
} from '@ext-types/index'
import {
  deriveKeypairRaw,
  getAccountsStore,
  getSessionExtraHDMnemonics,
  getSessionMnemonic,
  getSessionPublicKey,
  type AccountInfo,
} from '../keyManager'
import { SHIELDED_DEPLOYMENTS, type ShieldedDeployment } from './deployments'
import { MayStillLand, ShieldedRefusal, errorView } from './errors'
import { offscreenProver, packagedArtifacts } from './prover'
import { declineAllReviews, decideReview, startReviewed } from './reviews'
import { vaultSigner } from './signer'
import { chromeStore } from './store'

interface OpenWallet {
  readonly wallet: PrivateWallet
  readonly pool: ShieldedDeployment
  readonly signer: TransactionSigner
  sync: Promise<void> | undefined
  syncedAt: number | null
  syncError: ShieldedErrorView | null
}

// One SDK wallet per account and vault, holding the account's spending keys while the extension
// is unlocked. The popup only ever sees what the views below carry.
const wallets = new Map<
  string,
  { readonly walletId: string; readonly publicKey: string; readonly opening: Promise<OpenWallet> }
>()

// SDK operations still running; a reset waits for them so none writes records after it.
const running = new Set<Promise<unknown>>()

function track<T>(operation: Promise<T>): Promise<T> {
  running.add(operation)
  const done = () => running.delete(operation)
  operation.then(done, done)
  return operation
}

// The testnet proving key comes from a solo setup that can forge proofs, so private mode stays off
// every other network until the mainnet key comes out of a multi-party ceremony.
function assertShieldedAllowed(net: NetworkConfig): void {
  if (
    net.id !== 'testnet' ||
    net.passphrase !== TESTNET_PASSPHRASE ||
    (net.shielded?.length ?? 0) === 0
  ) {
    throw new ShieldedRefusal('testnet_only', 'Private mode runs on testnet only.')
  }
}

function poolOf(net: NetworkConfig, poolId: string | undefined): ShieldedDeployment {
  const config =
    poolId === undefined ? net.shielded?.[0] : net.shielded?.find((p) => p.poolId === poolId)
  const pool = config && SHIELDED_DEPLOYMENTS[config.deployment]
  if (!pool) throw new ShieldedRefusal('unknown_pool', 'That private pool is not available.')
  return pool
}

async function activeAccount(): Promise<{ account: AccountInfo; mnemonic: string }> {
  // A lock can leave the recovery phrase in the session for a pending dApp approval; the unlocked
  // account's key is what says the wallet is open.
  if (!(await getSessionPublicKey())) {
    closeShieldedWallets()
    throw new ShieldedRefusal('locked', 'Unlock the wallet first.')
  }
  const store = await getAccountsStore()
  const activePk =
    store.activePublicKey ?? store.accounts.find((a) => a.index === store.activeIndex)?.publicKey
  const account = store.accounts.find((a) => a.publicKey === activePk)
  if (!account) throw new ShieldedRefusal('no_account', 'No account is active.')
  if (account.index < 0 || account.walletId.startsWith('sk:')) {
    throw new ShieldedRefusal(
      'needs_recovery_phrase',
      'Private mode needs an account created from a recovery phrase.'
    )
  }
  const mnemonic =
    !account.walletId || account.walletId === 'primary'
      ? await getSessionMnemonic()
      : (await getSessionExtraHDMnemonics())[account.walletId]
  if (!mnemonic) {
    closeShieldedWallets()
    throw new ShieldedRefusal('locked', 'Unlock the wallet first.')
  }
  return { account, mnemonic }
}

// The account's own key, which must be the one the recovery phrase gives at its index.
async function accountKeypair(account: AccountInfo, mnemonic: string): Promise<Keypair> {
  const { secret } = await deriveKeypairRaw(mnemonic, account.index)
  const keypair = Keypair.fromSecret(secret)
  if (keypair.publicKey() !== account.publicKey) {
    throw new ShieldedRefusal('account_mismatch', 'The active account does not match the wallet.')
  }
  return keypair
}

// Extension account N is private account N of the same recovery phrase, so any wallet that follows
// the spec restores the same private balance from it.
async function openWallet(
  pool: ShieldedDeployment,
  account: AccountInfo,
  mnemonic: string,
  startFresh: boolean
): Promise<OpenWallet> {
  const keypair = await accountKeypair(account, mnemonic)
  const wallet = await PrivateWallet.open({
    deployment: pool.name,
    keys: keySource.mnemonic(mnemonic, { account: account.index }),
    prover: offscreenProver(pool.artifactPaths),
    artifacts: packagedArtifacts(pool.artifactPaths),
    storage: chromeStore(pool.deployment),
    rpcUrl: pool.rpcUrl,
    // Stored state that does not decrypt cannot be recovered, so the wallet starts fresh: the
    // chain rebuilds the notes and stateReset() says what was lost.
    resetUnreadableState: true,
    resetUnassignedState: startFresh,
  })
  return {
    wallet,
    pool,
    signer: vaultSigner(keypair, pool.deployment),
    sync: undefined,
    syncedAt: null,
    syncError: null,
  }
}

async function walletFor(
  net: NetworkConfig,
  poolId: string | undefined,
  startFresh = false
): Promise<OpenWallet> {
  assertShieldedAllowed(net)
  const pool = poolOf(net, poolId)
  const { account, mnemonic } = await activeAccount()
  const key = [pool.deployment.id, account.walletId, account.index, account.publicKey].join('|')
  const entry = wallets.get(key)
  if (entry) return entry.opening
  const opening = track(openWallet(pool, account, mnemonic, startFresh))
  opening.catch(() => {
    if (wallets.get(key)?.opening === opening) wallets.delete(key)
  })
  wallets.set(key, { walletId: account.walletId, publicKey: account.publicKey, opening })
  return opening
}

// Drops every open wallet and declines open reviews, so no spending key outlives the session.
export function closeShieldedWallets(): void {
  declineAllReviews()
  wallets.clear()
}

// Closes the wallets and waits for their operations still running, so that none writes records
// after a reset deleted them.
export async function settleShieldedWallets(): Promise<void> {
  closeShieldedWallets()
  await Promise.allSettled([...running])
}

// Drops the open wallets of accounts being removed, so their keys leave memory at once.
export function forgetShieldedAccounts(
  removed: (account: { readonly walletId: string; readonly publicKey: string }) => boolean
): void {
  for (const [key, entry] of wallets) if (removed(entry)) wallets.delete(key)
}

// Concurrent requests share one sync; its failure is kept for the status rather than thrown.
function syncOnce(entry: OpenWallet): Promise<void> {
  entry.sync ??= track(entry.wallet.sync())
    .then(
      () => {
        entry.syncedAt = Date.now()
        entry.syncError = null
      },
      (err: unknown) => {
        entry.syncError = errorView(err)
      }
    )
    .finally(() => {
      entry.sync = undefined
    })
  return entry.sync
}

const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value)

function depositView(d: DepositInfo): ShieldedDepositView {
  return {
    id: orNull(d.id),
    amount: d.amount.toString(),
    state: d.state,
    txHash: orNull(d.txHash),
    attested: orNull(d.attested),
    earliestAdmission: orNull(d.earliestAdmission),
    flag: d.flag ? { reason: d.flag.reason, kind: d.flag.kind } : null,
    refundableAt: orNull(d.refundableAt),
    refundKind: orNull(d.refundKind),
    confirmed: d.confirmed,
  }
}

function planView(p: PlanView): ShieldedPlanView {
  return {
    planId: p.planId,
    kind: p.kind,
    amount: p.amount.toString(),
    fee: p.fee.toString(),
    to: p.to,
    route: p.route,
    state: p.state,
    txHash: orNull(p.txHash),
    createdAt: p.createdAt,
    payoutLeft: p.payoutLeft === undefined ? null : p.payoutLeft.toString(),
    exitConfirmed: orNull(p.exitConfirmed),
    strandedExits: p.exitParts.filter((part) => part.stranded).map((part) => part.id),
    relayerStatus: orNull(p.relayerStatus),
    mustRetry: p.mustRetry,
    needsUserDecision: p.needsUserDecision,
  }
}

async function statusOf(entry: OpenWallet): Promise<ShieldedStatusView> {
  const { wallet } = entry
  const [balance, deposits, plans] = await Promise.all([
    wallet.balance(),
    wallet.deposits(),
    wallet.plans(),
  ])
  return {
    address: wallet.generateAddress(),
    balance: {
      spendable: balance.spendable.toString(),
      pendingDeposits: balance.pendingDeposits.toString(),
      locked: balance.locked.toString(),
      awaitingPayout: balance.awaitingPayout.toString(),
    },
    deposits: deposits.map(depositView).reverse(),
    plans: plans.map(planView).sort((a, b) => b.createdAt - a.createdAt),
    syncedAt: entry.syncedAt,
    syncError: entry.syncError,
    services: wallet.verification().state,
    stateReset: wallet.stateReset()?.warning ?? null,
  }
}

// Derived from the recovery phrase alone, so the address shows without opening the wallet or
// waiting for a sync.
export async function shieldedReceiveAddress(
  net: NetworkConfig,
  poolId: string | undefined
): Promise<string> {
  assertShieldedAllowed(net)
  const pool = poolOf(net, poolId)
  const { account, mnemonic } = await activeAccount()
  await accountKeypair(account, mnemonic)
  return PrivateWallet.address({
    network: pool.deployment.network,
    keys: keySource.mnemonic(mnemonic, { account: account.index }),
    storage: chromeStore(pool.deployment),
  })
}

export async function shieldedStatus(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedStatusView> {
  return statusOf(await walletFor(net, poolId))
}

// A stored state that every vault of the network shares and that cannot be assigned to this one
// keeps the pool from opening. On the user's word the pool opens on a fresh state instead, which the
// SDK does only when asked, leaving those records stored; any other open is left as it is.
export async function shieldedStartFresh(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedStatusView> {
  try {
    return await statusOf(await walletFor(net, poolId))
  } catch (err) {
    if (!(err instanceof CyphrasError && err.code === 'state_unassigned')) throw err
  }
  return statusOf(await walletFor(net, poolId, true))
}

export async function shieldedSync(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedStatusView> {
  const entry = await walletFor(net, poolId)
  await syncOnce(entry)
  return statusOf(entry)
}

export async function shieldedShield(
  net: NetworkConfig,
  poolId: string,
  amount: bigint,
  whileSubmitting: boolean
): Promise<ShieldedReceiptView> {
  const { wallet, signer } = await walletFor(net, poolId)
  const before = (await wallet.deposits()).length
  try {
    const receipt = await track(wallet.shield({ amount, signer, whileSubmitting }))
    return { depositId: orNull(receipt.depositId), txHash: receipt.txHash }
  } catch (err) {
    // A deposit this shield saved and did not mark failed may still land.
    const made = (await wallet.deposits()).slice(before)
    if (made.some((d) => d.state === 'submitting' || d.state === 'pending')) {
      throw new MayStillLand(err)
    }
    throw err
  }
}

export async function shieldedLimits(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedLimitsView> {
  const { wallet, signer } = await walletFor(net, poolId)
  const limits = await wallet.vaultLimits(signer.publicKey)
  return {
    minDeposit: limits.minDeposit.toString(),
    depositRoom: limits.depositRoom.toString(),
    largeDepositThreshold: limits.largeDepositThreshold.toString(),
    delaySmall: limits.delaySmall,
    delayLarge: limits.delayLarge,
    depositsPaused: limits.depositsPaused,
    haltedUntil: orNull(limits.haltedUntil),
  }
}

// A quote reads the vault as the last sync left it, which a worker that just started has not run.
export async function shieldedQuote(
  net: NetworkConfig,
  poolId: string,
  kind: 'send' | 'unshield',
  selfRelay: boolean
): Promise<ShieldedQuoteView> {
  const entry = await walletFor(net, poolId)
  if (entry.syncedAt === null) await syncOnce(entry)
  const quote = await entry.wallet.quote(
    selfRelay ? { kind, selfRelay } : { kind, maxFee: entry.pool.maxRelayerFee }
  )
  return { fee: quote.fee.toString(), maxAmount: quote.maxAmount.toString() }
}

interface SpendRequest {
  kind: 'send' | 'unshield'
  to: string
  amount: bigint
  selfRelay: boolean
}

// A spend that failed after saving a plan the wallet did not hold before has a payment out that
// may still land, whatever the error, so the popup never offers to pay it again with new notes.
async function watchingPlans(
  wallet: PrivateWallet,
  spend: () => Promise<Submission>
): Promise<Submission> {
  const before = new Set((await wallet.plans()).map((p) => p.planId))
  try {
    return await track(spend())
  } catch (err) {
    if ((await wallet.plans()).some((p) => !before.has(p.planId))) throw new MayStillLand(err)
    throw err
  }
}

export async function shieldedSpend(
  net: NetworkConfig,
  poolId: string,
  holder: string,
  req: SpendRequest
): Promise<ShieldedStep> {
  const { wallet, pool, signer } = await walletFor(net, poolId)
  if (req.kind === 'send') {
    return startReviewed(holder, (confirm) =>
      watchingPlans(wallet, () =>
        wallet.send({ to: req.to, amount: req.amount, maxFee: pool.maxRelayerFee, confirm })
      )
    )
  }
  const route = req.selfRelay ? { selfRelay: signer } : { maxFee: pool.maxRelayerFee }
  return startReviewed(holder, (confirm) =>
    watchingPlans(wallet, () =>
      wallet.unshield({ to: req.to, amount: req.amount, confirm, ...route })
    )
  )
}

export async function shieldedRetry(
  net: NetworkConfig,
  poolId: string,
  holder: string,
  planId: string,
  selfRelay: boolean
): Promise<ShieldedStep> {
  const { wallet, pool, signer } = await walletFor(net, poolId)
  const plan = (await wallet.plans()).find((p) => p.planId === planId)
  // The SDK retries a relayed plan through its relayer first, then the others. A self-relayed one
  // it moves to relayers only when they are named.
  const route = selfRelay
    ? { selfRelay: signer }
    : plan?.route.kind === 'self'
      ? { relayer: pool.deployment.relayers.map((r) => r.url), maxFee: pool.maxRelayerFee }
      : { maxFee: pool.maxRelayerFee }
  return startReviewed(holder, (confirm) =>
    watchingPlans(wallet, () => wallet.retry(planId, { confirm, ...route }))
  )
}

// The account signs these itself, as the depositor for a cancel and as any account for a refund or
// a claim; each returns the transaction's hash.
export async function shieldedAccountAction(
  net: NetworkConfig,
  poolId: string,
  action: 'cancel' | 'refund' | 'claim',
  id: number
): Promise<string> {
  const { wallet, signer } = await walletFor(net, poolId)
  const run =
    action === 'cancel'
      ? wallet.cancelDeposit(id, signer)
      : action === 'refund'
        ? wallet.refundDeposit(id, signer)
        : wallet.claimExit(id, signer)
  try {
    return (await track(run)).txHash
  } catch (err) {
    // Cancel and refund read the entry queue first, which no longer holds a settled deposit.
    if (err instanceof CyphrasError && err.code === 'not_found') {
      throw new ShieldedRefusal(
        'not_found',
        'That deposit is no longer pending: it was admitted, cancelled or refunded.'
      )
    }
    throw err
  }
}

export function shieldedDecide(reviewId: string, approve: boolean): Promise<ShieldedStep> {
  return decideReview(reviewId, approve)
}
