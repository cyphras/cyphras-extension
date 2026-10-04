import {
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
  ShieldedPlanView,
  ShieldedReceiptView,
  ShieldedStatusView,
  ShieldedStep,
} from '@ext-types/index'
import {
  deriveKeypairRaw,
  getAccountsStore,
  getSessionExtraHDMnemonics,
  getSessionMnemonic,
  type AccountInfo,
} from '../keyManager'
import { SHIELDED_DEPLOYMENTS, type ShieldedDeployment } from './deployments'
import { MayStillLand, ShieldedRefusal, errorView } from './errors'
import { offscreenProver, packagedArtifacts } from './prover'
import { declineAllReviews, decideReview, startReviewed } from './reviews'
import { vaultSigner } from './signer'
import { chromeStore } from './store'

// Whether an exit or a deposit rests on checked chain events; undefined where the SDK does not say.
type PlanFields = PlanView & { readonly exitConfirmed?: boolean }
type DepositFields = DepositInfo & { readonly confirmed?: boolean }

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
const wallets = new Map<string, Promise<OpenWallet>>()

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

// Extension account N is private account N of the same recovery phrase, so any wallet that follows
// the spec restores the same private balance from it.
async function openWallet(
  pool: ShieldedDeployment,
  rpcUrl: string,
  account: AccountInfo,
  mnemonic: string
): Promise<OpenWallet> {
  const { secret } = await deriveKeypairRaw(mnemonic, account.index)
  const keypair = Keypair.fromSecret(secret)
  if (keypair.publicKey() !== account.publicKey) {
    throw new ShieldedRefusal('account_mismatch', 'The active account does not match the wallet.')
  }
  const wallet = await PrivateWallet.open({
    deployment: pool.name,
    keys: keySource.mnemonic(mnemonic, { account: account.index }),
    prover: offscreenProver(pool.deployment, pool.artifactPaths),
    artifacts: packagedArtifacts(pool.artifactPaths),
    storage: chromeStore(pool.deployment),
    rpcUrl,
    // Stored state that no longer decrypts cannot be recovered; the chain rebuilds the notes and
    // stateReset() tells the user what was lost.
    resetUnreadableState: true,
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

async function walletFor(net: NetworkConfig, poolId: string | undefined): Promise<OpenWallet> {
  assertShieldedAllowed(net)
  const pool = poolOf(net, poolId)
  const { account, mnemonic } = await activeAccount()
  const key = [
    pool.deployment.id,
    net.sorobanRpcUrl,
    account.walletId,
    account.index,
    account.publicKey,
  ].join('|')
  let entry = wallets.get(key)
  if (!entry) {
    const opening = openWallet(pool, net.sorobanRpcUrl, account, mnemonic)
    opening.catch(() => {
      if (wallets.get(key) === opening) wallets.delete(key)
    })
    wallets.set(key, opening)
    entry = opening
  }
  return entry
}

// Drops every open wallet and declines open reviews, so no spending key outlives the session.
export function closeShieldedWallets(): void {
  declineAllReviews()
  wallets.clear()
}

// Concurrent requests share one sync; its failure is kept for the status rather than thrown.
function syncOnce(entry: OpenWallet): Promise<void> {
  entry.sync ??= entry.wallet
    .sync()
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

function depositView(d: DepositFields): ShieldedDepositView {
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
    confirmed: orNull(d.confirmed),
  }
}

function planView(p: PlanFields): ShieldedPlanView {
  return {
    planId: p.planId,
    kind: p.kind,
    amount: p.amount.toString(),
    fee: p.fee.toString(),
    to: p.to,
    state: p.state,
    txHash: orNull(p.txHash),
    createdAt: p.createdAt,
    payoutLeft: p.payoutLeft === undefined ? null : p.payoutLeft.toString(),
    exitConfirmed: orNull(p.exitConfirmed),
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

export async function shieldedReceiveAddress(
  net: NetworkConfig,
  poolId: string | undefined
): Promise<string> {
  return (await walletFor(net, poolId)).wallet.generateAddress()
}

export async function shieldedStatus(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedStatusView> {
  return statusOf(await walletFor(net, poolId))
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
  // whileSubmitting lets a shield go while an earlier deposit, which may yet land, is submitting.
  const request = { amount, signer, whileSubmitting }
  const before = (await wallet.deposits()).length
  try {
    const receipt = await wallet.shield(request)
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

export interface SpendRequest {
  kind: 'send' | 'unshield'
  to: string
  amount: bigint
  selfRelay: boolean
}

export async function shieldedSpend(
  net: NetworkConfig,
  poolId: string,
  req: SpendRequest
): Promise<ShieldedStep> {
  const { wallet, pool, signer } = await walletFor(net, poolId)
  if (req.kind === 'send') {
    return startReviewed((confirm) =>
      wallet.send({ to: req.to, amount: req.amount, maxFee: pool.maxRelayerFee, confirm })
    )
  }
  const route = req.selfRelay ? { selfRelay: signer } : { maxFee: pool.maxRelayerFee }
  // Without split the SDK answers an unshield with a single submission.
  return startReviewed(
    (confirm) =>
      wallet.unshield({ to: req.to, amount: req.amount, confirm, ...route }) as Promise<Submission>
  )
}

export async function shieldedRetry(
  net: NetworkConfig,
  poolId: string,
  planId: string,
  selfRelay: boolean
): Promise<ShieldedStep> {
  const { wallet, pool, signer } = await walletFor(net, poolId)
  const route = selfRelay ? { selfRelay: signer } : { maxFee: pool.maxRelayerFee }
  return startReviewed((confirm) => wallet.retry(planId, { confirm, ...route }))
}

export function shieldedDecide(reviewId: string, approve: boolean): Promise<ShieldedStep> {
  return decideReview(reviewId, approve)
}
