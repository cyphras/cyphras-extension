import * as snarkjs from 'snarkjs'
import type { NoteSecrets } from './derive.js'
import { nullifierHash, amountHash } from './note.js'
import type { MerklePath } from './merkle.js'
import { addressToField } from './address.js'

export { addressToField }

export interface ProofInputs {
  secrets: NoteSecrets
  amount: bigint
  relayerFee: bigint
  recipient: string
  relayer: string
  assetContract: string
  merkle: MerklePath
}

// Reveal payload for the relayer. Addresses stay as G/C strkeys; the proof binds their field-mapped
// form, which the pool checks against these on-chain.
export interface ProvedReveal {
  proof: string
  root: string
  nullifierHash: string
  amountHash: string
  recipient: string
  relayer: string
  xlmFee: string
}

function be32(value: bigint): string {
  const hex = value.toString(16)
  if (hex.length > 64) {
    throw new Error('value exceeds 32 bytes')
  }
  return hex.padStart(64, '0')
}

function g1(point: string[]): string {
  return be32(BigInt(point[0])) + be32(BigInt(point[1]))
}

// G2 coordinates are emitted as (c1, c0) per the verifier's EIP-197 byte order.
function g2(point: string[][]): string {
  return (
    be32(BigInt(point[0][1])) +
    be32(BigInt(point[0][0])) +
    be32(BigInt(point[1][1])) +
    be32(BigInt(point[1][0]))
  )
}

export async function proveReveal(
  inputs: ProofInputs,
  wasm: Uint8Array | string,
  zkey: Uint8Array | string
): Promise<ProvedReveal> {
  const { secrets, amount, relayerFee, recipient, relayer, assetContract, merkle } = inputs
  const recipientField = addressToField(recipient)
  const relayerField = addressToField(relayer)
  const assetId = addressToField(assetContract)
  const nh = nullifierHash(secrets)
  const ah = amountHash(amount, secrets.amountBlinding)

  const circuitInput = {
    secret: secrets.secret.toString(),
    nullifier: secrets.nullifier.toString(),
    amount: amount.toString(),
    relayerFee: relayerFee.toString(),
    amountBlinding: secrets.amountBlinding.toString(),
    pathElements: merkle.pathElements.map((x) => x.toString()),
    pathIndices: merkle.pathIndices.map((x) => x.toString()),
    root: merkle.root.toString(),
    nullifierHash: nh.toString(),
    recipient: recipientField.toString(),
    relayer: relayerField.toString(),
    amountHash: ah.toString(),
    assetId: assetId.toString(),
  }

  const { proof } = await snarkjs.groth16.fullProve(circuitInput, wasm, zkey)

  return {
    proof: g1(proof.pi_a) + g2(proof.pi_b) + g1(proof.pi_c),
    root: be32(merkle.root),
    nullifierHash: be32(nh),
    amountHash: be32(ah),
    recipient,
    relayer,
    xlmFee: relayerFee.toString(),
  }
}
