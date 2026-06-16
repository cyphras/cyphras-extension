import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  Plus,
  Minus,
  Wallet,
  BarChart2,
  GitMerge,
  Code2,
  Gift,
  Settings,
  Database,
  Zap,
} from 'lucide-react'
import type { Operation } from '@/hooks/useHistory'
import { getDirection, parseAsset } from '@/lib/historyUtils'

interface Badge {
  icon: React.ReactNode
  bg: string
  color: string
}

export function getBadge(op: Operation, publicKey: string): Badge {
  const dir = getDirection(op, publicKey)
  const isRemoveTrust = op.limit === '0' || op.limit === '0.0000000'
  const p = { bg: 'bg-primary', color: 'text-primary-foreground' }
  if (op.cyphras_private) {
    // Reuse the plain send/receive arrows so private transfers blend into the history list.
    return op.cyphras_private.direction === 'out'
      ? { icon: <ArrowUp size={10} />, ...p }
      : { icon: <ArrowDown size={10} />, ...p }
  }
  switch (op.type) {
    case 'payment':
      return dir === 'in'
        ? { icon: <ArrowDown size={10} />, ...p }
        : { icon: <ArrowUp size={10} />, ...p }
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive':
      return { icon: <ArrowLeftRight size={10} />, ...p }
    case 'create_account':
      return dir === 'in'
        ? { icon: <ArrowDown size={10} />, ...p }
        : { icon: <Wallet size={10} />, ...p }
    case 'change_trust':
      return isRemoveTrust
        ? { icon: <Minus size={10} />, ...p }
        : { icon: <Plus size={10} />, ...p }
    case 'manage_sell_offer':
    case 'manage_buy_offer':
    case 'create_passive_sell_offer':
      return { icon: <BarChart2 size={10} />, ...p }
    case 'account_merge':
      return { icon: <GitMerge size={10} />, ...p }
    case 'invoke_host_function':
      return { icon: <Code2 size={10} />, ...p }
    case 'claim_claimable_balance':
    case 'create_claimable_balance':
      return { icon: <Gift size={10} />, ...p }
    case 'set_options':
      return { icon: <Settings size={10} />, ...p }
    case 'manage_data':
      return { icon: <Database size={10} />, ...p }
    default:
      return { icon: <Zap size={10} />, ...p }
  }
}

function XlmIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="76 34 238 238" xmlns="http://www.w3.org/2000/svg">
      <circle cx="195.1" cy="153.1" r="118.9" fill="black" />
      <path
        fill="white"
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}

function TokenIcon({
  code,
  issuer,
  iconMap,
}: {
  code: string
  issuer?: string
  iconMap: Map<string, string>
}) {
  const [imgError, setImgError] = useState(false)
  if (code === 'XLM') {
    return (
      <div className="h-10 w-10 rounded-full overflow-hidden bg-black flex items-center justify-center flex-shrink-0">
        <XlmIcon size={40} />
      </div>
    )
  }
  const src = issuer ? iconMap.get(`${code}:${issuer}`) : undefined
  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={code}
        className="h-10 w-10 rounded-full object-cover flex-shrink-0"
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

export function OpIcon({
  op,
  publicKey,
  iconMap,
}: {
  op: Operation
  publicKey: string
  iconMap: Map<string, string>
}) {
  const badge = getBadge(op, publicKey)

  let code = 'XLM'
  let issuer: string | undefined
  if (op.cyphras_private) {
    code = op.cyphras_private.asset
  } else if (
    op.type === 'payment' ||
    op.type === 'change_trust' ||
    op.type === 'claim_claimable_balance'
  ) {
    code = op.asset_type === 'native' ? 'XLM' : (op.asset_code ?? 'XLM')
    issuer = op.asset_issuer
  } else if (op.type === 'create_claimable_balance') {
    const parsed = parseAsset(op.asset)
    code = parsed.code
    issuer = parsed.issuer
  } else if (op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') {
    code = op.asset_type === 'native' ? 'XLM' : (op.asset_code ?? 'XLM')
    issuer = op.asset_issuer
  } else if (op.type === 'manage_sell_offer' || op.type === 'create_passive_sell_offer') {
    code = op.selling_asset_type === 'native' ? 'XLM' : (op.selling_asset_code ?? 'XLM')
    issuer = op.selling_asset_issuer
  } else if (op.type === 'manage_buy_offer') {
    code = op.buying_asset_type === 'native' ? 'XLM' : (op.buying_asset_code ?? 'XLM')
    issuer = op.buying_asset_issuer
  }

  return (
    <div className="relative flex-shrink-0">
      <TokenIcon code={code} issuer={issuer} iconMap={iconMap} />
      <div
        className={`absolute -bottom-1 -right-1 h-[18px] w-[18px] rounded-full border-2 border-background flex items-center justify-center ${badge.bg}`}
      >
        <span className={badge.color}>{badge.icon}</span>
      </div>
    </div>
  )
}
