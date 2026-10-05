import { useState } from 'react'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { Search, X } from 'lucide-react'
import { usePreferences } from '@/context/PreferencesContext'

export interface ShieldedTokenRow {
  poolId: string
  code: string
  label: string
  // Pre-decimalized display string per pool.decimals, not raw units.
  balance: string
  // The parts of a private balance still in flight, in the glossary's words.
  detail?: string
  usdValue: number | null
  usdPrice?: number | null
  icon?: string
}

interface ShieldedTokenPickerProps {
  tokens: ShieldedTokenRow[]
  onSelect: (poolId: string) => void
  onClose: () => void
}

// Balance shown is whatever the parent passes per action: private for send/unshield, public for shield.
export default function ShieldedTokenPicker({
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
          <p className="text-sm font-semibold text-foreground">Select asset</p>
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
              <AssetIcon code={t.code} icon={t.icon} />
              <div className="flex-1 min-w-0">
                <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t.code}
                  <VerifiedBadge />
                </p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-foreground tabular-nums">{t.balance}</p>
                {t.detail ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{t.detail}</p>
                ) : (
                  t.usdValue !== null && (
                    <p className="text-xs text-muted-foreground">{formatValue(t.usdValue)}</p>
                  )
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
