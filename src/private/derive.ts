import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToField } from './field.js'

export interface NoteSecrets {
  secret: bigint
  nullifier: bigint
  amountBlinding: bigint
}

// Seed-derived so a wallet restore reproduces the same note from the same counter. Counter
// namespaces notes; label namespaces the three components.
function deriveComponent(seed: Uint8Array, label: string, counter: number): bigint {
  const info = new TextEncoder().encode(`cyphras/v1/${label}/${counter}`)
  return bytesToField(hkdf(sha256, seed, new Uint8Array(0), info, 32))
}

// Keyed on the account's own secret seed, not a shared mnemonic, so notes stay recoverable across
// all account types: HD indexes, extra seed phrases, imported keys.
export function deriveAccountSeed(accountSecretSeed: Uint8Array, account: string): Uint8Array {
  const info = new TextEncoder().encode(`cyphras/v1/account/${account}`)
  return hkdf(sha256, accountSecretSeed, new Uint8Array(0), info, 32)
}

export function deriveNoteSecrets(seed: Uint8Array, counter: number): NoteSecrets {
  return {
    secret: deriveComponent(seed, 'secret', counter),
    nullifier: deriveComponent(seed, 'nullifier', counter),
    amountBlinding: deriveComponent(seed, 'blinding', counter),
  }
}
