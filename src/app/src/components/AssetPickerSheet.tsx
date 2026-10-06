import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'

export interface PickerItem {
  key: string
  code: string
  name?: string
  icon?: string
  chainName: string
  chainIcon?: string
  balance?: string // display text, already formatted
  fiat?: string | null
  verified?: boolean
  hint?: string // short right-side note, e.g. "Now in From"
  // Groups rows under this heading instead of their network name.
  section?: string
}

// Every row shows its network, and multi-network lists group by it, so the same
// token on two chains never looks alike.
export function AssetPickerSheet({
  open,
  title,
  note,
  items,
  selectedKey,
  onSelect,
  onClose,
}: {
  open: boolean
  title: string
  note?: string
  items: PickerItem[]
  selectedKey?: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? items.filter((i) =>
        [i.code, i.name ?? '', i.chainName].some((f) => f.toLowerCase().includes(q))
      )
    : items

  const groups = useMemo(() => {
    const byChain = new Map<string, PickerItem[]>()
    for (const item of filtered) {
      const heading = item.section ?? item.chainName
      const list = byChain.get(heading) ?? []
      list.push(item)
      byChain.set(heading, list)
    }
    return [...byChain.entries()]
  }, [filtered])
  // Explicit sections always get headings; network headings only help when a
  // network holds several rows, since each row already names its network.
  const explicitSections = filtered.some((i) => i.section)
  const grouped = groups.length > 1 && (explicitSections || filtered.length > groups.length)

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={() => {
        setQuery('')
        onClose()
      }}
    >
      <div className="flex flex-col gap-3">
        {items.length > 5 && (
          <label className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, code or network"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        )}
        {note && <p className="pixel-label px-1 text-[10px] text-muted-foreground">{note}</p>}

        {groups.map(([chainName, list]) => (
          <div key={chainName} className="flex flex-col gap-1">
            {grouped && (
              <p className="pixel-label px-1 pt-1 text-[10px] text-muted-foreground">{chainName}</p>
            )}
            <div className="flex flex-col gap-1">
              {list.map((item) => {
                const selected = item.key === selectedKey
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setQuery('')
                      onSelect(item.key)
                    }}
                    className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      selected ? 'bg-primary/10' : 'bg-card hover:bg-muted'
                    }`}
                  >
                    <AssetIcon code={item.code} icon={item.icon} chainIcons={[item.chainIcon]} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                        <span className="truncate">{item.code}</span>
                        {item.verified && <VerifiedBadge />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.name && item.name !== item.code
                          ? `${item.name} on ${item.chainName}`
                          : `on ${item.chainName}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums text-foreground">
                        {item.balance ?? '0'}
                      </span>
                      <span className="block text-[11px] tabular-nums text-muted-foreground">
                        {item.hint ?? item.fiat ?? ''}
                      </span>
                    </span>
                    {selected && <Check size={16} className="shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">No assets match</p>
        )}
      </div>
    </BottomSheet>
  )
}
