// Minimal ambient types for the untyped proving libraries; only the surface this module uses.

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicSignals: string[];
    }>;
    verify(vk: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
  export const wtns: {
    calculate(input: unknown, wasmPath: string, wtns: { type: string }): Promise<void>;
    exportJson(wtns: { type: string }): Promise<bigint[]>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<unknown>;
  export function buildBabyjub(): Promise<{
    F: { e(x: unknown): unknown; toObject(x: unknown): bigint };
    Base8: [unknown, unknown];
    mulPointEscalar(p: [unknown, unknown], s: bigint): [unknown, unknown];
    packPoint(p: [unknown, unknown]): Uint8Array;
    unpackPoint(buf: Uint8Array): [unknown, unknown] | null;
    inCurve(p: [unknown, unknown]): boolean;
  }>;
}
