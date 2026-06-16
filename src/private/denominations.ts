export interface DenominationPiece {
  denomination: bigint
  count: number
}

export class NonRepresentableAmountError extends Error {}

// Pools exist only at fixed denominations, so an amount is sendable only as a sum of them; greedy
// largest-first yields the fewest notes, and a non-zero remainder is not sendable, so throw.
export function splitAmount(amount: bigint, denominations: bigint[]): DenominationPiece[] {
  if (amount <= 0n) {
    throw new NonRepresentableAmountError('amount must be positive')
  }
  const sorted = [...denominations].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  const pieces: DenominationPiece[] = []
  let remaining = amount
  for (const denom of sorted) {
    if (remaining <= 0n) {
      break
    }
    const count = remaining / denom
    if (count > 0n) {
      pieces.push({ denomination: denom, count: Number(count) })
      remaining -= denom * count
    }
  }
  if (remaining !== 0n) {
    throw new NonRepresentableAmountError(
      `amount not representable by available denominations; remainder ${remaining}`
    )
  }
  return pieces
}
