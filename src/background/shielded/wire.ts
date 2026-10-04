import type { ArtifactName, CircuitPins } from '@cyphras/private'

// Extension messaging carries JSON only, so the bigints of a witness or a proof travel as decimal
// strings; neither holds anything else at its leaves.
export type Wire = string | Wire[] | { [key: string]: Wire }

export function toWire(value: unknown): Wire {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(toWire)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toWire(v)]))
  }
  throw new TypeError('only bigints travel to and from the prover')
}

export function fromWire(value: Wire): unknown {
  if (typeof value === 'string') return BigInt(value)
  if (Array.isArray(value)) return value.map(fromWire)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromWire(v)]))
}

// The offscreen document opens a port of this name to the service worker, which posts proof
// requests only on it: a port's messages reach the side that opened it alone, where a runtime
// message reaches every extension page. The worker asks for the port with a wake message, which
// carries nothing secret.
export const PROVER_PORT = 'offscreen-prover'
export const PROVER_WAKE = 'offscreen-prover-wake'

// The circuit's pins come with each proof the SDK asks for, and the paths say where the package
// holds its files; the document proves only with files that match the pins.
export interface ProveRequest {
  readonly id: number
  readonly witness: Wire
  readonly circuit: CircuitPins
  readonly paths: Readonly<Record<ArtifactName, string>>
}

export type ProveReply = { readonly id: number } & (
  | { readonly ok: true; readonly proof: Wire }
  | { readonly ok: false }
)
