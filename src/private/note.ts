import { poseidon } from './poseidon.js'
import type { NoteSecrets } from './derive.js'

// Poseidon argument order is a hard contract with the circuit and the pool's hash_leaf; changing it
// breaks commitments and proofs.

export function nullifierHash(secrets: NoteSecrets): bigint {
  return poseidon([secrets.nullifier, secrets.secret])
}

export function amountHash(amount: bigint, amountBlinding: bigint): bigint {
  return poseidon([amount, amountBlinding])
}

// Binds owner secrets to amount and asset. The stored leaf also binds the relayer fee, so the
// escrowed fee cannot be changed after commit.
export function innerCommitment(secrets: NoteSecrets, amount: bigint, assetId: bigint): bigint {
  const ah = amountHash(amount, secrets.amountBlinding)
  return poseidon([secrets.nullifier, secrets.secret, ah, assetId])
}

export function leafHash(commitment: bigint, relayerFee: bigint): bigint {
  return poseidon([commitment, relayerFee])
}
