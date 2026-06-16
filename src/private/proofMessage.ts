import type { ProofInputs } from './proof.js'

// chrome.runtime.sendMessage serializes with JSON, which rejects BigInt. ProofInputs is full of
// field-element bigints, so it crosses the service-worker -> offscreen boundary as this string form.
export interface SerializableProofInputs {
  secret: string
  nullifier: string
  amountBlinding: string
  amount: string
  relayerFee: string
  recipient: string
  relayer: string
  assetContract: string
  pathElements: string[]
  pathIndices: number[]
  root: string
}

export function serializeProofInputs(i: ProofInputs): SerializableProofInputs {
  return {
    secret: i.secrets.secret.toString(),
    nullifier: i.secrets.nullifier.toString(),
    amountBlinding: i.secrets.amountBlinding.toString(),
    amount: i.amount.toString(),
    relayerFee: i.relayerFee.toString(),
    recipient: i.recipient,
    relayer: i.relayer,
    assetContract: i.assetContract,
    pathElements: i.merkle.pathElements.map((x) => x.toString()),
    pathIndices: i.merkle.pathIndices,
    root: i.merkle.root.toString(),
  }
}

export function deserializeProofInputs(s: SerializableProofInputs): ProofInputs {
  return {
    secrets: {
      secret: BigInt(s.secret),
      nullifier: BigInt(s.nullifier),
      amountBlinding: BigInt(s.amountBlinding),
    },
    amount: BigInt(s.amount),
    relayerFee: BigInt(s.relayerFee),
    recipient: s.recipient,
    relayer: s.relayer,
    assetContract: s.assetContract,
    merkle: {
      pathElements: s.pathElements.map((x) => BigInt(x)),
      pathIndices: s.pathIndices,
      root: BigInt(s.root),
    },
  }
}
