// Fee math + display helpers for the wallet UI. Stroops are the on-chain unit
// (1 XLM = 10^7 stroops); both are shown so the user can reconcile the breakdown
// against their public balance.
import type { Quote } from "./relayer";

export const STROOPS_PER_XLM = 10_000_000n;

/** Format stroops as a fixed 7-decimal XLM string (1000000000 -> "100.0000000"). */
export function xlm(stroops: bigint): string {
  const neg = stroops < 0n;
  const s = neg ? -stroops : stroops;
  const whole = s / STROOPS_PER_XLM;
  const frac = (s % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export type Action = "shield" | "send" | "withdraw" | "transfer";

export interface FeeLine {
  label: string;
  stroops: bigint;
  hint?: string;
}

/** Itemized breakdown for an action: what is spent, the relayer fee split into
 * network cost + margin, what the counterparty receives, and the change.
 * `note` is the spent note value; `amount` is the entered send/withdraw amount
 * (ignored for shield). */
export function breakdown(action: Action, amount: bigint, note: bigint, q: Quote, maxDeposit: bigint): { lines: FeeLine[]; valid: boolean; error?: string } {
  if (action === "shield") {
    // Shield gas is paid from public XLM on top of the deposit, not deducted, so
    // the full deposit enters the private balance. Exact gas set at submit.
    const overCap = amount > maxDeposit;
    return {
      valid: amount > 0n && !overCap,
      error: overCap ? `Exceeds the ${xlm(maxDeposit)} per-deposit cap; the vault would reject it (DepositTooLarge). Split into smaller shields.` : undefined,
      lines: [
        { label: "Deposit amount", stroops: amount, hint: "enters your private balance in full" },
        { label: "Relayer fee", stroops: 0n, hint: "none - you sign and submit a shield yourself" },
        { label: "Stellar network gas (est.)", stroops: q.netCost, hint: "paid by you from public XLM, on top of the deposit (not deducted from it); exact amount set at submit" },
        { label: "Added to private balance", stroops: amount },
      ],
    };
  }

  const relayerFee: FeeLine[] = [
    { label: "Relayer fee (total)", stroops: q.fee, hint: "deducted from the spent note" },
    { label: "  - network gas (relayer pays Stellar)", stroops: q.netCost, hint: "live estimate, recalibrated each tx" },
    { label: `  - relayer margin (${Number(q.marginBps) / 100}%)`, stroops: q.margin, hint: "the relayer's profit on this tx" },
  ];

  if (action === "withdraw") {
    // amount == 0 means withdraw the whole note minus fee; positive withdraws
    // exactly that and keeps the remainder as a private change note.
    const out = amount > 0n ? amount : note - q.fee;
    const change = note - out - q.fee;
    return {
      valid: out > 0n && change >= 0n,
      error: out <= 0n || change < 0n ? `Note ${xlm(note)} cannot cover ${xlm(out)} + ${xlm(q.fee)} fee.` : undefined,
      lines: [
        { label: "Note spent", stroops: note },
        ...relayerFee,
        { label: "You receive (public XLM)", stroops: out, hint: "lands in your own account" },
        { label: "Change back to you (private)", stroops: change < 0n ? 0n : change },
        { label: "Stellar gas to you", stroops: 0n, hint: "relayer is the tx source, not you" },
      ],
    };
  }

  // send / transfer: amount stays in-pool; fee + change come out of the note.
  const change = note - amount - q.fee;
  return {
    valid: change >= 0n,
    error: change >= 0n ? undefined : `Note ${xlm(note)} cannot cover ${xlm(amount)} + ${xlm(q.fee)} fee.`,
    lines: [
      { label: "Note spent", stroops: note },
      { label: action === "send" ? "Recipient receives (private)" : "Split to new note (private)", stroops: amount },
      ...relayerFee,
      { label: "Change back to you (private)", stroops: change < 0n ? 0n : change },
      { label: "Stellar gas to you", stroops: 0n, hint: "relayer is the tx source, not you" },
    ],
  };
}
