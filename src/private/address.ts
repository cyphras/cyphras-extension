import { StrKey } from '@stellar/stellar-sdk'
import { bytesToField } from './field.js'

// Mirrors the pool's address_to_field; a mismatch makes the reveal fail to verify, never misdirect
// funds. Separate from proof.ts so the service worker can map addresses without pulling in snarkjs.
export function addressToField(address: string): bigint {
  const raw = address.startsWith('C')
    ? StrKey.decodeContract(address)
    : StrKey.decodeEd25519PublicKey(address)
  return bytesToField(new Uint8Array(raw))
}
