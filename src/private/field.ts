// BN254 scalar field modulus r. Any value entering Poseidon or the circuit must be reduced mod r or
// the proof will not verify.
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

export function bytesToField(bytes: Uint8Array): bigint {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return BigInt('0x' + hex) % FIELD_MODULUS
}
