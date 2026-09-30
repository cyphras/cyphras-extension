// Amount math in base units so every page rounds the same way: down, never
// up, and never past the asset's (or the protocol's) decimal limit.

export function parseUnits(amount: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null
  const [whole, frac = ''] = amount.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole + frac.padEnd(decimals, '0'))
}

export function formatUnits(units: bigint | string, decimals: number): string {
  const u = typeof units === 'bigint' ? units : BigInt(units)
  const base = 10n ** BigInt(decimals)
  const whole = u / base
  const frac = (u % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

// Floors a decimal string to at most `decimals` places without touching the
// integer part, e.g. a 7-decimal Stellar USDC balance to CCTP's 6.
export function truncateDecimals(value: string, decimals: number): string {
  const [whole, frac = ''] = value.split('.')
  const cut = frac.slice(0, decimals).replace(/0+$/, '')
  return cut ? `${whole}.${cut}` : whole
}

// What an amount field accepts while typing: digits and one dot, with a
// locale comma read as the dot. Returns null for a keystroke to reject.
export function sanitizeAmountInput(raw: string): string | null {
  const v = raw.replace(/,/g, '.').replace(/\s/g, '')
  return /^\d*\.?\d*$/.test(v) ? v : null
}

export function fractionUnits(units: bigint, fraction: number): bigint {
  return (units * BigInt(Math.round(fraction * 100))) / 100n
}

/**
 * The most that can leave in one transaction without failing: the balance
 * minus what the network keeps locked (Stellar reserve, open-offer
 * liabilities) and, when this asset pays the fee, the fee headroom.
 */
export function spendableUnits(
  balance: string,
  decimals: number,
  locked: string | undefined,
  feeUnits: bigint = 0n
): bigint {
  const total = parseUnits(truncateDecimals(balance, decimals), decimals) ?? 0n
  const held = locked ? (parseUnits(truncateDecimals(locked, decimals), decimals) ?? 0n) : 0n
  const free = total - held - feeUnits
  return free > 0n ? free : 0n
}

/**
 * Upper bound an EVM account must hold for gas before a node accepts the
 * transaction: every send here signs gasLimit = estimate x 1.2 and
 * maxFeePerGas = 2 x gasPrice + tip, and the node checks the balance against
 * that ceiling, not the fee actually charged. The extra 10% covers the gas
 * price moving between this quote and the signature.
 */
export function evmGasCeilingWei(gasUnits: bigint, gasPriceWei: bigint, tipWei: bigint): bigint {
  const limit = (gasUnits * 12n) / 10n
  return (limit * (gasPriceWei * 2n + tipWei) * 11n) / 10n
}

// Fee-sized amounts: a gas figure like 0.00041484019798 ETH is noise past a
// few significant digits, while anything above 1 reads best as plain money.
export function formatSignificant(value: string, digits = 3): string {
  const n = parseFloat(value)
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: digits })
}

export function formatBalanceText(balance: string, code: string, decimals: number): string {
  const n = parseFloat(balance)
  if (!Number.isFinite(n)) return `Balance: ${balance} ${code}`
  return `Balance: ${n.toLocaleString('en-US', { maximumFractionDigits: Math.min(decimals, 7) })} ${code}`
}
