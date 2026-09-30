// Sole owner of the Baby Jubjub curve constants for the wallet.
// Wraps circomlibjs so it stays in lockstep with circomlib's BabyPbk / EscalarMul*.
import { buildBabyjub } from "circomlibjs";

// Prime-order subgroup order L; every scalar is reduced mod this, not the field.
export const SUBGROUP_ORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

export type Point = [bigint, bigint];

type Baby = Awaited<ReturnType<typeof buildBabyjub>>;

let cached: Promise<Baby> | null = null;

function baby(): Promise<Baby> {
  if (!cached) cached = buildBabyjub();
  return cached!;
}

// circomlibjs speaks Montgomery field elements; convert only at this boundary.
const toF = (b: Baby, p: Point) => [b.F.e(p[0]), b.F.e(p[1])] as [unknown, unknown];
const fromF = (b: Baby, p: [unknown, unknown]): Point => [b.F.toObject(p[0]), b.F.toObject(p[1])];

/** s . Base8 (fixed-base). */
export async function mulBase(s: bigint): Promise<Point> {
  const b = await baby();
  return fromF(b, b.mulPointEscalar(b.Base8, s));
}

/** s . P (variable-base). */
export async function mulPoint(p: Point, s: bigint): Promise<Point> {
  const b = await baby();
  return fromF(b, b.mulPointEscalar(toF(b, p), s));
}

/** Pack a point to 32 bytes: y little-endian, sign of x in the top bit. */
export async function packPoint(p: Point): Promise<Uint8Array> {
  const b = await baby();
  // Copy out: circomlibjs returns a view into a reused scratch buffer a later packPoint would overwrite.
  return Uint8Array.from(b.packPoint(toF(b, p)));
}

/** Unpack 32 bytes to a point, or null on an invalid encoding. */
export async function unpackPoint(buf: Uint8Array): Promise<Point | null> {
  const b = await baby();
  // Copy: circomlibjs unpackPoint clears the x-sign bit in the input buffer in place, corrupting callers that reuse it.
  const P = b.unpackPoint(Uint8Array.from(buf));
  return P ? fromF(b, P) : null;
}

export async function onCurve(p: Point): Promise<boolean> {
  const b = await baby();
  return b.inCurve(toF(b, p));
}

/** True iff p is in the prime-order subgroup (L . p == identity). */
export async function inSubgroup(p: Point): Promise<boolean> {
  const b = await baby();
  if (!b.inCurve(toF(b, p))) return false;
  if (p[0] === 0n && p[1] === 1n) return false; // reject identity / low-order points
  const Q = fromF(b, b.mulPointEscalar(toF(b, p), SUBGROUP_ORDER));
  return Q[0] === 0n && Q[1] === 1n;
}

/** Cofactor-clear a received point (8 . p) before ECDH. */
export async function clearCofactor(p: Point): Promise<Point> {
  return mulPoint(p, 8n);
}

/** Scalar in [0, L) from the CSPRNG; 512 bits reduced keeps bias negligible. */
export function randScalar(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(64));
  return BigInt("0x" + Buffer.from(b).toString("hex")) % SUBGROUP_ORDER;
}
