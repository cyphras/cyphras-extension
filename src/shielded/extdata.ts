// Mirrors the vault's hash_ext_data so a proof binds to the same ext data.
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface ExtData {
  extAmount: bigint;
  fee: bigint;
  recipient: string;
  relayer: string;
  encryptedOutput0: Uint8Array;
  encryptedOutput1: Uint8Array;
}

function entry(name: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val });
}

/** Build the ExtData ScVal exactly as the soroban contracttype serializes it. */
export function extDataScVal(e: ExtData): xdr.ScVal {
  // Keys sorted by symbol for canonical XDR.
  return xdr.ScVal.scvMap([
    entry("encrypted_output0", xdr.ScVal.scvBytes(Buffer.from(e.encryptedOutput0))),
    entry("encrypted_output1", xdr.ScVal.scvBytes(Buffer.from(e.encryptedOutput1))),
    entry("ext_amount", nativeToScVal(e.extAmount, { type: "i128" })),
    entry("fee", nativeToScVal(e.fee, { type: "i128" })),
    entry("recipient", new Address(e.recipient).toScVal()),
    entry("relayer", new Address(e.relayer).toScVal()),
  ]);
}

/** ext_data_hash = keccak256(XDR(ExtData)) mod FIELD, matching the vault. */
export function hashExtData(e: ExtData): bigint {
  const bytes = extDataScVal(e).toXDR();
  const digest = keccak_256(bytes);
  const n = BigInt("0x" + Buffer.from(digest).toString("hex"));
  return n % FIELD;
}

/** publicAmount = (extAmount - fee) as a field element (negatives wrap). */
export function calcPublicAmount(e: ExtData): bigint {
  const signed = e.extAmount - e.fee;
  return signed >= 0n ? signed : FIELD + signed;
}
