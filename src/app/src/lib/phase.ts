import type { PrivateNote } from '@ext-types/index'

export type PhaseKey =
  | 'committing'
  | 'delivering'
  | 'waiting'
  | 'delivered'
  | 'failed'
  | 'recovered'
  | 'recovering'

export interface PhaseInfo {
  key: PhaseKey
  label: string
  eta?: string
}

// "~12m" / "~30s" until the relayer executes the reveal; undefined once the time has passed so the UI
// falls back to a plain "Delivering" rather than a stale or negative countdown.
export function formatEta(scheduledFor?: string): string | undefined {
  if (!scheduledFor) return undefined
  const ms = new Date(scheduledFor).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `~${Math.max(1, secs)}s`
  return `~${Math.round(ms / 60_000)}m`
}

function etaSeconds(eta: string): number {
  const m = eta.match(/~(\d+)([ms])/)
  if (!m) return 0
  return m[2] === 'm' ? Number(m[1]) * 60 : Number(m[1])
}

// One split's phase. "Deposited" (committed) means the funds are in the pool but the relayer has not
// scheduled the reveal yet, so there is no ETA; "Delivering" (scheduled) always carries the delivery
// ETA. Progression: Shielding -> Deposited -> Delivering -> Delivered.
export function splitPhase(status: string, scheduledFor?: string): PhaseInfo {
  switch (status) {
    case 'pending':
      return { key: 'committing', label: 'Shielding' }
    case 'committed':
      return { key: 'delivering', label: 'Deposited' }
    case 'scheduled': {
      const eta = formatEta(scheduledFor)
      return eta
        ? { key: 'waiting', label: 'Delivering', eta }
        : { key: 'delivering', label: 'Finalizing' }
    }
    case 'revealed':
      return { key: 'delivered', label: 'Delivered' }
    case 'recovering':
      return { key: 'recovering', label: 'Recovering' }
    case 'recovered':
      return { key: 'recovered', label: 'Recovered' }
    case 'failed':
      return { key: 'failed', label: 'Failed' }
    default:
      return { key: 'delivering', label: status }
  }
}

// Roll a group of splits up to one phase, label, and delivery ETA. The fraction always means landed (to
// the recipient or recovered back to the sender) over total, so its meaning never flips between stages.
// A terminal group never returns a spinning key; the verb tracks the least-advanced still-in-flight split.
export function summarizePhase(group: PrivateNote[]): PhaseInfo {
  const count = group.length
  const delivered = group.filter((n) => n.status === 'revealed' && !n.recovered).length
  const recovered = group.filter((n) => n.recovered && n.status === 'revealed').length
  // A reclaim in progress (recovered flag, not yet revealed) is its own bucket; a failed reclaim falls
  // through to failed. Keeping the buckets disjoint means each split is classified once, so inFlight
  // never overcounts and a recovering-only group resolves to the recovering branch below.
  const recovering = group.filter(
    (n) => n.recovered && n.status !== 'revealed' && n.status !== 'failed'
  ).length
  const failed = group.filter((n) => n.status === 'failed').length
  const pending = group.filter((n) => n.status === 'pending' && !n.recovered).length
  const committed = group.filter((n) => n.status === 'committed' && !n.recovered).length
  const scheduled = group.filter((n) => n.status === 'scheduled' && !n.recovered)

  const inFlight = pending + committed + scheduled.length + recovering

  const extra: string[] = []
  if (failed > 0) extra.push(`${failed} failed`)
  if (recovered > 0) extra.push(`${recovered} recovered`)
  if (recovering > 0) extra.push(`${recovering} recovering`)
  const suffix = extra.length ? `, ${extra.join(', ')}` : ''

  if (inFlight === 0) {
    if (delivered === count) return { key: 'delivered', label: 'Delivered' }
    if (recovered === count) return { key: 'recovered', label: 'Recovered' }
    if (failed === count) return { key: 'failed', label: 'Failed' }
    return {
      key: failed > 0 ? 'failed' : 'delivered',
      label: `Delivered ${delivered}/${count}${suffix}`,
    }
  }

  if (pending > 0) return { key: 'committing', label: `Shielding${suffix}` }
  if (scheduled.length > 0) {
    const latest = scheduled
      .map((n) => n.scheduledFor)
      .filter((s): s is string => !!s)
      .sort()
      .at(-1)
    const eta = formatEta(latest)
    return eta
      ? { key: 'waiting', label: `Delivering${suffix}`, eta }
      : { key: 'delivering', label: `Finalizing${suffix}` }
  }
  if (committed > 0) return { key: 'delivering', label: `Deposited${suffix}` }
  return { key: 'recovering', label: `Recovering${suffix}` }
}

// Summarize several concurrent sends. A single per-phase count blends sends at different stages, so
// count them per phase and key the icon off the least-advanced one. When every send shares one phase the
// card title already carries the total, so the label is just the verb (no count) to avoid repeating it.
export function aggregatePhase(phases: PhaseInfo[]): PhaseInfo {
  const committing = phases.filter((p) => p.key === 'committing').length
  const delivering = phases.filter((p) => p.key === 'delivering' || p.key === 'waiting').length
  const recovering = phases.filter((p) => p.key === 'recovering').length
  const buckets = [
    { n: committing, word: 'shielding' },
    { n: delivering, word: 'delivering' },
    { n: recovering, word: 'recovering' },
  ].filter((b) => b.n > 0)
  const label =
    buckets.length === 1
      ? buckets[0].word.charAt(0).toUpperCase() + buckets[0].word.slice(1)
      : buckets.map((b) => `${b.n} ${b.word}`).join(', ') || 'In progress'

  if (committing > 0) return { key: 'committing', label }
  if (delivering === 0 && recovering > 0) return { key: 'recovering', label }
  if (phases.some((p) => p.key === 'waiting')) {
    // The longest remaining wait is when the last send lands.
    const eta = phases
      .filter((p) => p.key === 'waiting' && p.eta)
      .map((p) => p.eta!)
      .sort((a, b) => etaSeconds(b) - etaSeconds(a))[0]
    return { key: 'waiting', label, eta }
  }
  return { key: 'delivering', label }
}
