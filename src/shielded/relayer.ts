// Submits a shielded spend to the relayer HTTP service instead of the user's own
// Stellar account. The relayer becomes the tx source, breaking the metadata link
// between the spend and the user's public account.
import { type Pool, FEE } from "./config";
import type { TxProofHex } from "./prover";
import type { ExtData } from "./extdata";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** POST {proof, ext} to the pool's relayer; returns the submitted tx hash. */
export async function relayerSubmit(pool: Pool, proof: TxProofHex, ext: ExtData): Promise<string> {
  const res = await fetch(`${pool.relayerUrl}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proof,
      ext: {
        ext_amount: ext.extAmount.toString(),
        fee: ext.fee.toString(),
        recipient: ext.recipient,
        relayer: ext.relayer,
        encrypted_output0: hex(ext.encryptedOutput0),
        encrypted_output1: hex(ext.encryptedOutput1),
      },
    }),
  });
  if (!res.ok) {
    let msg = `relayer returned ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON body; keep status message
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { hash: string };
  return body.hash;
}

/** Relayer fee quote, itemized so the wallet can show where the fee goes.
 * `fee` is deducted from the spent note; `netCost` is the live gas estimate;
 * `margin` is the relayer profit (`fee - netCost`). */
export interface Quote {
  fee: bigint;
  netCost: bigint;
  margin: bigint;
  marginBps: bigint;
  calibrated: boolean;
}

/** Fee breakdown from the relayer, baked into the proof before submitting.
 * Falls back to config FEE if the relayer is unreachable. */
export async function getQuoteDetail(pool: Pool): Promise<Quote> {
  try {
    const res = await fetch(`${pool.relayerUrl}/quote`);
    if (res.ok) {
      const q = await res.json();
      return {
        fee: BigInt(q.fee),
        netCost: BigInt(q.netCost),
        margin: BigInt(q.margin),
        marginBps: BigInt(q.marginBps),
        calibrated: q.calibrated === "true",
      };
    }
  } catch {
    // unreachable; fall through to offline fee
  }
  return { fee: FEE, netCost: FEE, margin: 0n, marginBps: 0n, calibrated: false };
}

/** Total fee only, baked into the proof. */
export async function getQuote(pool: Pool): Promise<bigint> {
  return (await getQuoteDetail(pool)).fee;
}
