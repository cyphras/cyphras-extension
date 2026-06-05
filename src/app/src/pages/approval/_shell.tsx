import { useState } from 'react'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StellarAvatar } from '@/components/StellarAvatar'

function SiteBanner({ origin }: { origin: string }) {
  const [faviconErr, setFaviconErr] = useState(false)
  const domain = (() => {
    try {
      return new URL(origin).host
    } catch {
      return origin
    }
  })()

  return (
    <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0 bg-background">
      {!faviconErr && origin ? (
        <img
          src={`${origin}/favicon.ico`}
          onError={() => setFaviconErr(true)}
          className="h-4 w-4 rounded-sm shrink-0 object-contain"
          alt=""
        />
      ) : (
        <Globe size={14} className="text-muted-foreground shrink-0" />
      )}
      <span className="text-xs text-muted-foreground truncate font-medium">
        {domain || 'Unknown site'}
      </span>
    </div>
  )
}

interface PrimaryBtn {
  label: string
  loadingLabel?: string
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'destructive'
}

interface SecondaryBtn {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface ApprovalShellProps {
  origin: string
  children: React.ReactNode
  primary: PrimaryBtn
  secondary: SecondaryBtn
  loading?: boolean
}

export function ApprovalShell({
  origin,
  children,
  primary,
  secondary,
  loading,
}: ApprovalShellProps) {
  return (
    <div className="flex flex-col h-screen bg-background">
      <SiteBanner origin={origin} />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-5 flex flex-col gap-4">{children}</div>
      </div>
      <div className="shrink-0 border-t border-border px-5 py-4 flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={secondary.onClick}
          disabled={secondary.disabled ?? loading}
        >
          {secondary.label}
        </Button>
        <Button
          variant={primary.variant ?? 'default'}
          className="flex-1"
          onClick={primary.onClick}
          disabled={primary.disabled ?? loading}
        >
          {loading && primary.loadingLabel ? primary.loadingLabel : primary.label}
        </Button>
      </div>
    </div>
  )
}

interface InfoRowProps {
  label: string
  children: React.ReactNode
}

export function InfoRow({ label, children }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">{children}</div>
    </div>
  )
}

export function InfoCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-card divide-y divide-border overflow-hidden">{children}</div>
}

export function ActionHeader({
  icon,
  title,
  subtitle,
  variant = 'default',
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  variant?: 'default' | 'destructive'
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-center pt-1 pb-0.5">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full ${variant === 'destructive' ? 'bg-destructive/10' : 'bg-primary/10'}`}
      >
        {icon}
      </div>
      <div>
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

export function TrustNote({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-xs text-muted-foreground pb-1">{children}</p>
}

export function AddressChip({ publicKey }: { publicKey: string }) {
  const short = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
  return (
    <>
      <StellarAvatar publicKey={publicKey} size={18} />
      <span className="text-sm font-mono font-medium text-foreground">{short}</span>
    </>
  )
}
