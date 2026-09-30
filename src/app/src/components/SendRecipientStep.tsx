import { useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddressAvatar } from '@/components/AddressAvatar'
import { detectRecipientFamily, shortAddress, type RecipientFamily } from '@/lib/address'

export interface RecipientSuggestion {
  address: string
  family: RecipientFamily
  label?: string
}

// Who first, then what: the address decides the network, so the asset list
// that follows only offers assets that can actually reach it.
export function SendRecipientStep({
  recents,
  ownAccounts,
  evmEnabled,
  evmName,
  stellarIcon,
  evmIcon,
  onBack,
  onContinue,
}: {
  recents: RecipientSuggestion[]
  ownAccounts: RecipientSuggestion[]
  evmEnabled: boolean
  evmName: string
  stellarIcon?: string
  evmIcon?: string
  onBack: () => void
  onContinue: (address: string, family: RecipientFamily) => void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const family = detectRecipientFamily(trimmed)
  const unsupportedEvm = family === 'evm' && !evmEnabled
  const ready = !!family && !unsupportedEvm

  const networkOf = (f: RecipientFamily) => (f === 'stellar' ? 'Stellar' : evmName)
  const iconOf = (f: RecipientFamily) => (f === 'stellar' ? stellarIcon : evmIcon)

  const renderRow = (s: RecipientSuggestion) => (
    <button
      key={`${s.family}:${s.address}`}
      onClick={() => onContinue(s.address, s.family)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <AddressAvatar address={s.address} chainIcon={iconOf(s.family)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {s.label ?? shortAddress(s.address)}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {s.label
            ? `${shortAddress(s.address)} on ${networkOf(s.family)}`
            : `on ${networkOf(s.family)}`}
        </span>
      </span>
    </button>
  )

  const section = (title: string, rows: RecipientSuggestion[]): ReactNode =>
    rows.length > 0 && (
      <div className="flex flex-col gap-1">
        <p className="pixel-label px-1 text-[10px] text-muted-foreground">{title}</p>
        <div className="rounded-xl bg-card p-1">{rows.map(renderRow)}</div>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5">
        <div className="flex flex-col gap-4 py-5">
          <div className="relative flex items-center justify-center">
            <button
              onClick={onBack}
              aria-label="Go back"
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Send</h2>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
            <span className="pixel-label text-[10px] text-muted-foreground">To</span>
            <div className="flex items-center gap-3">
              {ready && family && <AddressAvatar address={trimmed} chainIcon={iconOf(family)} />}
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ready && family) onContinue(trimmed, family)
                }}
                placeholder={evmEnabled ? 'Stellar or EVM address' : 'Stellar address (G...)'}
                spellCheck={false}
                autoComplete="off"
                aria-label="Recipient address"
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground"
              />
            </div>
            {trimmed !== '' && (
              <p className={`text-[11px] ${ready ? 'text-muted-foreground' : 'text-destructive'}`}>
                {ready && family
                  ? family === 'stellar'
                    ? 'Stellar address'
                    : `EVM address, sends on ${evmName}`
                  : unsupportedEvm
                    ? 'EVM sends are not available on this network'
                    : 'Not a Stellar or EVM address'}
              </p>
            )}
          </div>

          {section(
            'Recent',
            recents.filter((r) => r.family === 'stellar' || evmEnabled)
          )}
          {section(
            'Your accounts',
            ownAccounts.filter((r) => r.family === 'stellar' || evmEnabled)
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 px-5 py-4">
        <Button
          className="w-full"
          disabled={!ready}
          onClick={() => family && onContinue(trimmed, family)}
        >
          {trimmed === '' ? 'Enter an address' : ready ? 'Continue' : 'Check the address'}
        </Button>
      </div>
    </div>
  )
}
