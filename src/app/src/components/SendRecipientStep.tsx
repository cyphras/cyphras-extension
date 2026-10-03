import { useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddressAvatar } from '@/components/AddressAvatar'
import { Reveal } from '@/components/Collapse'
import {
  detectRecipientFamily,
  isBitcoinTestnetAddress,
  shortAddress,
  type RecipientFamily,
} from '@/lib/address'

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
  bitcoin,
  onBack,
  onContinue,
}: {
  recents: RecipientSuggestion[]
  ownAccounts: RecipientSuggestion[]
  evmEnabled: boolean
  evmName: string
  stellarIcon?: string
  evmIcon?: string
  // The environment's Bitcoin chain, absent when Bitcoin is not enabled.
  bitcoin?: { name: string; icon?: string; testnet: boolean }
  onBack: () => void
  onContinue: (address: string, family: RecipientFamily) => void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const family = detectRecipientFamily(trimmed)
  const unsupportedEvm = family === 'evm' && !evmEnabled
  const unsupportedBitcoin = family === 'bitcoin' && !bitcoin
  // A mainnet address on testnet (or the reverse) would send to a chain this wallet is not on.
  const wrongBitcoinNetwork =
    family === 'bitcoin' && !!bitcoin && isBitcoinTestnetAddress(trimmed) !== bitcoin.testnet
  const ready = !!family && !unsupportedEvm && !unsupportedBitcoin && !wrongBitcoinNetwork

  const networkOf = (f: RecipientFamily) =>
    f === 'stellar' ? 'Stellar' : f === 'bitcoin' ? (bitcoin?.name ?? 'Bitcoin') : evmName
  const iconOf = (f: RecipientFamily) =>
    f === 'stellar' ? stellarIcon : f === 'bitcoin' ? bitcoin?.icon : evmIcon
  const available = (r: RecipientSuggestion) =>
    r.family === 'stellar' || (r.family === 'evm' ? evmEnabled : !!bitcoin)
  const kinds = ['Stellar', ...(evmEnabled ? ['EVM'] : []), ...(bitcoin ? ['Bitcoin'] : [])]
  const kindsText =
    kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} or ${kinds[kinds.length - 1]}` : kinds[0]

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
                placeholder={kinds.length > 1 ? `${kindsText} address` : 'Stellar address (G...)'}
                spellCheck={false}
                autoComplete="off"
                aria-label="Recipient address"
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground"
              />
            </div>
            <Reveal show={trimmed !== ''} gap={8}>
              <p className={`text-[11px] ${ready ? 'text-muted-foreground' : 'text-destructive'}`}>
                {ready && family
                  ? family === 'stellar'
                    ? 'Stellar address'
                    : family === 'bitcoin'
                      ? `Bitcoin address, sends on ${bitcoin?.name}`
                      : `EVM address, sends on ${evmName}`
                  : unsupportedEvm
                    ? 'EVM sends are not available on this network'
                    : unsupportedBitcoin
                      ? 'Bitcoin sends are not available on this network'
                      : wrongBitcoinNetwork
                        ? bitcoin?.testnet
                          ? 'This is a mainnet Bitcoin address; switch to Mainnet to send to it'
                          : 'This is a testnet Bitcoin address; switch to Testnet to send to it'
                        : `Not a ${kindsText} address`}
              </p>
            </Reveal>
          </div>

          {section('Recent', recents.filter(available))}
          {section('Your accounts', ownAccounts.filter(available))}
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
