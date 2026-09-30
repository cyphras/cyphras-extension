// Mnemonic-backed wallet. One account index yields a Stellar keypair (public side)
// and a Baby Jubjub key hierarchy (ask/nsk -> ak/nk -> ivk -> pk_d) for the shielded pool.
import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from "bip39";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32m } from "@scure/base";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@stellar/stellar-sdk";
import { SUBGROUP_ORDER, type Point, mulBase, packPoint, unpackPoint, inSubgroup } from "./babyjub";
import { poseidon2 } from "./poseidon2";

export interface Wallet {
  mnemonic: string;
  account: number;
  stellar: Keypair;
  address: string; // Stellar G... public address
  ask: bigint; // spend authorizing scalar
  nsk: bigint; // nullifier scalar
  ovk: Uint8Array; // outgoing viewing key
  ak: Point;
  nk: Point;
  nkFold: bigint; // cached for nullifiers and commitments
  ivk: bigint; // incoming viewing key scalar
  d: Uint8Array; // diversifier; all-zero means default address
  pkD: Point; // diversified transmission key
}

const HRP = "cy";
const BECH32_LIMIT = 256;
// default drops the all-zero diversifier so pk_d leads and addresses diverge early
const VERSION_DEFAULT = 0x00;
const VERSION_DIVERSIFIED = 0x01;
const enc = new TextEncoder();

function derive(seed: Uint8Array, tag: string): Uint8Array {
  return sha256(new Uint8Array([...seed, ...enc.encode(tag)]));
}

// wide-reduce 512 bits mod L; headroom over ~2^251 keeps the reduction unbiased
function wideToScalar(seed: Uint8Array, tag: string): bigint {
  const t = enc.encode(tag);
  const be = (b: Uint8Array) => BigInt("0x" + Buffer.from(b).toString("hex"));
  const h0 = sha256(new Uint8Array([...seed, ...t, 0]));
  const h1 = sha256(new Uint8Array([...seed, ...t, 1]));
  return ((be(h0) << 256n) | be(h1)) % SUBGROUP_ORDER;
}

const dField = (d: Uint8Array) => BigInt("0x" + Buffer.from(d).toString("hex"));

/**
 * pk_d for a diversifier. Single-mult form matches the circuit's ivk . (r_d . Base8).
 */
export async function diversifiedKey(ivk: bigint, d: Uint8Array): Promise<Point> {
  const rd = (await poseidon2([dField(d)], 0x11)) % SUBGROUP_ORDER;
  return mulBase((ivk * rd) % SUBGROUP_ORDER);
}

export function newMnemonic(): string {
  return generateMnemonic(128);
}

/**
 * Loads one account from the mnemonic. Account 0 uses the base tags; higher accounts
 * append the index for an independent paired identity.
 */
export async function loadWallet(mnemonic: string, account = 0): Promise<Wallet> {
  if (!validateMnemonic(mnemonic)) throw new Error("invalid seed phrase");
  if (!Number.isInteger(account) || account < 0) throw new Error("invalid account index");
  const seed = mnemonicToSeedSync(mnemonic);
  const tag = (base: string) => (account === 0 ? base : `${base}/${account}`);
  // SEP-0005 path so the public address matches Freighter/Lobstr for this mnemonic
  const { key } = derivePath(`m/44'/148'/${account}'`, Buffer.from(seed).toString("hex"));
  const stellar = Keypair.fromRawEd25519Seed(Buffer.from(key));
  const ask = wideToScalar(seed, tag("cy:ask"));
  const nsk = wideToScalar(seed, tag("cy:nsk"));
  const ovk = derive(seed, tag("cy:ovk"));
  const ak = await mulBase(ask);
  const nk = await mulBase(nsk);
  const akFold = await poseidon2([ak[0], ak[1]], 0x07);
  const nkFold = await poseidon2([nk[0], nk[1]], 0x06);
  const ivk = (await poseidon2([akFold, nkFold], 0x10)) % SUBGROUP_ORDER;
  const d = new Uint8Array(11); // default diversifier
  const pkD = await diversifiedKey(ivk, d);
  return { mnemonic, account, stellar, address: stellar.publicKey(), ask, nsk, ovk, ak, nk, nkFold, ivk, d, pkD };
}

/**
 * Shareable address as bech32m. Default form encodes 0x00 || packPoint(pk_d);
 * diversified form encodes 0x01 || d(11) || packPoint(pk_d).
 */
export async function receiveAddress(wallet: Wallet): Promise<string> {
  const packed = await packPoint(wallet.pkD);
  const isDefault = wallet.d.every((b) => b === 0);
  const payload = isDefault
    ? new Uint8Array([VERSION_DEFAULT, ...packed])
    : new Uint8Array([VERSION_DIVERSIFIED, ...wallet.d, ...packed]);
  return bech32m.encode(HRP, bech32m.toWords(payload), BECH32_LIMIT);
}

/**
 * Decodes and validates a receiving address. Rejects off-curve or non-prime-order
 * points so a malformed address cannot be paid.
 */
export async function parseAddress(addr: string): Promise<{ d: Uint8Array; pkD: Point }> {
  let payload: Uint8Array;
  try {
    const dec = bech32m.decode(addr.trim().toLowerCase() as `${string}1${string}`, BECH32_LIMIT);
    if (dec.prefix !== HRP) throw new Error(`wrong prefix "${dec.prefix}"`);
    payload = bech32m.fromWords(dec.words);
  } catch (e) {
    throw new Error("invalid receiving address (" + (e as Error).message + ")");
  }
  let d: Uint8Array;
  let packed: Uint8Array;
  if (payload[0] === VERSION_DEFAULT && payload.length === 33) {
    d = new Uint8Array(11);
    packed = Uint8Array.from(payload.slice(1, 33));
  } else if (payload[0] === VERSION_DIVERSIFIED && payload.length === 44) {
    d = Uint8Array.from(payload.slice(1, 12));
    packed = Uint8Array.from(payload.slice(12, 44));
  } else {
    throw new Error("unsupported address version/length");
  }
  const pkD = await unpackPoint(packed);
  if (!pkD) throw new Error("invalid point in address");
  if (!(await inSubgroup(pkD))) throw new Error("address point not in the prime-order subgroup");
  return { d, pkD };
}
