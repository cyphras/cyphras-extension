// crypto-free submit path so the background service worker can import it without pulling in snarkjs
import {
  Contract, TransactionBuilder, BASE_FEE, nativeToScVal, rpc, Keypair,
} from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, type Pool } from "./config";
import type { TxProofHex } from "./prover";
import type { ExtData } from "./extdata";
import { proofScVal, extScVal } from "./scval";
import { relayerSubmit } from "./relayer";
import type { Note } from "./notes";
import type { SpendPlan } from "./vault";

const server = new rpc.Server(RPC_URL);

const fromHex = (s: string): Uint8Array => Uint8Array.from((s.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array): string => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

/** A SpendPlan flattened to JSON-safe values so it survives chrome.runtime messaging. */
export interface SerializedSpendPlan {
  proof: TxProofHex;
  ext: {
    extAmount: string;
    fee: string;
    recipient: string;
    relayer: string;
    encryptedOutput0: string;
    encryptedOutput1: string;
  };
  selfSign: boolean;
  spent: string[];
  added: Note[];
}

export function serializeSpendPlan(plan: SpendPlan): SerializedSpendPlan {
  return {
    proof: plan.proof,
    ext: {
      extAmount: plan.ext.extAmount.toString(),
      fee: plan.ext.fee.toString(),
      recipient: plan.ext.recipient,
      relayer: plan.ext.relayer,
      encryptedOutput0: toHex(plan.ext.encryptedOutput0),
      encryptedOutput1: toHex(plan.ext.encryptedOutput1),
    },
    selfSign: plan.selfSign,
    spent: plan.spent,
    added: plan.added,
  };
}

export function deserializeSpendPlan(s: SerializedSpendPlan): SpendPlan {
  return {
    proof: s.proof,
    ext: {
      extAmount: BigInt(s.ext.extAmount),
      fee: BigInt(s.ext.fee),
      recipient: s.ext.recipient,
      relayer: s.ext.relayer,
      encryptedOutput0: fromHex(s.ext.encryptedOutput0),
      encryptedOutput1: fromHex(s.ext.encryptedOutput1),
    },
    selfSign: s.selfSign,
    spent: s.spent,
    added: s.added,
  };
}

/** Wait for final on-chain status before mutating local note state. */
export async function awaitTx(hash: string): Promise<void> {
  // raw RPC JSON avoids server.getTransaction throwing on TransactionMetaV4 in older SDK builds
  for (let i = 0; i < 40; i++) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }),
    });
    const status = (await res.json())?.result?.status as string | undefined;
    if (status === "SUCCESS") return;
    if (status === "FAILED") throw new Error("transaction failed on-chain");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("confirmation timeout - note state left unchanged");
}

/** Submit a self-signed spend through the signer's own Stellar account; returns the tx hash. */
export async function submit(pool: Pool, signer: Keypair, proof: TxProofHex, e: ExtData): Promise<string> {
  const contract = new Contract(pool.vaultId);
  const acct = await server.getAccount(signer.publicKey());
  let tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(
      "transact", proofScVal(proof),
      extScVal({ ext_amount: e.extAmount, fee: 0n, recipient: e.recipient, relayer: e.relayer, encrypted_output0: e.encryptedOutput0, encrypted_output1: e.encryptedOutput1 }),
      nativeToScVal(signer.publicKey(), { type: "address" }),
    ))
    .setTimeout(60).build();
  tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  return (await server.sendTransaction(tx)).hash;
}

/** Submit a built plan via the signer's own account when selfSign, else the relayer; returns the tx hash. */
export async function submitPlan(pool: Pool, signer: Keypair, plan: SpendPlan): Promise<string> {
  return plan.selfSign ? submit(pool, signer, plan.proof, plan.ext) : relayerSubmit(pool, plan.proof, plan.ext);
}

/** True if any nullifier is already spent on-chain, per the indexer; used for retry idempotency. */
export async function notesSpentByNullifiers(pool: Pool, nullifiersHex: string[]): Promise<boolean> {
  for (const nf of nullifiersHex) {
    const res = await fetch(`${pool.indexerUrl}/nullifier/${nf.padStart(64, "0")}`);
    if (!res.ok) throw new Error(`indexer /nullifier returned ${res.status}`);
    if ((await res.json()).spent === true) return true;
  }
  return false;
}
