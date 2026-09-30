// ScVal args for vault.transact: TxProof + ExtData from the prover's hex output.
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const bytesN = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
const u256 = (hex: string) =>
  nativeToScVal(BigInt("0x" + hex), { type: "u256" });
const sym = (s: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(s), val: v });

export interface ProofHex {
  a: string; b: string; c: string;
  root: string; public_amount: string; ext_data_hash: string;
  nullifiers: string[]; commitments: string[];
}
export interface ExtHex {
  ext_amount: bigint; fee: bigint; recipient: string; relayer: string;
  encrypted_output0: Uint8Array; encrypted_output1: Uint8Array;
}

export function proofScVal(p: ProofHex): xdr.ScVal {
  // Keys sorted by symbol for canonical XDR.
  return xdr.ScVal.scvMap([
    sym("a", bytesN(p.a)),
    sym("b", bytesN(p.b)),
    sym("c", bytesN(p.c)),
    sym("ext_data_hash", u256(p.ext_data_hash)),
    sym("input_nullifiers", xdr.ScVal.scvVec(p.nullifiers.map(u256))),
    sym("output_commitments", xdr.ScVal.scvVec(p.commitments.map(u256))),
    sym("public_amount", u256(p.public_amount)),
    sym("root", u256(p.root)),
  ]);
}

export function extScVal(e: ExtHex): xdr.ScVal {
  return xdr.ScVal.scvMap([
    sym("encrypted_output0", xdr.ScVal.scvBytes(Buffer.from(e.encrypted_output0))),
    sym("encrypted_output1", xdr.ScVal.scvBytes(Buffer.from(e.encrypted_output1))),
    sym("ext_amount", nativeToScVal(e.ext_amount, { type: "i128" })),
    sym("fee", nativeToScVal(e.fee, { type: "i128" })),
    sym("recipient", new Address(e.recipient).toScVal()),
    sym("relayer", new Address(e.relayer).toScVal()),
  ]);
}
