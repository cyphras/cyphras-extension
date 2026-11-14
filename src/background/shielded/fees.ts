import type { NetworkFeeCaps } from '@cyphras/private'

// The most one transaction envelope's fee field holds; this wallet's signer takes no fee bumps, so
// it is the most any approval can lift a fee to.
export const MAX_ENVELOPE_FEE = 4_294_967_295n

// The SDK's default inclusion cap, which an approval never lowers.
const MIN_INCLUSION_CAP = 100_000n
// 0.01 XLM, the step the resource part of an approval rounds up to.
const RESOURCE_STEP = 100_000n

const stroops = (value: unknown): bigint | null =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null

const tenPercentOver = (value: bigint): bigint => (value * 11n + 9n) / 10n

export interface FeeCeiling {
  readonly inclusionCap: bigint
  readonly resourceCap: bigint
  readonly ceiling: bigint
}

// The caps one approval of a fee gives its one transaction, from the inclusion and resource fees the
// wallet's own simulation reported: 10% above each, never below the default inclusion cap, the
// resource part rounded up to 0.01 XLM. The 10% leaves room for the next simulation and nothing more.
// Null for a fee that is not two whole stroop amounts, or whose ceiling no envelope carries.
export function feeCeiling(inclusion: unknown, resource: unknown): FeeCeiling | null {
  const i = stroops(inclusion)
  const r = stroops(resource)
  if (i === null || r === null) return null
  const over = tenPercentOver(i)
  const inclusionCap = over > MIN_INCLUSION_CAP ? over : MIN_INCLUSION_CAP
  const resourceCap = ((tenPercentOver(r) + RESOURCE_STEP - 1n) / RESOURCE_STEP) * RESOURCE_STEP
  const ceiling = inclusionCap + resourceCap
  return ceiling > MAX_ENVELOPE_FEE ? null : { inclusionCap, resourceCap, ceiling }
}

// The SDK's default resource cap, what the wallet pays without asking beside the inclusion fee.
const DEFAULT_RESOURCE_CAP = 10_000_000n

// The network fee caps of one call from an approval the popup sends, or null when it is not one:
// a known reason, whole stroop amounts, the ceiling at least the inclusion cap and within what an
// envelope carries. Rent and a high network fee take the approved room as the resource cap. A
// restore takes it as resource plus restore room, the part above the default resource cap as the
// restore room: the SDK sends a restore a call needs as a transaction of its own before the call
// and takes what it paid from that room alone, so the call after it pays no more than the wallet
// pays without asking, and asks again above that.
export function feeApprovalCaps(approval: unknown): NetworkFeeCaps | null {
  if (typeof approval !== 'object' || approval === null) return null
  const { reason, inclusionCap, ceiling } = approval as Record<string, unknown>
  const inclusion = stroops(inclusionCap)
  const total = stroops(ceiling)
  if (reason !== 'network' && reason !== 'rent' && reason !== 'restore') return null
  if (inclusion === null || total === null || total < inclusion || total > MAX_ENVELOPE_FEE) {
    return null
  }
  const room = total - inclusion
  if (reason !== 'restore' || room <= DEFAULT_RESOURCE_CAP) {
    return { inclusion, resource: room, restore: 0n }
  }
  return { inclusion, resource: DEFAULT_RESOURCE_CAP, restore: room - DEFAULT_RESOURCE_CAP }
}
