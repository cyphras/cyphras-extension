// A loss past the first share opens a warning before review; past the second,
// signing asks once more. Thin markets and small amounts are where these bite.
export const LOSS_WARN_PCT = 5
export const LOSS_CONFIRM_PCT = 15

/**
 * Change in USD value from what is paid to what arrives, in percent (negative
 * is a loss). Null when either side has no price, so nothing is claimed.
 */
export function valueChangePct(paidUsd: number | null, receivedUsd: number | null): number | null {
  if (paidUsd === null || receivedUsd === null || !(paidUsd > 0)) return null
  return ((receivedUsd - paidUsd) / paidUsd) * 100
}

export function formatPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}
