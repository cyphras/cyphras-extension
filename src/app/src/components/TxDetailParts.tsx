import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, X } from 'lucide-react'
import { AssetIcon, type AssetIconSize } from '@/components/token/AssetIcon'
import { NumberTicker } from '@/components/NumberTicker'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { Collapse } from '@/components/Collapse'
import { PrivateAddressAvatar } from '@/components/PrivateAddressAvatar'
import { StellarAvatar } from '@/components/StellarAvatar'
import { shortAddress } from '@/lib/address'
import { useAvatarKey } from '@/hooks/useAvatarKey'

// Shared detail rows so a Stellar payment and an EVM transfer read the same way.

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs text-foreground">{children}</div>
    </div>
  )
}

export function CopyValue({
  value,
  display,
  avatar,
}: {
  value: string
  display?: string
  avatar?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const avatarKey = useAvatarKey()
  const short = display ?? (value.length > 18 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard denied; the value stays visible
        }
      }}
      className="ml-auto flex cursor-pointer items-center gap-1.5 font-mono text-xs text-foreground transition-colors hover:text-primary"
    >
      {avatar && <StellarAvatar publicKey={avatarKey(value)} size={14} />}
      {short}
      {copied ? (
        <Check size={11} className="pop-enter text-green-500" />
      ) : (
        <Copy size={11} className="text-muted-foreground" />
      )}
    </button>
  )
}

export function AddressValue({ address, isYou }: { address?: string; isYou?: boolean }) {
  if (!address) return <span>-</span>
  if (isYou) return <span className="font-medium">You</span>
  return <CopyValue value={address} display={shortAddress(address)} avatar />
}

// A private address with its identicon, copied whole.
export function PrivateAddressValue({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PrivateAddressAvatar address={address} size={14} />
      <CopyValue value={address} display={shortAddress(address)} />
    </span>
  )
}

export function NetworkValue({ name, icon }: { name: string; icon?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full" />}
      {name}
    </span>
  )
}

export type StatusTone = 'ok' | 'warn' | 'bad'

const TONE_PILL: Record<StatusTone, string> = {
  ok: 'bg-green-500/10 text-green-600 dark:text-green-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
}
const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
}

export function StatusPill({ text, tone }: { text: string; tone: StatusTone }) {
  return (
    <span
      className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE_PILL[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {text}
    </span>
  )
}

export function AdvancedDetails({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="rounded-xl bg-card px-4">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>Advanced details</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <Collapse open={open}>
        <div className="divide-y divide-border/60 border-t border-border/60">{children}</div>
      </Collapse>
    </div>
  )
}

// The token itself carries a transaction's status: a spinning ring while it is
// pending, then a small check or cross once the network settles it.
export function TokenStatusIcon({
  state,
  code,
  icon,
  chainIcon,
  size = 'lg',
  className = '',
}: {
  state: 'pending' | 'success' | 'failed'
  code: string
  icon?: string
  chainIcon?: string
  size?: AssetIconSize
  className?: string
}) {
  return (
    <div className={`relative p-1 ${state === 'failed' ? 'opacity-60' : ''} ${className}`}>
      {state === 'pending' && (
        <span
          aria-hidden
          className="absolute inset-0 animate-spin rounded-full border-2 border-amber-500/20 border-t-amber-500"
        />
      )}
      <AssetIcon code={code} icon={icon} chainIcons={[chainIcon]} size={size} />
      {state !== 'pending' && (
        <span
          className={`pop-enter absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-white ${
            state === 'success' ? 'bg-green-500' : 'bg-destructive'
          }`}
        >
          {state === 'success' ? (
            <Check size={11} strokeWidth={3} />
          ) : (
            <X size={11} strokeWidth={3} />
          )}
        </span>
      )}
    </div>
  )
}

// A plain signed figure rolls into place like the balances on Home; anything
// else (an estimate, a range) is shown as given.
function RollingAmount({ text }: { text: string }) {
  const m = /^([+-]?)(\d[\d,]*)(?:\.(\d+))?$/.exec(text)
  if (!m) return <>{text}</>
  const [, sign, whole, frac = ''] = m
  const value = parseFloat(`${whole.replace(/,/g, '')}${frac ? `.${frac}` : ''}`)
  const format = (v: number) =>
    sign +
    v.toLocaleString('en-US', {
      minimumFractionDigits: frac.length,
      maximumFractionDigits: frac.length,
      useGrouping: whole.includes(','),
    })
  return <NumberTicker value={value} format={format} />
}

export function TxResultHero({
  state,
  amountText,
  code,
  issuer,
  icon,
  chainIcon,
  verified,
  positive = false,
  subtitle,
  note,
}: {
  state: 'pending' | 'success' | 'failed'
  amountText: string
  code: string
  issuer?: string
  icon?: string
  chainIcon?: string
  verified?: boolean
  positive?: boolean
  subtitle?: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-card px-4 py-5 text-center">
      <TokenStatusIcon
        state={state}
        code={code}
        icon={icon}
        chainIcon={chainIcon}
        className="value-enter mb-3"
      />
      <p
        className={`text-2xl font-bold tabular-nums ${
          state === 'failed'
            ? 'text-muted-foreground line-through decoration-1'
            : positive
              ? 'text-green-500'
              : 'text-foreground'
        }`}
      >
        <RollingAmount text={amountText} />{' '}
        <span className="text-base font-medium text-muted-foreground">{code}</span>
        {verified ? (
          <VerifiedBadge className="ml-1 inline-block h-4 w-4 align-[-2px]" />
        ) : (
          <VerifiedMark code={code} issuer={issuer} className="ml-1 h-4 w-4" />
        )}
      </p>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      {note && <p className="mt-3 text-xs leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}
