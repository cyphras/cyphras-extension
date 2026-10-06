import { Globe, ChevronDown, Check } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'

export interface NetworkFilterOption {
  id: string
  name: string
}

export const ALL_NETWORKS = 'all'

function ChainDisc({ icon, size }: { icon?: string; size: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'
  if (icon) return <img src={icon} alt="" className={`${dim} shrink-0 rounded-full object-cover`} />
  return <span className={`${dim} shrink-0 rounded-full bg-muted`} />
}

function GlobeDisc({ size }: { size: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'
  return (
    <span className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-muted`}>
      <Globe size={size === 'sm' ? 12 : 14} className="text-muted-foreground" />
    </span>
  )
}

export function NetworkFilterButton({
  value,
  options,
  chainIcons,
  onClick,
}: {
  value: string
  options: NetworkFilterOption[]
  chainIcons: Map<string, string>
  onClick: () => void
}) {
  const current = options.find((o) => o.id === value)
  return (
    <button
      onClick={onClick}
      className="cursor-pointer flex items-center gap-2 rounded-full bg-card py-1.5 pl-2 pr-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {value === ALL_NETWORKS ? (
        <GlobeDisc size="sm" />
      ) : (
        <ChainDisc icon={chainIcons.get(value)} size="sm" />
      )}
      {value === ALL_NETWORKS ? 'All networks' : (current?.name ?? value)}
      <ChevronDown size={13} className="text-muted-foreground" />
    </button>
  )
}

export function NetworkFilterSheet({
  open,
  value,
  options,
  chainIcons,
  onSelect,
  onClose,
}: {
  open: boolean
  value: string
  options: NetworkFilterOption[]
  chainIcons: Map<string, string>
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} title="Network" onClose={onClose}>
      <div className="flex flex-col gap-1">
        {[{ id: ALL_NETWORKS, name: 'All networks' }, ...options].map((c) => {
          const active = value === c.id
          return (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c.id)
                onClose()
              }}
              className={`cursor-pointer flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                active ? 'border-primary/20 bg-primary/10' : 'border-transparent hover:bg-muted'
              }`}
            >
              {c.id === ALL_NETWORKS ? (
                <GlobeDisc size="md" />
              ) : (
                <ChainDisc icon={chainIcons.get(c.id)} size="md" />
              )}
              <span
                className={`flex-1 text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}
              >
                {c.name}
              </span>
              {active && <Check size={14} className="shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
