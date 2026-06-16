import { poseidon } from './poseidon.js'

export const MERKLE_LEVELS = 20

export interface MerklePath {
  pathElements: bigint[]
  pathIndices: number[]
  root: bigint
}

// Empty-subtree hashes, matching the pool: zero leaf is 0, each level up is Poseidon(prev, prev).
function zeroHashes(): bigint[] {
  const zeros: bigint[] = [0n]
  for (let i = 0; i < MERKLE_LEVELS; i++) {
    zeros.push(poseidon([zeros[i], zeros[i]]))
  }
  return zeros
}

// Missing right siblings use the level's zero hash, like the pool, so the root matches the contract.
export function buildMerklePath(leaves: bigint[], leafIndex: number): MerklePath {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error(`leafIndex ${leafIndex} out of range for ${leaves.length} leaves`)
  }
  const zeros = zeroHashes()
  const pathElements: bigint[] = []
  const pathIndices: number[] = []
  let nodes = leaves.slice()
  let idx = leafIndex
  for (let level = 0; level < MERKLE_LEVELS; level++) {
    const siblingIndex = idx ^ 1
    pathElements.push(siblingIndex < nodes.length ? nodes[siblingIndex] : zeros[level])
    pathIndices.push(idx & 1)
    const next: bigint[] = []
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i]
      const right = i + 1 < nodes.length ? nodes[i + 1] : zeros[level]
      next.push(poseidon([left, right]))
    }
    nodes = next
    idx >>= 1
  }
  return { pathElements, pathIndices, root: nodes[0] }
}
