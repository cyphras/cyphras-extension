import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

export type NoteStatus = 'pending' | 'committed' | 'scheduled' | 'revealed' | 'failed'

export interface NoteRecord {
  counter: number
  pool: string
  asset: string
  token: string
  denomination: string
  relayerFee: string
  recipient: string
  privacyLevel: 'fast' | 'standard' | 'maximum'
  status: NoteStatus
  leafIndex: number | null
  root: string | null
  commitment: string | null
  txHash: string | null
  // The self-reclaim reveal tx (when the owner reveals to themselves), so History folds its public op in
  // the same way the commit op is folded.
  revealTxHash?: string
  jobId: string | null
  // When the relayer will execute the reveal (privacy delay), so the UI can show a delivery ETA.
  scheduledFor?: string
  // When scheduling happened, so the UI knows the full delay window (scheduledFor - scheduledAt) and can
  // advance the delivery bar in step with the countdown rather than guessing the duration.
  scheduledAt?: number
  // A broadcast whose leaf never appears is only resubmitted after its validity window elapses, so
  // the original can no longer land.
  broadcastAt?: number
  // The processor's last on-chain check that this note's commit leaf is in the pool. Lets the UI show
  // what actually left the wallet (a verified deposit) instead of the intended amount; refreshed each pass.
  committedOnChain?: boolean
  // The commit tx's fee_charged (stroops), captured at commit confirm for an exact local fee total; absent on crash-recovered/pre-feature notes.
  commitFeeStroops?: string
  // Bounds commit retries so a note that keeps failing is eventually given up on.
  commitAttempts?: number
  lastError?: string
  // Revealed back to the sender's own account because the recipient could not receive; the UI shows
  // "Recovered" rather than "Delivered".
  recovered?: boolean
  // Shared by every note from one send so History groups splits by send rather than by timing.
  batchId?: string
  createdAt: number
}

const STORAGE_PREFIX = 'cyphras_private_notes_'

// Notes re-derive from the seed, so this only encrypts a cache; the key hides recipients, amounts,
// and timing at rest and ties the cache to an unlocked wallet.
export async function deriveNoteKey(seed: Uint8Array): Promise<CryptoKey> {
  const info = new TextEncoder().encode('cyphras/v1/note-store-key')
  const raw = hkdf(sha256, seed, new Uint8Array(0), info, 32)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export async function loadNotes(account: string, key: CryptoKey): Promise<NoteRecord[]> {
  const stored = await chrome.storage.local.get(STORAGE_PREFIX + account)
  const blob = stored[STORAGE_PREFIX + account] as string | undefined
  if (!blob) {
    return []
  }
  const { iv, data } = JSON.parse(blob) as { iv: string; data: string }
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(iv) }, key, fromHex(data))
  } catch {
    // Notes re-derive from the seed, so an undecryptable blob is treated as cold, not a failure.
    return []
  }
  return JSON.parse(new TextDecoder().decode(plain)) as NoteRecord[]
}

export async function saveNotes(
  account: string,
  key: CryptoKey,
  notes: NoteRecord[]
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(notes))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const blob = JSON.stringify({ iv: toHex(iv), data: toHex(new Uint8Array(data)) })
  await chrome.storage.local.set({ [STORAGE_PREFIX + account]: blob })
}
