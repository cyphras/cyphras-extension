import type { Operation } from '@/hooks/useHistory'
import type { PrivateNote } from '@ext-types/index'
import { summarizePhase } from '@/lib/phase'

export function parseAsset(assetStr?: string): { code: string; issuer?: string } {
  if (!assetStr || assetStr === 'native') return { code: 'XLM' }
  const [code, issuer] = assetStr.split(':')
  return { code: code ?? 'XLM', issuer }
}

export function getDirection(op: Operation, publicKey: string): 'in' | 'out' | 'neutral' {
  if (op.cyphras_private) return op.cyphras_private.direction
  if (
    op.type === 'payment' ||
    op.type === 'path_payment_strict_send' ||
    op.type === 'path_payment_strict_receive'
  ) {
    return op.to === publicKey ? 'in' : 'out'
  }
  if (op.type === 'create_account') return op.account === publicKey ? 'in' : 'out'
  if (op.type === 'claim_claimable_balance') return 'in'
  if (op.type === 'create_claimable_balance') return 'out'
  return 'neutral'
}

export function getOpLabel(op: Operation, publicKey: string): string {
  if (op.cyphras_private) {
    // Recipient sees a plain "Received": they must not learn the funds came from a private pool.
    // Only the sender, on their own device, sees "Private sent".
    return op.cyphras_private.direction === 'out' ? 'Private sent' : 'Received'
  }
  switch (op.type) {
    case 'payment':
      return getDirection(op, publicKey) === 'in' ? 'Received' : 'Sent'
    case 'create_account':
      return getDirection(op, publicKey) === 'in' ? 'Account funded' : 'Account created'
    case 'change_trust':
      return op.limit === '0' || op.limit === '0.0000000' ? 'Trustline removed' : 'Trustline added'
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive':
      return getDirection(op, publicKey) === 'in' ? 'Swap received' : 'Swap sent'
    case 'manage_sell_offer':
      return 'Sell offer'
    case 'manage_buy_offer':
      return 'Buy offer'
    case 'create_passive_sell_offer':
      return 'Passive sell offer'
    case 'set_options':
      return 'Options set'
    case 'account_merge':
      return 'Account merged'
    case 'manage_data':
      return 'Data entry'
    case 'claim_claimable_balance':
      return 'Balance claimed'
    case 'create_claimable_balance':
      return 'Claimable created'
    case 'invoke_host_function':
      return 'Contract call'
    default:
      return op.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

// Trim trailing zeros from a decimal amount string without rounding: "10.5800000" -> "10.58".
export function trimZeros(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}

export function getAmountDisplay(op: Operation): { amount: string; code: string } | null {
  if (op.cyphras_private) {
    return { amount: trimZeros(op.cyphras_private.amount), code: op.cyphras_private.asset }
  }
  if (op.type === 'create_account' && op.starting_balance)
    return { amount: trimZeros(op.starting_balance), code: 'XLM' }
  if (op.type === 'create_claimable_balance' && op.amount) {
    return { amount: trimZeros(op.amount), code: parseAsset(op.asset).code }
  }
  if (op.amount) {
    const code = op.asset_type === 'native' ? 'XLM' : (op.asset_code ?? '')
    return { amount: trimZeros(op.amount), code }
  }
  if (op.type === 'change_trust' && op.asset_code) return { amount: '', code: op.asset_code }
  return null
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getTime() === today.getTime()) return 'Today'
  if (d.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function groupByDate(ops: Operation[]): { label: string; ops: Operation[] }[] {
  const map = new Map<string, Operation[]>()
  for (const op of ops) {
    const label = formatDateLabel(op.created_at)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(op)
  }
  return Array.from(map.entries()).map(([label, ops]) => ({ label, ops }))
}

export function stroopsToXlm(s: string): string {
  return (parseInt(s) / 10_000_000).toFixed(7)
}

export function isRelatedToAsset(
  op: Operation,
  code: string,
  issuer: string,
  isNative: boolean
): boolean {
  const matches = (c?: string, i?: string, type?: string) =>
    isNative ? type === 'native' : c === code && i === issuer

  switch (op.type) {
    case 'payment':
      return matches(op.asset_code, op.asset_issuer, op.asset_type)
    case 'change_trust':
      return matches(op.asset_code, op.asset_issuer, op.asset_type)
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive':
      return (
        matches(op.asset_code, op.asset_issuer, op.asset_type) ||
        matches(op.source_asset_code, op.source_asset_issuer, op.source_asset_type)
      )
    case 'manage_sell_offer':
    case 'manage_buy_offer':
    case 'create_passive_sell_offer':
      return (
        matches(op.selling_asset_code, op.selling_asset_issuer, op.selling_asset_type) ||
        matches(op.buying_asset_code, op.buying_asset_issuer, op.buying_asset_type)
      )
    case 'create_account':
      return isNative
    case 'claim_claimable_balance':
    case 'create_claimable_balance': {
      const parsed = parseAsset(op.asset)
      return isNative ? parsed.code === 'XLM' : parsed.code === code && parsed.issuer === issuer
    }
    default:
      return false
  }
}

// Group a sender's notes by batchId, so two sends to the same recipient stay distinct regardless of
// timing. Legacy notes without a batchId fall back to a recipient + asset + 120s-window heuristic.
export function groupSenderNotes(notes: PrivateNote[]): PrivateNote[][] {
  const sorted = notes.slice().sort((a, b) => a.counter - b.counter)
  const groups: PrivateNote[][] = []
  for (const n of sorted) {
    const g = groups[groups.length - 1]
    const last = g?.[g.length - 1]
    const sameBatch =
      !!last &&
      (n.batchId || last.batchId
        ? n.batchId === last.batchId
        : last.recipient === n.recipient &&
          last.asset === n.asset &&
          Math.abs((n.createdAt ?? 0) - (last.createdAt ?? 0)) < 120_000)
    if (sameBatch) g.push(n)
    else groups.push([n])
  }
  return groups
}

// A note normally delivers within its privacy delay; only past that window plus a margin is it treated
// as stuck and offered for direct reclaim, so a healthy in-flight send is not framed as cancellable.
function stuckThresholdMs(level: string): number {
  const maxDelay = level === 'fast' ? 5 * 60_000 : level === 'maximum' ? 45 * 60_000 : 20 * 60_000
  return maxDelay + 5 * 60_000
}

// A split has left the wallet once its commit leaf is on-chain (status committed/scheduled/revealed, or committedOnChain); a still-pending one is never counted.
function noteCommitted(n: PrivateNote): boolean {
  return (
    n.committedOnChain === true ||
    n.status === 'committed' ||
    n.status === 'scheduled' ||
    n.status === 'revealed'
  )
}

// Sum a send's split denominations into intended/committed/delivered totals, so History and the Home
// status card show the same chain-verified figures from one source.
export function summarizeSendAmounts(group: PrivateNote[]): {
  intended: bigint
  committed: bigint
  delivered: bigint
} {
  const intended = group.reduce((sum, n) => sum + BigInt(n.denomination), 0n)
  const committed = group.reduce(
    (sum, n) => (noteCommitted(n) ? sum + BigInt(n.denomination) : sum),
    0n
  )
  const delivered = group.reduce(
    (sum, n) => (n.status === 'revealed' && !n.recovered ? sum + BigInt(n.denomination) : sum),
    0n
  )
  return { intended, committed, delivered }
}

// Fallback delay window per privacy level, only used for notes scheduled before scheduledAt was recorded.
function nominalDelayMs(level: string): number {
  return (level === 'fast' ? 5 : level === 'maximum' ? 45 : 20) * 60_000
}

// A split's 0-1 delivery progress for the moving bar: deposited is 0.5, a scheduled split advances toward
// 1 with its ETA countdown, delivered is 1. Drives the bar only; shown amounts stay chain-verified.
function noteDeliveryFraction(n: PrivateNote, now: number): number {
  if (n.status === 'revealed') {
    return 1
  }
  if (n.status === 'scheduled' && n.scheduledFor) {
    const target = new Date(n.scheduledFor).getTime()
    const total = n.scheduledAt ? target - n.scheduledAt : nominalDelayMs(n.privacyLevel)
    const elapsed = total - (target - now)
    return 0.5 + 0.5 * Math.min(1, Math.max(0, total > 0 ? elapsed / total : 1))
  }
  if (n.status === 'committed' || n.status === 'scheduled') {
    return 0.5
  }
  return 0
}

// Overall 0-1 delivery progress, amount-weighted across splits so a multi-split send reads as one fill.
// Clamped to never fall below what has actually reached the recipient.
export function deliveryProgress(group: PrivateNote[], now: number): number {
  let intended = 0
  let delivered = 0
  let progress = 0
  for (const n of group) {
    // A split that failed before depositing never left the wallet; keep it out of the bar's total.
    if (n.status === 'failed' && !noteCommitted(n)) {
      continue
    }
    const d = Number(n.denomination)
    intended += d
    if (n.status === 'revealed' && !n.recovered) {
      delivered += d
    }
    progress += d * noteDeliveryFraction(n, now)
  }
  if (intended === 0) {
    return 0
  }
  return Math.max(progress / intended, delivered / intended)
}

function buildSenderRow(
  group: PrivateNote[],
  formatStroops: (stroops: string, asset: string) => string
): Operation {
  const asset = group[0].asset
  const { intended, committed, delivered } = summarizeSendAmounts(group)
  // What actually left the wallet: drop splits that failed before depositing (their funds never moved).
  const unsent = group
    .filter((n) => n.status === 'failed' && !noteCommitted(n))
    .reduce((sum, n) => sum + BigInt(n.denomination), 0n)
  const sent = intended - unsent
  const count = group.length
  const phase = summarizePhase(group)
  const createdAt = Math.max(...group.map((n) => n.createdAt ?? 0))
  return {
    id: `private-send-${group[0].counter}`,
    type: 'private_send',
    created_at: new Date(createdAt).toISOString(),
    // No tx hash on the grouped row: linking to a commit would expose the sender on-chain, and the
    // empty hash also hides the explorer link and tx card.
    transaction_hash: '',
    cyphras_private: {
      direction: 'out',
      amount: formatStroops(sent.toString(), asset),
      committedAmount: formatStroops(committed.toString(), asset),
      deliveredAmount: formatStroops(delivered.toString(), asset),
      notes: group,
      asset,
      recipient: group[0].recipient,
      splits: count,
      phase,
      splitsDetail: group.map((n) => ({
        amount: formatStroops(n.denomination, asset),
        status: n.recovered ? (n.status === 'revealed' ? 'recovered' : 'recovering') : n.status,
        scheduledFor: n.scheduledFor,
        revealTxHash: n.revealTxHash,
      })),
      failedCounters: group
        .filter((n) => n.status === 'failed' && noteCommitted(n))
        .map((n) => n.counter),
      unsentCounters: group
        .filter((n) => n.status === 'failed' && !noteCommitted(n))
        .map((n) => n.counter),
      reclaimableCounters: group
        .filter(
          (n) =>
            noteCommitted(n) &&
            (n.status === 'committed' || n.status === 'scheduled') &&
            Date.now() - (n.createdAt ?? 0) > stuckThresholdMs(n.privacyLevel)
        )
        .map((n) => n.counter),
      retryableCounters: group
        .filter(
          (n) =>
            !noteCommitted(n) &&
            (n.status === 'committed' || n.status === 'pending') &&
            Date.now() - (n.createdAt ?? 0) > stuckThresholdMs(n.privacyLevel)
        )
        .map((n) => n.counter),
    },
  }
}

// Fold private payments into the Horizon op list: a sender's commits collapse into one "Private sent"
// row, and a pool crediting this account becomes "Private received".
export function enrichWithPrivate(
  ops: Operation[],
  notes: PrivateNote[],
  poolSet: Set<string>,
  publicKey: string,
  formatStroops: (stroops: string, asset: string) => string
): Operation[] {
  const committedHashes = new Set(
    notes.flatMap((n) => [n.txHash, n.revealTxHash]).filter((h): h is string => !!h)
  )
  const senderRows = groupSenderNotes(notes).map((g) => buildSenderRow(g, formatStroops))

  const rest: Operation[] = []
  for (const op of ops) {
    if (op.transaction_hash && committedHashes.has(op.transaction_hash)) {
      continue // a commit, now represented by its grouped sender row
    }
    if (op.type === 'invoke_host_function' && poolSet.size > 0) {
      const changes = op.asset_balance_changes ?? []
      const recv = changes.find((c) => c.to === publicKey && !!c.from && poolSet.has(c.from))
      if (recv) {
        rest.push({
          ...op,
          cyphras_private: {
            direction: 'in',
            amount: recv.amount ?? '0',
            asset: recv.asset_type === 'native' ? 'XLM' : (recv.asset_code ?? ''),
          },
        })
        continue
      }
      // Fallback when the in-band changes carry no pool credit: treat an effects-stream credit as a
      // private receive. The effect lacks the source contract, so this is best-effort, not proof.
      if (op.credited_effect) {
        const c = op.credited_effect
        rest.push({
          ...op,
          cyphras_private: {
            direction: 'in',
            amount: c.amount,
            asset: c.asset_type === 'native' ? 'XLM' : (c.asset_code ?? ''),
          },
        })
        continue
      }
    }
    rest.push(op)
  }

  return [...senderRows, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at))
}
