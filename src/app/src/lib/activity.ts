import type { Operation } from '@/hooks/useHistory'
import type { CctpJobInfo, EvmActivity } from '@ext-types/index'
import { getAmountDisplay, getDirection, getOpLabel, formatDateLabel } from '@/lib/historyUtils'
import { statusMeta, isCctpInFlight } from '@/lib/cctp'

// One row of the multichain history list: each source keeps its own record for its
// detail sheet, wrapped in the shared timestamp/chain envelope the list sorts on.
export type HistoryRow =
  | { kind: 'stellar'; id: string; timestamp: string; chain: string; op: Operation }
  | { kind: 'evm'; id: string; timestamp: string; chain: string; tx: EvmActivity }
  | {
      kind: 'bridge'
      id: string
      timestamp: string
      chain: string
      toChain: string
      // A bridge touches two chains: 'out' is the burn on the source chain,
      // 'in' the mint on the destination, so each chain's history shows its side.
      leg: 'out' | 'in'
      job: CctpJobInfo
    }

export type RowStatus = 'confirmed' | 'pending' | 'failed'

export interface RowView {
  label: string
  direction: 'in' | 'out' | 'neutral'
  amount: { value: string; code: string } | null
  status: RowStatus
  statusLabel?: string
  code: string
  issuer?: string
  // Set when the protocol itself guarantees the token (CCTP only moves
  // Circle's native USDC), where no issuer is at hand to look up.
  verified?: boolean
  counterparty?: string
}

export function stellarRows(ops: Operation[], chainId: string): HistoryRow[] {
  return ops.map((op) => ({
    kind: 'stellar',
    id: op.id,
    timestamp: op.created_at,
    chain: chainId,
    op,
  }))
}

export function evmRows(activity: EvmActivity[]): HistoryRow[] {
  return activity.map((tx, i) => ({
    kind: 'evm',
    id: `${tx.chain}:${tx.hash}:${i}`,
    timestamp: tx.timestamp,
    chain: tx.chain,
    tx,
  }))
}

export function bridgeRows(
  jobs: CctpJobInfo[],
  stellarChainId: string,
  evmChainId: string
): HistoryRow[] {
  return jobs.flatMap((job): HistoryRow[] => {
    const stellarFirst = job.direction === 'stellar-to-evm'
    const from = stellarFirst ? stellarChainId : evmChainId
    const to = stellarFirst ? evmChainId : stellarChainId
    const out: HistoryRow = {
      kind: 'bridge',
      id: `bridge:${job.id}:out`,
      timestamp: new Date(job.createdAt).toISOString(),
      chain: from,
      toChain: to,
      leg: 'out',
      job,
    }
    if (job.status === 'failed') return [out]
    // At least 1ms after the departure, so newest-first order never lists the arrival below it.
    const arrivedAt = Math.max(job.mintBroadcastAt ?? job.createdAt, job.createdAt + 1)
    const incoming: HistoryRow = {
      kind: 'bridge',
      id: `bridge:${job.id}:in`,
      timestamp: new Date(arrivedAt).toISOString(),
      chain: to,
      toChain: to,
      leg: 'in',
      job,
    }
    return [incoming, out]
  })
}

/**
 * What reached the destination: the burned amount minus the fee Circle
 * executed, once the attestation says what that fee was.
 */
export function bridgeReceived(job: CctpJobInfo): string | null {
  // A zero max fee caps Circle's cut at nothing, so the amount is exact already.
  const fee = job.feeExecuted ?? (parseFloat(job.maxFee) === 0 ? '0' : undefined)
  if (fee === undefined) return null
  const units = (v: string) => BigInt(Math.round(parseFloat(v) * 1e6))
  const net = units(job.amount) - units(fee)
  const whole = net / 1_000_000n
  const frac = (net % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

// A bridge is one action to the user, so its approve/burn/mint transactions
// fold into the bridge row instead of also appearing as raw chain rows.
export function foldBridgeHashes(rows: HistoryRow[]): HistoryRow[] {
  const folded = new Set<string>()
  for (const r of rows) {
    if (r.kind !== 'bridge') continue
    for (const h of [r.job.approveTxHash, r.job.burnTxHash, r.job.mintTxHash]) {
      if (h) folded.add(h.toLowerCase())
    }
  }
  if (folded.size === 0) return rows
  return rows.filter((r) => {
    if (r.kind === 'stellar') return !folded.has(r.op.transaction_hash.toLowerCase())
    if (r.kind === 'evm') return !folded.has(r.tx.hash.toLowerCase())
    return true
  })
}

export function sortRows(rows: HistoryRow[]): HistoryRow[] {
  return rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function groupRowsByDate(rows: HistoryRow[]): { label: string; rows: HistoryRow[] }[] {
  const map = new Map<string, HistoryRow[]>()
  for (const r of rows) {
    const label = formatDateLabel(r.timestamp)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(r)
  }
  return Array.from(map.entries()).map(([label, rows]) => ({ label, rows }))
}

// Four decimals for anything readable, six only for gas-sized dust, so a
// list row never turns into an 18-digit string; sheets show the full value.
export function formatAmount(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  if (n === 0) return '0'
  if (n >= 0.001) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function shortAddress(addr: string): string {
  if (addr.startsWith('0x')) return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

export function formatFiat(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function evmView(tx: EvmActivity): RowView {
  const failed = tx.status === 'failed'
  const pending = tx.status === 'pending'
  const hasValue = parseFloat(tx.amount) > 0
  let label: string
  let direction: RowView['direction']
  if (tx.kind === 'contract' && !hasValue) {
    label = tx.method ? titleCase(tx.method) : 'Contract call'
    direction = 'neutral'
  } else if (tx.direction === 'self') {
    label = 'Self transfer'
    direction = 'neutral'
  } else {
    label = tx.direction === 'in' ? 'Received' : 'Sent'
    direction = tx.direction
  }
  return {
    label,
    direction,
    amount: hasValue ? { value: tx.amount, code: tx.code } : null,
    status: failed ? 'failed' : pending ? 'pending' : 'confirmed',
    code: tx.code,
    issuer: tx.tokenAddress ?? '',
    counterparty: direction === 'in' ? tx.from : tx.to,
  }
}

export function bridgeView(
  job: CctpJobInfo,
  leg: 'out' | 'in',
  fromChainName: string,
  toChainName: string
): RowView {
  const meta = statusMeta(job.status)
  const inFlight = isCctpInFlight(job.status)
  const status: RowStatus = job.status === 'failed' ? 'failed' : inFlight ? 'pending' : 'confirmed'
  if (leg === 'in') {
    return {
      label: `Bridge from ${fromChainName}`,
      direction: 'in',
      amount: { value: bridgeReceived(job) ?? job.amount, code: 'USDC' },
      status,
      statusLabel: job.status === 'approved' ? 'Paused' : inFlight ? 'Arriving' : undefined,
      code: 'USDC',
      verified: true,
      counterparty: job.sourceAddress,
    }
  }
  return {
    label: `Bridge to ${toChainName}`,
    direction: 'out',
    amount: { value: job.amount, code: 'USDC' },
    status,
    statusLabel: inFlight ? meta.label : undefined,
    code: 'USDC',
    verified: true,
    counterparty: job.destAddress,
  }
}

export function stellarView(op: Operation, publicKey: string): RowView {
  const dir = getDirection(op, publicKey)
  const amount = getAmountDisplay(op)
  const failed = op.transaction_successful === false
  const inFlight =
    op.cyphras_private?.direction === 'out' &&
    !!op.cyphras_private.phase &&
    op.cyphras_private.phase.key !== 'delivered'
  return {
    label: getOpLabel(op, publicKey),
    direction: dir,
    amount: amount && amount.amount ? { value: amount.amount, code: amount.code } : null,
    status: failed ? 'failed' : inFlight ? 'pending' : 'confirmed',
    code: amount?.code ?? 'XLM',
    issuer: op.asset_issuer,
    counterparty: dir === 'in' ? (op.from ?? op.funder) : op.to,
  }
}
