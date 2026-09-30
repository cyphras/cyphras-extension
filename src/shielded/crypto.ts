// Note encryption over Baby Jubjub ECDH. Sender derives g_d from the recipient
// diversifier d, picks ephemeral esk, shares S = esk . pk_d; recipient recovers
// S = ivk . epk. Plaintext carries (amount, d, blinding) so a diversified note
// stays spendable after discovery.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Point, SUBGROUP_ORDER, mulBase, mulPoint, packPoint, unpackPoint, inSubgroup, randScalar } from "./babyjub";
import { poseidon2 } from "./poseidon2";

const u256be = (x: bigint) => {
  const h = x.toString(16).padStart(64, "0");
  return Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
};
const beToU256 = (b: Uint8Array) => BigInt("0x" + Buffer.from(b).toString("hex"));
const dField = (d: Uint8Array) => BigInt("0x" + Buffer.from(d).toString("hex"));

const DOMAIN = new TextEncoder().encode("shielded-note-v2-bjj");
const kdf = (sharedPacked: Uint8Array, epkPacked: Uint8Array) =>
  sha256(new Uint8Array([...sharedPacked, ...epkPacked, ...DOMAIN]));

/** Encrypt (amount, d, blinding) to a recipient pk_d with diversifier d.
 * Layout: packPoint(epk)(32) || nonce(24) || ciphertext. */
export async function encryptNote(pkD: Point, d: Uint8Array, amount: bigint, blinding: bigint): Promise<Uint8Array> {
  const rd = (await poseidon2([dField(d)], 0x11)) % SUBGROUP_ORDER;
  const gd = await mulBase(rd);
  const esk = randScalar();
  const epk = await mulPoint(gd, esk);
  const shared = await mulPoint(pkD, esk);
  const epkPacked = await packPoint(epk);
  const key = kdf(await packPoint(shared), epkPacked);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  // fixed 75 bytes (32 + 11 + 32) so every encrypted_output is equal-size
  const pt = new Uint8Array([...u256be(amount), ...d, ...u256be(blinding)]);
  const ct = xchacha20poly1305(key, nonce).encrypt(pt);
  return new Uint8Array([...epkPacked, ...nonce, ...ct]);
}

/** Try to decrypt an encrypted_output with the wallet ivk. Returns null if it is
 * not ours or was tampered with. */
export async function decryptNote(ivk: bigint, blob: Uint8Array): Promise<{ amount: bigint; d: Uint8Array; blinding: bigint } | null> {
  if (blob.length < 32 + 24 + 16) return null;
  try {
    const epkPacked = Uint8Array.from(blob.slice(0, 32));
    const nonce = blob.slice(32, 56);
    const ct = blob.slice(56);
    const epk = await unpackPoint(epkPacked);
    // reject off-subgroup epk before the ECDH
    if (!epk || !(await inSubgroup(epk))) return null;
    const shared = await mulPoint(epk, ivk);
    const key = kdf(await packPoint(shared), epkPacked);
    const pt = xchacha20poly1305(key, nonce).decrypt(ct);
    if (pt.length !== 75) return null;
    return { amount: beToU256(pt.slice(0, 32)), d: Uint8Array.from(pt.slice(32, 43)), blinding: beToU256(pt.slice(43, 75)) };
  } catch {
    return null;
  }
}
