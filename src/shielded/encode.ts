// Groth16 proof to host BN254 byte layout.
// G1 = x||y (64 bytes, big-endian); G2 = x_c1||x_c0||y_c1||y_c0 (128 bytes).

const be32 = (dec: string) => BigInt(dec).toString(16).padStart(64, "0");

export interface SnarkProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export function encodeG1(pt: string[]): string {
  return be32(pt[0]) + be32(pt[1]);
}

export function encodeG2(pt: string[][]): string {
  // c1 before c0: host expects the Fp2 high limb first.
  return be32(pt[0][1]) + be32(pt[0][0]) + be32(pt[1][1]) + be32(pt[1][0]);
}

/** {a,b,c} hex strings ready for the vault's TxProof. */
export function encodeProof(p: SnarkProof): { a: string; b: string; c: string } {
  return { a: encodeG1(p.pi_a), b: encodeG2(p.pi_b), c: encodeG1(p.pi_c) };
}
