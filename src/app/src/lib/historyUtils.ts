import type { Operation } from '@/hooks/useHistory'

export function parseAsset(assetStr?: string): { code: string; issuer?: string } {
  if (!assetStr || assetStr === 'native') return { code: 'XLM' }
  const [code, issuer] = assetStr.split(':')
  return { code: code ?? 'XLM', issuer }
}

export function getDirection(op: Operation, publicKey: string): 'in' | 'out' | 'neutral' {
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
