// Background wiring for private mode; all shielded crypto runs in the offscreen since snarkjs crashes MV3 service workers.
import type { NetworkConfig, ShieldedConfig } from '@constants/networks'
import { TESTNET_PASSPHRASE } from '@constants/networks'
import { Keypair } from '@stellar/stellar-sdk'
import {
  getAccountsStore,
  getSessionMnemonic,
  getSessionExtraHDMnemonics,
  deriveKeypairRaw,
} from './keyManager'
import { getActiveNetwork } from './networkManager'
import { serializePool, type Pool, type SerializedPool } from '../shielded/config'
import {
  submitPlan,
  awaitTx,
  notesSpentByNullifiers,
  deserializeSpendPlan,
  type SerializedSpendPlan,
} from '../shielded/submit'
import { getQuoteDetail, type Quote } from '../shielded/relayer'
import type { Note } from '../shielded/notes'
import { offscreenShielded } from './offscreenProverShielded'
import {
  loadShieldedNotes,
  addShieldedNotes,
  markShieldedSpent,
  shieldedBalance,
  shieldedMaxSpendable,
} from './shieldedNotes'

export interface ShieldedEnv {
  mnemonic: string
  account: number // BIP44 index, for deriving the shielded wallet in the offscreen
  pool: Pool
  signer: Keypair // account Stellar keypair == wallet.stellar; signs self-signed shields
  accountPk: string // active Stellar public key, keys the note store
}

// Private mode is testnet-only: the solo trusted setup is forgeable, so any other network is refused.
export function assertShieldedAllowed(net: NetworkConfig): void {
  if (
    net.id !== 'testnet' ||
    net.passphrase !== TESTNET_PASSPHRASE ||
    (net.shielded?.length ?? 0) === 0
  ) {
    throw new Error('private mode is testnet only')
  }
}

// Resolve the active account's HD mnemonic; imported single-key accounts cannot derive spend keys and are refused.
async function activeMnemonic(walletId: string | undefined): Promise<string> {
  if (walletId?.startsWith('sk:')) {
    throw new Error('private mode needs an HD account (imported keys are not supported)')
  }
  if (!walletId || walletId === 'primary') {
    const mnemonic = await getSessionMnemonic()
    if (!mnemonic) throw new Error('wallet locked')
    return mnemonic
  }
  const extras = await getSessionExtraHDMnemonics()
  const mnemonic = extras[walletId]
  if (!mnemonic) throw new Error('wallet locked')
  return mnemonic
}

// Resolve the shielded block for poolId (defaults to first pool); throws so a stale poolId never falls back to XLM.
function resolveShielded(net: NetworkConfig, poolId?: string): ShieldedConfig {
  const pools = net.shielded ?? []
  if (poolId === undefined) return pools[0]
  const match = pools.find((p) => p.poolId === poolId)
  if (!match) throw new Error('unknown pool')
  return match
}

// Map a network shielded block to the lib Pool the offscreen rebuilds from.
function shieldedPool(s: ShieldedConfig): Pool {
  return {
    id: s.poolId,
    label: s.label,
    vaultId: s.vaultId,
    domain: BigInt(s.domain),
    indexerUrl: s.indexerUrl,
    relayerUrl: s.relayerUrl,
    relayerAddress: s.relayerAddress,
    native: s.native,
    assetCode: s.assetCode,
    assetIssuer: s.assetIssuer,
    decimals: s.decimals,
    maxDeposit: BigInt(s.maxDeposit),
  }
}

// Build the shielded env; derives only the account Stellar keypair here (spend keys are derived in the offscreen).
export async function buildShieldedEnv(net: NetworkConfig, poolId?: string): Promise<ShieldedEnv> {
  assertShieldedAllowed(net)
  const pool = shieldedPool(resolveShielded(net, poolId))
  const store = await getAccountsStore()
  const activePk =
    store.activePublicKey ?? store.accounts.find((a) => a.index === store.activeIndex)?.publicKey
  const active = store.accounts.find((a) => a.publicKey === activePk)
  if (!active) throw new Error('no active account')
  const mnemonic = await activeMnemonic(active.walletId)
  const { secret } = await deriveKeypairRaw(mnemonic, active.index)
  const signer = Keypair.fromSecret(secret)
  if (signer.publicKey() !== active.publicKey) {
    throw new Error('active account does not match the unlocked wallet')
  }
  return {
    mnemonic,
    account: active.index,
    pool,
    signer,
    accountPk: active.publicKey,
  }
}

// Serializes every shielded operation so two spends never interleave on the shared note store.
let shieldedChain: Promise<unknown> = Promise.resolve()

function withShieldedLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = shieldedChain.then(fn, fn)
  shieldedChain = run.catch(() => undefined) // keep the chain alive on rejection so one failure does not wedge the queue
  return run
}

// Re-assert the gate right before submit, closing the race where the user switches off testnet mid-build.
async function reassertTestnet(): Promise<void> {
  const fresh = await getActiveNetwork()
  assertShieldedAllowed(fresh)
}

// The serialized pool the offscreen rebuilds the lib Pool from.
function offscreenArgs(env: ShieldedEnv): {
  network: string
  mnemonic: string
  account: number
  pool: SerializedPool
} {
  return {
    network: 'testnet',
    mnemonic: env.mnemonic,
    account: env.account,
    pool: serializePool(env.pool),
  }
}

// Persist a plan's note deltas; adds new notes before marking inputs spent so a crash never loses the change note.
async function persistPlan(env: ShieldedEnv, plan: SerializedSpendPlan): Promise<void> {
  await addShieldedNotes(env.pool.id, env.accountPk, plan.added)
  await markShieldedSpent(env.pool.id, env.accountPk, plan.spent)
}

// Submit a relayed spend idempotently; on error the input nullifiers are truth, so an already-spent input means it landed.
async function submitRelayedIdempotent(
  env: ShieldedEnv,
  plan: SerializedSpendPlan
): Promise<string> {
  await reassertTestnet()
  const deser = deserializeSpendPlan(plan)
  try {
    const hash = await submitPlan(env.pool, env.signer, deser)
    await awaitTx(hash)
    await persistPlan(env, plan)
    return hash
  } catch (err) {
    if (await notesSpentByNullifiers(env.pool, plan.proof.nullifiers)) {
      // a previous attempt already landed; reconcile local state and report success
      await persistPlan(env, plan)
      return 'already-submitted'
    }
    throw err
  }
}

export interface ShieldedScanResult {
  added: number
  balance: string
  maxSpendable: string
  noteCount: string // unspent notes, decides single-tx vs multi-chunk loop
}

export interface ShieldedSendResult {
  hash: string
  balance: string
}

// One relayed chunk of an auto-split spend: the up-to-2 largest notes move min(capacity, remaining); the UI loops until done.
export interface ShieldedSpendChunkResult {
  done: boolean // true once the full requested amount has been sent
  remaining: string // stroops still to send after this chunk
  sent: string // stroops moved by this chunk
  balance: string
}

// The cy1 receive address is the wallet's pk_d, identical for every pool, so poolId defaults to the first.
export async function shieldedReceiveAddress(
  net: NetworkConfig,
  poolId?: string
): Promise<{ address: string }> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    const address = (await offscreenShielded({ op: 'address', ...offscreenArgs(env) })) as string
    return { address }
  })
}

export async function shieldedQuote(net: NetworkConfig, poolId: string): Promise<Quote> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    return getQuoteDetail(env.pool)
  })
}

// Count of unspent notes; the UI uses it to decide whether an amount fits one 2-note spend or must auto-split into chunks.
async function unspentNoteCount(poolId: string, account: string): Promise<number> {
  return (await loadShieldedNotes(poolId, account)).filter((n) => !n.spent).length
}

export async function shieldedGetBalance(
  net: NetworkConfig,
  poolId: string
): Promise<{ balance: string; maxSpendable: string; noteCount: string }> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    return {
      balance: (await shieldedBalance(env.pool.id, env.accountPk)).toString(),
      maxSpendable: (await shieldedMaxSpendable(env.pool.id, env.accountPk)).toString(),
      noteCount: (await unspentNoteCount(env.pool.id, env.accountPk)).toString(),
    }
  })
}

export async function shieldedScan(
  net: NetworkConfig,
  poolId: string
): Promise<ShieldedScanResult> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    const knownCommitments = (await loadShieldedNotes(env.pool.id, env.accountPk)).map(
      (n) => n.commitment
    )
    const found = (await offscreenShielded({
      op: 'scan',
      ...offscreenArgs(env),
      knownCommitments,
    })) as Note[]
    await addShieldedNotes(env.pool.id, env.accountPk, found)
    return {
      added: found.filter((n) => !n.spent).length,
      balance: (await shieldedBalance(env.pool.id, env.accountPk)).toString(),
      maxSpendable: (await shieldedMaxSpendable(env.pool.id, env.accountPk)).toString(),
      noteCount: (await unspentNoteCount(env.pool.id, env.accountPk)).toString(),
    }
  })
}

export async function shieldedShield(
  net: NetworkConfig,
  poolId: string,
  amount: bigint
): Promise<ShieldedSendResult> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    const plan = (await offscreenShielded({
      op: 'shield',
      ...offscreenArgs(env),
      amount: amount.toString(),
    })) as SerializedSpendPlan
    // re-assert testnet right before signing so a switch mid-build aborts before submit
    await reassertTestnet()
    const hash = await submitPlan(env.pool, env.signer, deserializeSpendPlan(plan))
    await awaitTx(hash)
    await persistPlan(env, plan)
    return { hash, balance: (await shieldedBalance(env.pool.id, env.accountPk)).toString() }
  })
}

export async function shieldedSend(
  net: NetworkConfig,
  poolId: string,
  recipient: string,
  amount: bigint
): Promise<ShieldedSendResult> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    const notes = await selectNotes(env.pool.id, env.accountPk, amount, env.pool)
    const plan = (await offscreenShielded({
      op: 'send',
      ...offscreenArgs(env),
      notes,
      recipientCy1: recipient,
      amount: amount.toString(),
    })) as SerializedSpendPlan
    const hash = await submitRelayedIdempotent(env, plan)
    return { hash, balance: (await shieldedBalance(env.pool.id, env.accountPk)).toString() }
  })
}

// Unshield pays a classic asset that needs the recipient's trustline; check it before the proof so the error is clear.
async function assertUnshieldTrustline(net: NetworkConfig, env: ShieldedEnv): Promise<void> {
  if (!env.pool.assetIssuer || !env.pool.assetCode) return
  let acc: { balances?: { asset_code?: string; asset_issuer?: string }[] }
  try {
    const res = await fetch(`${net.horizonUrl}/accounts/${env.accountPk}`)
    if (!res.ok) return
    acc = (await res.json()) as typeof acc
  } catch {
    return
  }
  const hasTrustline = (acc.balances ?? []).some(
    (b) => b.asset_code === env.pool.assetCode && b.asset_issuer === env.pool.assetIssuer
  )
  if (!hasTrustline) {
    throw new Error(
      `Your account has no ${env.pool.assetCode} trustline. Add it before unshielding.`
    )
  }
}

export async function shieldedUnshield(
  net: NetworkConfig,
  poolId: string,
  amount: bigint
): Promise<ShieldedSendResult> {
  return withShieldedLock(async () => {
    assertShieldedAllowed(net)
    const env = await buildShieldedEnv(net, poolId)
    await assertUnshieldTrustline(net, env)
    const notes = await selectNotes(env.pool.id, env.accountPk, amount, env.pool)
    const plan = (await offscreenShielded({
      op: 'unshield',
      ...offscreenArgs(env),
      notes,
      amount: amount.toString(),
    })) as SerializedSpendPlan
    const hash = await submitRelayedIdempotent(env, plan)
    return { hash, balance: (await shieldedBalance(env.pool.id, env.accountPk)).toString() }
  })
}

// One relayed chunk of an auto-split spend: spends the two largest notes toward `remaining` on each call; fund-safe via scan-before-select, idempotent submit, and add-before-mark persistence.
export async function shieldedSpendChunk(
  net: NetworkConfig,
  poolId: string,
  action: 'send' | 'unshield',
  recipient: string | null,
  remaining: bigint
): Promise<ShieldedSpendChunkResult> {
  return withShieldedLock(async () => {
    if (action === 'send' && !recipient) throw new Error('recipient is required')
    assertShieldedAllowed(net)
    await reassertTestnet()
    const env = await buildShieldedEnv(net, poolId)
    if (action === 'unshield') await assertUnshieldTrustline(net, env)

    // scan before selecting inputs so the note set is on-chain truth before this chunk picks which notes to spend
    const known = (await loadShieldedNotes(env.pool.id, env.accountPk)).map((n) => n.commitment)
    const found = (await offscreenShielded({
      op: 'scan',
      ...offscreenArgs(env),
      knownCommitments: known,
    })) as Note[]
    await addShieldedNotes(env.pool.id, env.accountPk, found)

    const balanceNow = async () => (await shieldedBalance(env.pool.id, env.accountPk)).toString()

    const unspent = (await loadShieldedNotes(env.pool.id, env.accountPk))
      .filter((n) => !n.spent)
      .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))
    if (unspent.length === 0 || remaining <= 0n) {
      return { done: true, remaining: '0', sent: '0', balance: await balanceNow() }
    }

    const fee = (await getQuoteDetail(env.pool)).fee
    const picked = unspent.slice(0, 2)
    const capacity = picked.reduce((s, n) => s + BigInt(n.amount), 0n) - fee
    if (capacity <= 0n) {
      throw new Error('remaining notes are dust (below the relayer fee)')
    }
    const sendThisChunk = capacity < remaining ? capacity : remaining

    const plan = (await offscreenShielded({
      op: action,
      ...offscreenArgs(env),
      notes: picked,
      amount: sendThisChunk.toString(),
      ...(action === 'send' ? { recipientCy1: recipient ?? undefined } : {}),
    })) as SerializedSpendPlan
    await submitRelayedIdempotent(env, plan)

    const left = remaining - sendThisChunk
    return {
      done: left <= 0n,
      remaining: left.toString(),
      sent: sendThisChunk.toString(),
      balance: await balanceNow(),
    }
  })
}

// Pick one or two unspent notes (largest-first) covering amount + fee; more than two is refused since the circuit takes at most two inputs.
async function selectNotes(
  poolId: string,
  accountPk: string,
  amount: bigint,
  pool: Pool
): Promise<Note[]> {
  const fee = (await getQuoteDetail(pool)).fee
  const need = amount + fee
  // no leafIndex filter: the offscreen resolves each note's leaf from its commitment, so the stored index is never required
  const spendable = (await loadShieldedNotes(poolId, accountPk))
    .filter((n) => !n.spent)
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))
  for (let count = 1; count <= 2 && count <= spendable.length; count++) {
    const picked = spendable.slice(0, count)
    if (picked.reduce((s, n) => s + BigInt(n.amount), 0n) >= need) return picked
  }
  const total = spendable.slice(0, 2).reduce((s, n) => s + BigInt(n.amount), 0n)
  if (total < need) throw new Error('not enough shielded balance (try a smaller amount)')
  throw new Error('amount needs more than two notes; consolidate first')
}
