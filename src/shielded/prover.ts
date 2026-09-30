// Commitments and nullifiers are built off-circuit with Poseidon2 + Baby Jubjub,
// then a Groth16 proof binds them. The circuit recomputes pk_d/nk from ask/nsk/d,
// so the witness carries those keys, not a single spend key.
import * as snarkjs from "snarkjs";
import { type ExtData, hashExtData, calcPublicAmount } from "./extdata";
import { encodeProof } from "./encode";
import { type Point, SUBGROUP_ORDER, mulBase } from "./babyjub";
import { poseidon2, circuitBase } from "./poseidon2";

export interface InNote {
  amount: bigint;
  ask: bigint;
  nsk: bigint;
  d: Uint8Array;
  blinding: bigint;
  pathIndices: bigint;
  pathElements: bigint[];
}

export interface OutNote {
  amount: bigint;
  pkD: Point;
  blinding: bigint;
}

export interface TxProofHex {
  a: string;
  b: string;
  c: string;
  root: string;
  public_amount: string;
  ext_data_hash: string;
  nullifiers: string[];
  commitments: string[];
}

const dField = (d: Uint8Array): bigint =>
  BigInt("0x" + (Buffer.from(d).toString("hex") || "0"));

const foldPoint = (p: Point, dom: number): Promise<bigint> =>
  poseidon2([p[0], p[1]], dom);

/** Commitment of a note locked to pk_d. */
export async function noteCommitment(
  amount: bigint,
  pkD: Point,
  blinding: bigint,
): Promise<bigint> {
  return poseidon2([amount, await foldPoint(pkD, 0x05), blinding], 0x01);
}

/** Nullifier of a note we own; needs nsk (-> nk) and the leaf position. */
export async function noteNullifier(
  amount: bigint,
  pkD: Point,
  nsk: bigint,
  blinding: bigint,
  leafIndex: number,
): Promise<bigint> {
  const commitment = await noteCommitment(amount, pkD, blinding);
  const nk = await mulBase(nsk);
  return poseidon2([commitment, BigInt(leafIndex), await foldPoint(nk, 0x06)], 0x02);
}

// Recompute an input note's pk_d and nk-fold from its keys; off-chain uses the
// single-mult form for pk_d, which the circuit reproduces in-circuit.
async function inputKeys(
  ask: bigint,
  nsk: bigint,
  d: Uint8Array,
): Promise<{ pkD: Point; nkFold: bigint }> {
  const ak = await mulBase(ask);
  const nk = await mulBase(nsk);
  const akFold = await foldPoint(ak, 0x07);
  const nkFold = await foldPoint(nk, 0x06);
  const ivk = (await poseidon2([akFold, nkFold], 0x10)) % SUBGROUP_ORDER;
  const rd = (await poseidon2([dField(d)], 0x11)) % SUBGROUP_ORDER;
  const pkD = await mulBase((ivk * rd) % SUBGROUP_ORDER);
  return { pkD, nkFold };
}

/** Proves the assembled witness elsewhere so the large zkey never loads in this context. */
export type ProveFn = (
  txInput: Record<string, unknown>,
) => Promise<{ proof: unknown; publicSignals: string[] }>;

export interface BuildTxOpts {
  artifacts?: string;
  prove?: ProveFn;
}

/**
 * @param artifacts - base path holding transaction.wasm / transaction.zkey
 * @param opts - when opts.prove is set the witness is proven there instead of via snarkjs here
 */
export async function buildTransaction(
  root: bigint,
  inputs: [InNote, InNote],
  outputs: [OutNote, OutNote],
  ext: ExtData,
  domain: bigint,
  opts: BuildTxOpts = {},
): Promise<{ proof: TxProofHex; ext: ExtData; raw: { proof: unknown; publicSignals: string[] } }> {
  const artifacts = opts.artifacts ?? circuitBase();
  const inNull: bigint[] = [];
  for (const inp of inputs) {
    const { pkD, nkFold } = await inputKeys(inp.ask, inp.nsk, inp.d);
    const commitment = await noteCommitment(inp.amount, pkD, inp.blinding);
    inNull.push(await poseidon2([commitment, inp.pathIndices, nkFold], 0x02));
  }

  const outComm: bigint[] = [];
  for (const o of outputs) outComm.push(await noteCommitment(o.amount, o.pkD, o.blinding));

  const extDataHash = hashExtData(ext);
  const publicAmount = calcPublicAmount(ext);

  // Field order matches transaction.circom inputs.
  const txInput = {
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: extDataHash.toString(),
    domain: domain.toString(),
    inputNullifier: inNull.map(String),
    inAmount: inputs.map((i) => i.amount.toString()),
    inAsk: inputs.map((i) => i.ask.toString()),
    inNsk: inputs.map((i) => i.nsk.toString()),
    inD: inputs.map((i) => dField(i.d).toString()),
    inBlinding: inputs.map((i) => i.blinding.toString()),
    inPathIndices: inputs.map((i) => i.pathIndices.toString()),
    inPathElements: inputs.map((i) => i.pathElements.map(String)),
    outputCommitment: outComm.map(String),
    outAmount: outputs.map((o) => o.amount.toString()),
    outPubkeyAx: outputs.map((o) => o.pkD[0].toString()),
    outPubkeyAy: outputs.map((o) => o.pkD[1].toString()),
    outBlinding: outputs.map((o) => o.blinding.toString()),
  };

  const { proof, publicSignals } = opts.prove
    ? await opts.prove(txInput)
    : await snarkjs.groth16.fullProve(
        txInput,
        `${artifacts}/transaction.wasm`,
        `${artifacts}/transaction.zkey`,
      );

  const h32 = (x: bigint): string => x.toString(16).padStart(64, "0");
  return {
    proof: {
      ...encodeProof(proof as never),
      root: h32(root),
      public_amount: h32(publicAmount),
      ext_data_hash: h32(extDataHash),
      nullifiers: inNull.map(h32),
      commitments: outComm.map(h32),
    },
    ext,
    raw: { proof, publicSignals },
  };
}
