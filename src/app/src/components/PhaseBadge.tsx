import { Loader2, Clock, CircleCheck, AlertCircle, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PhaseKey, PhaseInfo } from '@/lib/phase'

// A spinner means active work; a clock means an intentional, timed wait (the privacy delay), so the
// scheduled phase reads as "waiting on a timer", not stuck. Color carries the state at a glance.
const VISUAL: Record<
  PhaseKey,
  { Icon: LucideIcon; color: string; spin?: boolean; pulse?: boolean }
> = {
  committing: { Icon: Loader2, color: 'text-amber-500', spin: true },
  delivering: { Icon: Loader2, color: 'text-primary', spin: true },
  waiting: { Icon: Clock, color: 'text-primary', pulse: true },
  delivered: { Icon: CircleCheck, color: 'text-green-500' },
  failed: { Icon: AlertCircle, color: 'text-destructive' },
  recovered: { Icon: RotateCcw, color: 'text-green-500' },
  recovering: { Icon: RotateCcw, color: 'text-amber-500', spin: true },
}

interface Props {
  phase: PhaseInfo
  size?: number
  className?: string
  // Drop the verb and show only the icon (plus the ETA when present), for dense rows where the verb
  // lives elsewhere. The icon and ETA still carry the phase color.
  hideLabel?: boolean
}

export function PhaseBadge({ phase, size = 13, className = '', hideLabel = false }: Props) {
  const v = VISUAL[phase.key]
  const anim = v.spin ? 'animate-spin' : v.pulse ? 'animate-pulse' : ''
  const text = hideLabel ? phase.eta : `${phase.label}${phase.eta ? ` - ${phase.eta}` : ''}`
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${v.color} ${className}`}>
      <v.Icon size={size} className={`shrink-0 ${anim}`} />
      {text && <span className="truncate whitespace-nowrap text-xs font-medium">{text}</span>}
    </span>
  )
}
