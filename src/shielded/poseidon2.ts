// Poseidon2 over BN254, run through the same circom wit-helpers as the circuit
// so the TS hash is bit-identical to the in-circuit hash.
// Arities 1/2/3 only; the circuit's round constants cover t in {2,3,4}.
import * as snarkjs from "snarkjs";

// Base path holding poseidon2_{1,2,3}_main.wasm; a Node harness can override it.
let base = "/circuits";
export function setCircuitBase(path: string): void {
  base = path;
}
export function circuitBase(): string {
  return base;
}

export async function poseidon2(inputs: bigint[], dom: number): Promise<bigint> {
  if (inputs.length < 1 || inputs.length > 3) {
    throw new Error(`no Poseidon2 helper for ${inputs.length} inputs`);
  }
  const wasm = `${base}/poseidon2_${inputs.length}_main.wasm`;
  const wtns: { type: string } = { type: "mem" };
  await snarkjs.wtns.calculate({ inputs: inputs.map(String), dom: String(dom) }, wasm, wtns);
  return ((await snarkjs.wtns.exportJson(wtns)) as bigint[])[1];
}
