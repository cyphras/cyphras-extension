import './workerShim.js'
import { buildPoseidon } from 'circomlibjs'

// circomlibjs is untyped: a callable plus F.toObject to recover a bigint from a field element.
type PoseidonFn = ((inputs: bigint[]) => Uint8Array) & {
  F: { toObject: (value: Uint8Array) => bigint }
}

let instance: PoseidonFn | null = null

// Loads the Poseidon WASM before any poseidon() call; idempotent, only the first call does work.
export async function initPoseidon(): Promise<void> {
  if (!instance) {
    instance = (await buildPoseidon()) as PoseidonFn
  }
}

export function poseidon(inputs: bigint[]): bigint {
  if (!instance) {
    throw new Error('poseidon not initialized: call initPoseidon() first')
  }
  return instance.F.toObject(instance(inputs))
}
