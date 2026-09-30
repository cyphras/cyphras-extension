import { useState } from 'react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { Search, X } from 'lucide-react'
import { usePreferences } from '@/context/PreferencesContext'
import type { ShieldedAction } from '@/components/ShieldedSend'

export interface ShieldedTokenRow {
  poolId: string
  code: string
  label: string
  // Pre-decimalized display string per pool.decimals, not raw units.
  balance: string
  usdValue: number | null
  usdPrice?: number | null
  icon?: string
}

function XlmIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="76 34 238 238"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
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

function AssetIcon({ icon, code, size = 36 }: { icon?: string; code: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (code === 'XLM') return <XlmIcon size={size} />
  if (icon && !err) {
    return (
      <img
        src={icon}
        alt={code}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-muted shrink-0 flex items-center justify-center"
    >
      <span className="text-xs font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

const ACTION_TITLES: Record<ShieldedAction, string> = {
  send: 'Select token to send',
  shield: 'Select token to shield',
  unshield: 'Select token to unshield',
}

interface ShieldedTokenPickerProps {
  action: ShieldedAction
  tokens: ShieldedTokenRow[]
  onSelect: (poolId: string) => void
  onClose: () => void
}

// Balance shown is whatever the parent passes per action: private for send/unshield, public for shield.
export default function ShieldedTokenPicker({
  action,
  tokens,
  onSelect,
  onClose,
}: ShieldedTokenPickerProps) {
  const { formatValue } = usePreferences()
  const [query, setQuery] = useState('')
  const filtered = tokens.filter((t) => {
    const q = query.toLowerCase()
    return t.code.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-[60] flex flex-col">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[75vh]">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <p className="text-sm font-semibold text-foreground">{ACTION_TITLES[action]}</p>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {tokens.length > 4 && (
          <div className="px-5 pb-3 shrink-0">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Search size={14} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
          </div>
        )}
        <div className="overflow-y-auto flex-1 px-3 pb-4 flex flex-col gap-1 [&>*]:shrink-0">
          {filtered.map((t) => (
            <button
              key={t.poolId}
              onClick={() => {
                onSelect(t.poolId)
                onClose()
              }}
              className="cursor-pointer flex items-center gap-3 w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted border border-transparent"
            >
              <AssetIcon icon={t.icon} code={t.code} />
              <div className="flex-1 min-w-0">
                <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t.code}
                  <VerifiedBadge />
                </p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-foreground tabular-nums">{t.balance}</p>
                {t.usdValue !== null && (
                  <p className="text-xs text-muted-foreground">{formatValue(t.usdValue)}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
