// Minimal ambient types for the untyped proving libraries. Only the surface this module uses.

declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<unknown>
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }
      publicSignals: string[]
    }>
    verify(vk: unknown, publicSignals: string[], proof: unknown): Promise<boolean>
  }
}
