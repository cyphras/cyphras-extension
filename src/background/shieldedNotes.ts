// Encrypted at-rest cache of shielded notes, keyed by (pool, account); notes re-derive from the seed.
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Keypair } from '@stellar/stellar-sdk'
import { getSessionSecret } from './keyManager'
import type { Note } from '../shielded/notes'

const STORAGE_PREFIX = 'cyphras_shielded_notes_'

// Per-pool key so XLM and USDC notes in one vault never mix.
function storageKey(poolId: string, account: string): string {
  return `${STORAGE_PREFIX}${poolId}_${account}`
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

async function deriveKey(seed: Uint8Array): Promise<CryptoKey> {
  const info = new TextEncoder().encode('cyphras/v1/shielded-note-store-key')
  const raw = hkdf(sha256, seed, new Uint8Array(0), info, 32)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// Derived from the active account seed so the cache key follows the unlocked wallet; throws when locked.
async function storeKey(): Promise<CryptoKey> {
  const secret = await getSessionSecret()
  if (!secret) throw new Error('wallet locked')
  const seed = new Uint8Array(Keypair.fromSecret(secret).rawSecretKey())
  return deriveKey(seed)
}

async function readNotes(storeId: string, key: CryptoKey): Promise<Note[]> {
  const stored = await chrome.storage.local.get(storeId)
  const blob = stored[storeId] as string | undefined
  if (!blob) return []
  const { iv, data } = JSON.parse(blob) as { iv: string; data: string }
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(iv) }, key, fromHex(data))
  } catch {
    // Notes re-derive from the seed, so an undecryptable blob is treated as cold.
    return []
  }
  return JSON.parse(new TextDecoder().decode(plain)) as Note[]
}

async function writeNotes(storeId: string, key: CryptoKey, notes: Note[]): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(notes))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const blob = JSON.stringify({ iv: toHex(iv), data: toHex(new Uint8Array(data)) })
  await chrome.storage.local.set({ [storeId]: blob })
}

export async function loadShieldedNotes(poolId: string, account: string): Promise<Note[]> {
  return readNotes(storageKey(poolId, account), await storeKey())
}

// Dedupe by commitment: the globally-unique note id, so a re-scan never adds a second copy.
export async function addShieldedNotes(
  poolId: string,
  account: string,
  notes: Note[]
): Promise<void> {
  if (notes.length === 0) return
  const storeId = storageKey(poolId, account)
  const key = await storeKey()
  const existing = await readNotes(storeId, key)
  const seen = new Set(existing.map((n) => n.commitment))
  for (const n of notes) {
    if (!seen.has(n.commitment)) {
      existing.push(n)
      seen.add(n.commitment)
    }
  }
  await writeNotes(storeId, key, existing)
}

// Keyed on commitment, not blinding: a sender-chosen blinding could collide and mark the wrong note spent.
export async function markShieldedSpent(
  poolId: string,
  account: string,
  commitments: string[]
): Promise<void> {
  if (commitments.length === 0) return
  const storeId = storageKey(poolId, account)
  const key = await storeKey()
  const notes = await readNotes(storeId, key)
  const targets = new Set(commitments)
  for (const n of notes) {
    if (targets.has(n.commitment)) n.spent = true
  }
  await writeNotes(storeId, key, notes)
}

export async function shieldedBalance(poolId: string, account: string): Promise<bigint> {
  const notes = await loadShieldedNotes(poolId, account)
  return notes.filter((n) => !n.spent).reduce((sum, n) => sum + BigInt(n.amount), 0n)
}

// The circuit spends at most two input notes, so the cap is the two largest unspent notes combined.
export async function shieldedMaxSpendable(poolId: string, account: string): Promise<bigint> {
  const notes = await loadShieldedNotes(poolId, account)
  const amounts = notes
    .filter((n) => !n.spent)
    .map((n) => BigInt(n.amount))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  return amounts.slice(0, 2).reduce((sum, v) => sum + v, 0n)
}
