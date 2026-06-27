import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk'
import { initPoseidon } from '../private/poseidon.js'
import { deriveNoteSecrets, deriveAccountSeed } from '../private/derive.js'
import { innerCommitment, leafHash } from '../private/note.js'
import { buildMerklePath } from '../private/merkle.js'
import { splitAmount } from '../private/denominations.js'
import { addressToField } from '../private/address.js'
import type { ProofInputs, ProvedReveal } from '../private/proof.js'
import { RelayerClient, type PrivacyLevel } from '../private/relayerClient.js'
import { assertPoolRegistered, PoolMismatchError, type FactoryConfig } from '../private/factory.js'
import { deriveNoteKey, loadNotes, saveNotes, type NoteRecord } from '../private/storage.js'

export interface PrivateEnv {
  factory: FactoryConfig
  relayerUrl: string
  network: string
  // Sender account; the simulate source for the factory check and the notes-store key.
  source: string
  // Note secrets derive from this, not the wallet mnemonic, so every account type (HD index, extra
  // seed phrase, imported key) has independent, recoverable notes.
  secret: string
  // Read the account's on-chain commit history for seed-based recovery after storage loss.
  horizonUrl: string
  // Notes are stored per account across all networks, so listing and processing scope to the active
  // network's token addresses.
  tokens: string[]
  // Commit transaction validity window, in seconds. Optional; commitOne falls back to the maximum
  // allowed timeout so an unset value never resubmits while the original could still land.
  txTimeout?: number
}

export interface SendParams {
  recipient: string
  asset: string
  token: string
  amount: bigint
  privacyLevel: PrivacyLevel
}

// Build, sign, and submit one pool.commit; resolves on confirm with the tx hash and (when observed) its fee_charged. Injected because the background owns signing.
export type SubmitCommit = (
  pool: string,
  innerCommitmentHex: string,
  relayerFee: bigint,
  // Called when the commit is broadcast, before confirmation, so the caller persists the hash and
  // never resubmits a deposit if the worker dies mid-confirmation.
  onBroadcast: (txHash: string) => Promise<void>
) => Promise<{ txHash: string; feeStroops?: string }>

// Generate the Groth16 proof off the service worker; snarkjs is too heavy for an ephemeral worker,
// so this routes to an offscreen document.
export type GenerateProof = (inputs: ProofInputs) => Promise<ProvedReveal>

// Submit pool.reveal signed by the active account, for a self-reclaim that bypasses the relayer.
export type SubmitReveal = (pool: string, proved: ProvedReveal) => Promise<{ txHash: string }>

export interface RevealDeps {
  generateProof: GenerateProof
}

export interface ReclaimDeps {
  generateProof: GenerateProof
  submitReveal: SubmitReveal
}

// The fate of a broadcast commit tx, so a dropped or reverted one is resubmitted as soon as it can no
// longer land, instead of always waiting the full validity + indexer window.
export type CommitTxStatus = 'success' | 'failed' | 'not_found'

// isUnlocked aborts the loop the moment the wallet locks mid-run, so an auto-lock never leaves the
// processor running without a key.
export interface ProcessDeps {
  submitCommit: SubmitCommit
  generateProof: GenerateProof
  isUnlocked?: () => Promise<boolean>
  // Look up a broadcast commit's on-chain status by hash. Optional: without it, recovery falls back to
  // the conservative validity + indexer time-window.
  getTxStatus?: (txHash: string) => Promise<CommitTxStatus>
}

export class NoteNotReadyError extends Error {}
export class NoteError extends Error {}

// A reveal is already scheduled or done. Only a committed or failed note can be (re)revealed, so two
// intents never overlap; the pool's on-chain nullifier check is the final backstop.
export class RevealConflictError extends Error {}

// No active pool exists for the asset, so the amount cannot be split. Distinct from a representable
// amount that does not split cleanly into existing denominations.
export class NoPoolError extends Error {}

// Give up on a note whose commit keeps failing rather than burn fees retrying forever.
const MAX_COMMIT_ATTEMPTS = 5

// Margin past a commit's validity window before a leaf-less broadcast is resubmitted. Must exceed the
// relayer's index lag (~30s poll + finality) so a landed commit is seen before a resubmit double-deposits.
const COMMIT_INDEXER_MARGIN_MS = 150_000

// True once a broadcast commit can no longer land (its validity window + the relayer's index margin
// have elapsed since broadcast), so resubmitting it cannot double-deposit.
function commitReArmElapsed(note: NoteRecord, env: PrivateEnv): boolean {
  if (!note.txHash) {
    return true
  }
  if (note.broadcastAt == null) {
    return false
  }
  const reArmAfterMs = (env.txTimeout ?? 90) * 1000 + COMMIT_INDEXER_MARGIN_MS
  return Date.now() - note.broadcastAt >= reArmAfterMs
}

type CommitRetry = 'wait' | 'resubmit' | 'landed'

// Decide what to do with a leaf-absent note that has a broadcast hash. Trust the RPC only on terminal
// answers (SUCCESS = landed, hold; FAILED = reverted, resubmit); NOT_FOUND or an error falls back to the
// validity + indexer window. The leaf-absent precondition means a resubmit never double-deposits.
async function commitRetryDecision(
  note: NoteRecord,
  env: PrivateEnv,
  getTxStatus?: (txHash: string) => Promise<CommitTxStatus>
): Promise<CommitRetry> {
  if (getTxStatus && note.txHash) {
    try {
      const status = await getTxStatus(note.txHash)
      if (status === 'success') {
        return 'landed'
      }
      if (status === 'failed') {
        return 'resubmit'
      }
    } catch {}
  }
  return commitReArmElapsed(note, env) ? 'resubmit' : 'wait'
}

function toHex32(value: bigint): string {
  const hex = value.toString(16)
  if (hex.length > 64) {
    throw new NoteError('value exceeds 32 bytes')
  }
  return hex.padStart(64, '0')
}

// The 32-byte ed25519 seed behind a secret key: unique per account and reproduced on restore, so
// note derivation keys off it.
function rawSecretSeed(secret: string): Uint8Array {
  return new Uint8Array(Keypair.fromSecret(secret).rawSecretKey())
}

async function noteKeyFor(env: PrivateEnv): Promise<CryptoKey> {
  return deriveNoteKey(rawSecretSeed(env.secret))
}

function seedFor(env: PrivateEnv): Uint8Array {
  // Per-account, or two accounts derive identical commitments and nullifiers; the second reveal then
  // reverts on the spent nullifier and strands the deposit while the UI shows it delivered.
  return deriveAccountSeed(rawSecretSeed(env.secret), env.source)
}

// Serialize note mutations per account. Two awaited runs (an alarm tick and a fresh send) can
// interleave and read the same counter, deriving duplicate notes or clobbering the storage key.
const sourceLocks = new Map<string, Promise<unknown>>()

function withSourceLock<T>(source: string, fn: () => Promise<T>): Promise<T> {
  const prev = sourceLocks.get(source) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  sourceLocks.set(
    source,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

// Split into fixed denominations and persist every note as pending; commits run later in the processor.
// Persisting before committing means an interrupted send still leaves a recoverable record.
export function prepareSend(params: SendParams, env: PrivateEnv): Promise<NoteRecord[]> {
  return withSourceLock(env.source, () => prepareSendLocked(params, env))
}

async function prepareSendLocked(params: SendParams, env: PrivateEnv): Promise<NoteRecord[]> {
  await initPoseidon()
  const relayer = new RelayerClient(env.relayerUrl, env.network)
  // Concurrent so the send is not waiting on two sequential round-trips.
  const [fee, pools] = await Promise.all([relayer.fee(), relayer.pools()])
  const relayerFee = BigInt(fee.feeStroops)

  const denomsForAsset = pools
    .filter((p) => p.asset === params.asset && p.active)
    .map((p) => BigInt(p.denomination))
  if (denomsForAsset.length === 0) {
    throw new NoPoolError(`no active pool for ${params.asset}`)
  }
  const pieces = splitAmount(params.amount, denomsForAsset)

  const key = await noteKeyFor(env)
  const seed = seedFor(env)
  const notes = await loadNotes(env.source, key)
  let counter = notes.reduce((max, n) => Math.max(max, n.counter + 1), 0)
  // The starting counter is unique per send, so history groups by it instead of timing and keeps two
  // sends to the same recipient close together as distinct rows.
  const batchId = String(counter)
  const created: NoteRecord[] = []

  for (const piece of pieces) {
    const pool = pools.find(
      (p) => p.asset === params.asset && BigInt(p.denomination) === piece.denomination && p.active
    )
    if (!pool) {
      throw new NoteError(`no active pool for ${params.asset} ${piece.denomination}`)
    }
    for (let i = 0; i < piece.count; i++) {
      const secrets = deriveNoteSecrets(seed, counter)
      const inner = innerCommitment(secrets, piece.denomination, addressToField(params.token))
      const note: NoteRecord = {
        counter,
        pool: pool.address,
        asset: params.asset,
        token: params.token,
        denomination: piece.denomination.toString(),
        relayerFee: relayerFee.toString(),
        recipient: params.recipient,
        privacyLevel: params.privacyLevel,
        status: 'pending',
        leafIndex: null,
        root: null,
        commitment: toHex32(inner),
        txHash: null,
        jobId: null,
        commitAttempts: 0,
        batchId,
        createdAt: Date.now(),
      }
      notes.push(note)
      created.push(note)
      counter++
    }
  }
  await saveNotes(env.source, key, notes)
  return created
}

// The leaf is the idempotency anchor for the commit guard and the reveal: fully reconstructable from
// the stored commitment and relayer fee, so it survives any crash.
function noteLeaf(note: NoteRecord): bigint {
  if (note.commitment === null) {
    throw new NoteError(`note ${note.counter} has no commitment`)
  }
  return leafHash(BigInt('0x' + note.commitment), BigInt(note.relayerFee))
}

// Commit one pending note. If the leaf is already on-chain the commit landed (maybe in a prior run) and
// resubmitting would double-deposit, so submit only when the leaf is absent and the prior broadcast can
// no longer land (confirmed via the tx status, or the validity window as a fallback).
async function commitOne(
  note: NoteRecord,
  env: PrivateEnv,
  getLeaves: (pool: string) => Promise<bigint[]>,
  submitCommit: SubmitCommit,
  persist: () => Promise<void>,
  getTxStatus?: (txHash: string) => Promise<CommitTxStatus>
): Promise<void> {
  const leaf = noteLeaf(note)
  const leaves = await getLeaves(note.pool)
  if (leaves.includes(leaf)) {
    note.status = 'committed'
    return
  }
  if (note.txHash) {
    if (note.broadcastAt == null) {
      note.broadcastAt = Date.now()
      await persist()
    }
    const decision = await commitRetryDecision(note, env, getTxStatus)
    if (decision !== 'resubmit') {
      note.status = 'committed'
      return
    }
    note.txHash = null
    await persist()
  }
  try {
    await assertPoolRegistered(
      env.factory,
      env.source,
      note.token,
      BigInt(note.denomination),
      note.pool
    )
    // Count only attempts past the pool check, so a transient RPC failure there does not burn the
    // retry budget toward a permanent failure.
    note.commitAttempts = (note.commitAttempts ?? 0) + 1
    const { txHash, feeStroops } = await submitCommit(
      note.pool,
      note.commitment as string,
      BigInt(note.relayerFee),
      async (hash) => {
        note.txHash = hash
        note.broadcastAt = Date.now()
        await persist()
      }
    )
    note.txHash = txHash
    if (feeStroops) {
      note.commitFeeStroops = feeStroops
    }
    note.status = 'committed'
    delete note.lastError
  } catch (err) {
    // A throw means the deposit did not complete, so any hash from onBroadcast is stale; clear it so
    // the txHash guard does not wrongly block a retry.
    note.txHash = null
    note.lastError = (err as Error).message
    // Only a pool mismatch (a relayer redirect attempt) or an exhausted retry budget is permanent.
    // Transient RPC/network errors leave the note pending for the next tick.
    if (err instanceof PoolMismatchError || (note.commitAttempts ?? 0) >= MAX_COMMIT_ATTEMPTS) {
      note.status = 'failed'
    }
  }
}

export function revealNote(counter: number, env: PrivateEnv, deps: RevealDeps): Promise<void> {
  return withSourceLock(env.source, () => revealNoteLocked(counter, env, deps))
}

async function revealNoteLocked(counter: number, env: PrivateEnv, deps: RevealDeps): Promise<void> {
  await initPoseidon()
  const key = await noteKeyFor(env)
  const seed = seedFor(env)
  const notes = await loadNotes(env.source, key)
  const note = notes.find((n) => n.counter === counter)
  if (!note || note.commitment === null) {
    throw new NoteError(`note ${counter} not found`)
  }
  if (note.status === 'pending') {
    throw new NoteError(`note ${counter} is not committed yet`)
  }
  if (note.status === 'scheduled') {
    throw new RevealConflictError('a reveal is already in progress for this payment')
  }
  if (note.status === 'revealed') {
    throw new RevealConflictError('this payment was already delivered')
  }
  const relayer = new RelayerClient(env.relayerUrl, env.network)
  const leaves = await relayer.leaves(note.pool)
  try {
    await reveal(note, seed, relayer, leaves, deps.generateProof)
    await saveNotes(env.source, key, notes)
  } catch (err) {
    await saveNotes(env.source, key, notes)
    throw err
  }
}

interface OnChainCommit {
  pool: string
  commitment: bigint
  relayerFee: bigint
  // The commit tx hash, so a recovered note carries it and History folds the public "Contract call"
  // op into the private-sent row instead of showing both.
  txHash: string
  // The on-chain commit time, so a recovered note shows at its original send time, not recovery time.
  createdAt: string
}

// Bound on the per-account note counter swept during recovery. The counter is global and monotonic, so
// this caps the work for an account with an extreme number of notes rather than scanning forever.
const RECOVERY_COUNTER_CAP = 4096

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return BigInt('0x' + hex)
}

// Pull (pool, commitment, fee) from an invoke_host_function record if it is a commit() to a known pool.
// Arguments are matched by ScVal type, not position, so the parse survives any encoding-order change.
function parseCommitOperation(
  rec: { parameters?: { value: string }[]; transaction_hash: string; created_at: string },
  pools: Set<string>
): OnChainCommit | null {
  if (!rec.parameters) {
    return null
  }
  let isCommit = false
  let pool: string | null = null
  let commitment: bigint | null = null
  let relayerFee: bigint | null = null
  for (const param of rec.parameters) {
    let native: unknown
    try {
      native = scValToNative(xdr.ScVal.fromXDR(param.value, 'base64'))
    } catch {
      continue
    }
    if (native === 'commit') {
      isCommit = true
    } else if (typeof native === 'string' && pools.has(native)) {
      pool = native
    } else if (native instanceof Uint8Array && native.length === 32) {
      commitment = bytesToBigInt(native)
    } else if (typeof native === 'bigint') {
      relayerFee = native
    }
  }
  if (!isCommit || pool === null || commitment === null || relayerFee === null) {
    return null
  }
  return {
    pool,
    commitment,
    relayerFee,
    txHash: rec.transaction_hash,
    createdAt: rec.created_at,
  }
}

// The user's own account signs and pays every commit, so each deposit is in that account's operation
// history. Reading it lets notes be rebuilt from the seed alone, with no dependence on local storage.
async function scanAccountCommits(
  horizonUrl: string,
  account: string,
  pools: Set<string>
): Promise<OnChainCommit[]> {
  const found: OnChainCommit[] = []
  let url = `${horizonUrl.replace(/\/$/, '')}/accounts/${account}/operations?limit=200&order=asc&include_failed=false`
  for (let page = 0; page < 50; page++) {
    const res = await fetch(url)
    if (!res.ok) {
      break
    }
    const body = (await res.json()) as {
      _embedded?: {
        records?: {
          type: string
          parameters?: { value: string }[]
          transaction_hash: string
          created_at: string
        }[]
      }
      _links?: { next?: { href?: string } }
    }
    const records = body._embedded?.records ?? []
    for (const rec of records) {
      if (rec.type !== 'invoke_host_function') {
        continue
      }
      const commit = parseCommitOperation(rec, pools)
      if (commit) {
        found.push(commit)
      }
    }
    const next = body._links?.next?.href
    if (!next || records.length === 0) {
      break
    }
    url = next
  }
  return found
}

// Rebuild any note this account committed on-chain that is missing from local storage (storage cleared,
// reinstall, new device). Derives each note's counter by matching the seed-derived commitment to the
// on-chain one, then records it as committed so the processor reveals it back to the owner.
export function recoverFromSeed(env: PrivateEnv): Promise<NoteRecord[]> {
  return withSourceLock(env.source, () => recoverFromSeedLocked(env))
}

async function recoverFromSeedLocked(env: PrivateEnv): Promise<NoteRecord[]> {
  if (!env.horizonUrl) {
    return []
  }
  await initPoseidon()
  const relayer = new RelayerClient(env.relayerUrl, env.network)
  const pools = await relayer.pools()
  if (pools.length === 0) {
    return []
  }
  const poolMap = new Map(pools.map((p) => [p.address, p]))
  const onChain = await scanAccountCommits(env.horizonUrl, env.source, new Set(poolMap.keys()))
  if (onChain.length === 0) {
    return []
  }

  const key = await noteKeyFor(env)
  const seed = seedFor(env)
  const notes = await loadNotes(env.source, key)
  const known = new Set(notes.map((n) => n.commitment))
  const remaining = onChain.filter((c) => !known.has(toHex32(c.commitment)))
  if (remaining.length === 0) {
    return []
  }

  const recovered: NoteRecord[] = []
  for (let counter = 0; counter < RECOVERY_COUNTER_CAP && remaining.length > 0; counter++) {
    const secrets = deriveNoteSecrets(seed, counter)
    for (let i = remaining.length - 1; i >= 0; i--) {
      const target = remaining[i]
      const pool = poolMap.get(target.pool)
      if (!pool) {
        remaining.splice(i, 1)
        continue
      }
      const commitment = innerCommitment(
        secrets,
        BigInt(pool.denomination),
        addressToField(pool.token)
      )
      if (commitment !== target.commitment) {
        continue
      }
      recovered.push({
        counter,
        pool: target.pool,
        asset: pool.asset,
        token: pool.token,
        denomination: pool.denomination,
        relayerFee: target.relayerFee.toString(),
        // The original recipient is not recoverable (a reveal-time input, never committed), so a
        // recovered note is revealed back to its owner; the user re-sends if still needed.
        recipient: env.source,
        // The original level is not on-chain; self-reclaim uses the default.
        privacyLevel: 'standard',
        status: 'committed',
        leafIndex: null,
        root: null,
        commitment: toHex32(target.commitment),
        // Carry the commit tx so History folds the public op in; not used to drive a re-commit since
        // this note is already committed.
        txHash: target.txHash,
        jobId: null,
        commitAttempts: 0,
        batchId: `recovered-${counter}`,
        // Original send time from the on-chain commit, not the recovery time.
        createdAt: new Date(target.createdAt).getTime(),
      })
      remaining.splice(i, 1)
    }
  }

  if (remaining.length > 0) {
    // Unmatched on-chain deposits: counter past the cap, the scan truncated, or the relayer reported
    // pool denomination/token that does not match the deposit. Surface it rather than lose it silently.
    console.warn(`recovery left ${remaining.length} on-chain deposit(s) unmatched`)
  }

  if (recovered.length > 0) {
    notes.push(...recovered)
    await saveNotes(env.source, key, notes)
  }
  return recovered
}

async function reveal(
  note: NoteRecord,
  seed: Uint8Array,
  relayer: RelayerClient,
  leaves: bigint[],
  generateProof: GenerateProof,
  // Overrides the stored recipient for recovery. The recipient is a reveal-time input, not bound in
  // the commitment, so this is always valid.
  recipientOverride?: string
): Promise<void> {
  const leaf = noteLeaf(note)
  const leafIndex = leaves.findIndex((l) => l === leaf)
  if (leafIndex < 0) {
    throw new NoteNotReadyError(`note ${note.counter} not yet indexed by the relayer`)
  }
  const merkle = buildMerklePath(leaves, leafIndex)
  const fee = await relayer.fee()
  const secrets = deriveNoteSecrets(seed, note.counter)
  const recipient = recipientOverride ?? note.recipient

  let proved: ProvedReveal
  try {
    proved = await generateProof({
      secrets,
      amount: BigInt(note.denomination),
      relayerFee: BigInt(note.relayerFee),
      recipient,
      relayer: fee.relayer,
      assetContract: note.token,
      merkle,
    })
  } catch (err) {
    // A proof error means bad inputs, not a transient fault: mark failed so the loop stops retrying.
    note.status = 'failed'
    note.lastError = (err as Error).message
    throw err
  }

  // A schedule failure is transient, so do not mark failed: leave the note committed for the next
  // tick and let confirmScheduled reconcile a delivery an earlier attempt may already have made.
  const result = await relayer.schedule({
    pool: note.pool,
    proof: proved.proof,
    root: proved.root,
    nullifierHash: proved.nullifierHash,
    amountHash: proved.amountHash,
    recipient,
    relayer: fee.relayer,
    xlmFee: proved.xlmFee,
    privacyLevel: note.privacyLevel,
  })
  note.status = 'scheduled'
  note.jobId = result.jobId
  note.scheduledFor = result.scheduledFor
  note.scheduledAt = Date.now()
  note.leafIndex = leafIndex
  note.root = proved.root
  delete note.lastError
}

// Reconcile a scheduled note with the relayer's job. A status fetch error is transient and never
// changes state.
async function confirmScheduled(note: NoteRecord, relayer: RelayerClient): Promise<void> {
  if (!note.jobId) {
    return
  }
  try {
    const job = await relayer.status(note.jobId)
    if (job.status === 'confirmed') {
      note.status = 'revealed'
      if (job.txHash) {
        note.revealTxHash = job.txHash
      }
    } else if (job.status === 'failed' || job.status === 'dead') {
      // A revert on an already-used nullifier means an earlier attempt already delivered this note.
      if ((job.failureReason ?? '').toLowerCase().includes('nullifier')) {
        note.status = 'revealed'
      } else {
        // Clear the recovery intent so the note shows a plain failed state and re-offers
        // retry/recover, instead of being stuck displaying "Recovering" forever.
        note.status = 'failed'
        note.recovered = false
        note.lastError =
          job.failureReason ??
          (job.status === 'dead' ? 'delivery exhausted retries' : 'reveal failed')
      }
    }
  } catch {
    /* transient: leave scheduled, retry next tick */
  }
}

// Reclaim a note directly to the owner: submit reveal() from the user's own account with recipient =
// relayer = self, so the denomination and the escrowed relayer fee both return. No relayer and no
// privacy delay; the on-chain nullifier check still blocks any double-spend with a pending relayer job.
export function selfReclaim(counter: number, env: PrivateEnv, deps: ReclaimDeps): Promise<void> {
  return withSourceLock(env.source, () => selfReclaimLocked(counter, env, deps))
}

async function selfReclaimLocked(
  counter: number,
  env: PrivateEnv,
  deps: ReclaimDeps
): Promise<void> {
  await initPoseidon()
  const key = await noteKeyFor(env)
  const seed = seedFor(env)
  const notes = await loadNotes(env.source, key)
  const note = notes.find((n) => n.counter === counter)
  if (!note || note.commitment === null) {
    throw new NoteError(`note ${counter} not found`)
  }
  if (note.status === 'pending') {
    throw new NoteError(`note ${counter} is not committed yet`)
  }
  if (note.status === 'revealed') {
    throw new RevealConflictError('this payment was already delivered')
  }

  const relayer = new RelayerClient(env.relayerUrl, env.network)
  const leaves = await relayer.leaves(note.pool)
  const leaf = noteLeaf(note)
  const leafIndex = leaves.findIndex((l) => l === leaf)
  if (leafIndex < 0) {
    throw new NoteNotReadyError(`note ${counter} not yet indexed by the relayer`)
  }
  const merkle = buildMerklePath(leaves, leafIndex)
  const secrets = deriveNoteSecrets(seed, note.counter)

  let proved: ProvedReveal
  try {
    proved = await deps.generateProof({
      secrets,
      amount: BigInt(note.denomination),
      relayerFee: BigInt(note.relayerFee),
      recipient: env.source,
      relayer: env.source,
      assetContract: note.token,
      merkle,
    })
  } catch (err) {
    // Drop any prior recovery intent so the note reads as a plain failed state, not a stuck "Recovering".
    note.status = 'failed'
    note.recovered = false
    note.lastError = (err as Error).message
    await saveNotes(env.source, key, notes)
    throw err
  }

  try {
    const { txHash } = await deps.submitReveal(note.pool, proved)
    note.status = 'revealed'
    note.recovered = true
    note.revealTxHash = txHash
    note.leafIndex = leafIndex
    note.root = proved.root
    delete note.lastError
    await saveNotes(env.source, key, notes)
  } catch (err) {
    // A spent nullifier means a relayer job delivered this note first: resolve as delivered, not failed.
    if ((err as Error).message?.toLowerCase().includes('nullifier')) {
      note.status = 'revealed'
      await saveNotes(env.source, key, notes)
      return
    }
    note.lastError = (err as Error).message
    await saveNotes(env.source, key, notes)
    throw err
  }
}

// Advance every in-flight note one step. Crash-safe: re-running recovers from persisted state without
// double-committing (leaf guard) or double-revealing (nullifier rejected, scheduled notes skipped).
export function processNotes(env: PrivateEnv, deps: ProcessDeps): Promise<void> {
  return withSourceLock(env.source, () => processNotesLocked(env, deps))
}

async function processNotesLocked(env: PrivateEnv, deps: ProcessDeps): Promise<void> {
  await initPoseidon()
  const relayer = new RelayerClient(env.relayerUrl, env.network)
  const key = await noteKeyFor(env)
  const seed = seedFor(env)
  const notes = await loadNotes(env.source, key)

  const persist = () => saveNotes(env.source, key, notes)

  const leavesCache = new Map<string, bigint[]>()
  const getLeaves = async (pool: string): Promise<bigint[]> => {
    let l = leavesCache.get(pool)
    if (!l) {
      l = await relayer.leaves(pool)
      leavesCache.set(pool, l)
    }
    return l
  }

  for (const note of notes) {
    if (!env.tokens.includes(note.token)) {
      continue // belongs to a different network
    }
    if (note.status !== 'pending' && note.status !== 'committed' && note.status !== 'scheduled') {
      continue
    }
    if (deps.isUnlocked && !(await deps.isUnlocked())) {
      return
    }
    try {
      const poolLeaves = await getLeaves(note.pool)
      const onChain = poolLeaves.includes(noteLeaf(note))
      note.committedOnChain = onChain
      if (note.status === 'pending') {
        await commitOne(note, env, getLeaves, deps.submitCommit, persist, deps.getTxStatus)
      } else if (note.status === 'committed') {
        if (onChain) {
          await reveal(note, seed, relayer, poolLeaves, deps.generateProof)
        } else if (!note.recovered) {
          note.status = 'pending'
          await commitOne(note, env, getLeaves, deps.submitCommit, persist, deps.getTxStatus)
        }
      } else {
        await confirmScheduled(note, relayer)
      }
    } catch (err) {
      // reveal() throws when the leaf is not yet indexed (note stays committed for the next tick) or
      // on a hard error (already marked failed); commitOne and confirmScheduled handle their own.
      void err
    }
    await saveNotes(env.source, key, notes)
  }
}

// Storage-only and network-free, so the frequent History/Home poll is fast and never momentarily empties
// the list on a relayer hiccup. The committedOnChain flag is maintained by the processor.
export async function listNotes(env: PrivateEnv): Promise<NoteRecord[]> {
  const key = await noteKeyFor(env)
  const notes = await loadNotes(env.source, key)
  return notes.filter((n) => env.tokens.includes(n.token))
}

export interface QuotePiece {
  denomination: string
  count: number
  anonSet: number
}

export interface SendQuote {
  feeStroops: string
  pieces: QuotePiece[]
  totalNotes: number
  // Any active pool for the asset; the caller simulates a commit against it to estimate the
  // per-commit network fee. All pools share the same commit logic.
  samplePool: string
}

// Preview the denomination split and per-pool anonymity set for a send. Read-only, so it needs no
// lock and no Poseidon.
export async function quoteSend(
  asset: string,
  amount: bigint,
  env: PrivateEnv
): Promise<SendQuote> {
  const relayer = new RelayerClient(env.relayerUrl, env.network)
  const fee = await relayer.fee()
  const pools = (await relayer.pools()).filter((p) => p.asset === asset && p.active)
  if (pools.length === 0) {
    throw new NoPoolError(`no active pool for ${asset}`)
  }
  const pieces = splitAmount(
    amount,
    pools.map((p) => BigInt(p.denomination))
  )
  const out: QuotePiece[] = []
  for (const piece of pieces) {
    const pool = pools.find((p) => BigInt(p.denomination) === piece.denomination)
    const anonSet = pool ? (await relayer.leaves(pool.address)).length : 0
    out.push({ denomination: piece.denomination.toString(), count: piece.count, anonSet })
  }
  return {
    feeStroops: fee.feeStroops,
    pieces: out,
    totalNotes: out.reduce((sum, p) => sum + p.count, 0),
    samplePool: pools[0].address,
  }
}
