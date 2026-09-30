// CCTP bridge job records for the burn -> attest -> mint pipeline. Stored
// unencrypted: every field is chain-public (hashes, message, attestation).
import { refreshCctpBadge } from './badge'

export type CctpDirection = 'stellar-to-evm' | 'evm-to-stellar'

export type CctpJobStatus =
  | 'created'
  | 'approving'
  | 'burn_submitted'
  | 'burned'
  | 'attested'
  | 'mint_submitted'
  | 'blocked_trustline'
  | 'blocked_gas'
  | 'done'
  | 'failed'

export interface CctpJob {
  id: string
  networkId: string
  direction: CctpDirection
  status: CctpJobStatus
  amount: string // 6-decimal decimal string
  sourceAddress: string
  destAddress: string
  maxFee: string // 6-decimal decimal string, quoted at CCTP_START
  speed?: 'standard' | 'fast' // missing is treated as 'standard'

  // EVM-source jobs only: recorded before the approve is signed, so the
  // processor can tell a dropped approve from a pending one by nonce.
  preBurnNonce?: number
  preBurnBlock?: number

  approveTxHash?: string
  approveBroadcastAt?: number
  burnNonce?: number
  burnTxHash?: string
  burnBroadcastAt?: number

  eventNonce?: string
  message?: string
  attestation?: string
  // Set once per attestation (including a reattest) and untouched by
  // attested <-> mint_submitted re-arms: the mint wall-clock cap measures
  // from here so repeated re-arms cannot push it out indefinitely.
  attestedAt?: number

  mintTxHash?: string
  mintBroadcastAt?: number

  attempts: number
  lastError?: string
  createdAt: number
}

const CCTP_JOBS_PREFIX = 'cyphras_cctp_jobs_'

function cctpJobsKey(networkId: string, stellarPk: string): string {
  return `${CCTP_JOBS_PREFIX}${networkId}_${stellarPk}`
}

export function cctpAccountLockKey(networkId: string, stellarPk: string): string {
  return `${networkId}:${stellarPk}`
}

// Neither networkId ('mainnet'/'testnet') nor a G-address contains an
// underscore, so splitting on the first one after the prefix is unambiguous.
export function parseCctpJobsKey(key: string): { networkId: string; stellarPk: string } | null {
  if (!key.startsWith(CCTP_JOBS_PREFIX)) return null
  const rest = key.slice(CCTP_JOBS_PREFIX.length)
  const sep = rest.indexOf('_')
  if (sep === -1) return null
  return { networkId: rest.slice(0, sep), stellarPk: rest.slice(sep + 1) }
}

export async function listAllCctpJobKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null)
  return Object.keys(all).filter((k) => k.startsWith(CCTP_JOBS_PREFIX))
}

async function readJobs(networkId: string, stellarPk: string): Promise<CctpJob[]> {
  const key = cctpJobsKey(networkId, stellarPk)
  const result = await chrome.storage.local.get(key)
  const data = result[key]
  return Array.isArray(data) ? (data as CctpJob[]) : []
}

async function writeJobs(networkId: string, stellarPk: string, jobs: CctpJob[]): Promise<void> {
  await chrome.storage.local.set({ [cctpJobsKey(networkId, stellarPk)]: jobs })
  void refreshCctpBadge()
}

export async function listCctpJobs(networkId: string, stellarPk: string): Promise<CctpJob[]> {
  return readJobs(networkId, stellarPk)
}

export const CCTP_TERMINAL_STATUSES: CctpJobStatus[] = ['done', 'failed']
const TERMINAL_STATUSES = CCTP_TERMINAL_STATUSES

// One in-memory promise chain per account. Hold it across the whole
// read-decide-write, not just the storage write, so a processor pass cannot
// race a live CCTP_START for the same account.
const accountLocks = new Map<string, Promise<unknown>>()

export function withCctpAccountLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(lockKey) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  accountLocks.set(
    lockKey,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

export class CctpDuplicateJobError extends Error {
  readonly existingJobId: string

  constructor(existingJobId: string) {
    super('A bridge for this direction is already in progress')
    this.existingJobId = existingJobId
  }
}

// Call under the account lock, before any network call. Rejects if a
// non-terminal job exists for this direction, so a popup re-confirm or two
// open windows cannot both start a bridge.
export async function createCctpJob(
  networkId: string,
  stellarPk: string,
  params: {
    id: string
    direction: CctpDirection
    amount: string
    sourceAddress: string
    destAddress: string
    maxFee: string
    speed: 'standard' | 'fast'
    createdAt: number
  }
): Promise<CctpJob> {
  const jobs = await readJobs(networkId, stellarPk)
  const existing = jobs.find(
    (j) => j.direction === params.direction && !TERMINAL_STATUSES.includes(j.status)
  )
  if (existing) throw new CctpDuplicateJobError(existing.id)

  const job: CctpJob = {
    id: params.id,
    networkId,
    direction: params.direction,
    status: 'created',
    amount: params.amount,
    sourceAddress: params.sourceAddress,
    destAddress: params.destAddress,
    maxFee: params.maxFee,
    speed: params.speed,
    attempts: 0,
    createdAt: params.createdAt,
  }
  await writeJobs(networkId, stellarPk, [...jobs, job])
  return job
}

// Read-modify-write: callers must hold withCctpAccountLock for this account;
// it is not enforced here.
export async function patchCctpJob(
  networkId: string,
  stellarPk: string,
  jobId: string,
  patch: Partial<Omit<CctpJob, 'id' | 'networkId' | 'direction' | 'createdAt'>>
): Promise<CctpJob> {
  const jobs = await readJobs(networkId, stellarPk)
  const index = jobs.findIndex((j) => j.id === jobId)
  if (index === -1) throw new Error(`cctp job not found: ${jobId}`)
  const updated: CctpJob = { ...jobs[index], ...patch }
  const next = [...jobs]
  next[index] = updated
  await writeJobs(networkId, stellarPk, next)
  return updated
}
