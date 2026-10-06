import type { BridgeStepState } from '@/lib/cctp'

// Square cells echo the brand's pixel mark used by the logo and account avatars.

const MASK_SIZES = {
  lg: { gap: 'gap-1', cell: 'h-2.5 w-2.5' },
  sm: { gap: 'gap-[3px]', cell: 'h-1.5 w-1.5' },
} as const

export function PixelMask({
  count = 6,
  size = 'lg',
  className = '',
}: {
  count?: number
  size?: keyof typeof MASK_SIZES
  className?: string
}) {
  const s = MASK_SIZES[size]
  return (
    <span
      className={`inline-flex items-center align-middle ${s.gap} ${className}`}
      aria-label="Hidden"
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${s.cell} bg-current opacity-80`} />
      ))}
    </span>
  )
}

const CELLS_PER_STEP = 5

export function PixelProgress({ steps }: { steps: BridgeStepState[] }) {
  return (
    <div className="flex items-center gap-1.5" role="presentation">
      {steps.map((state, s) => (
        <div key={s} className="flex gap-[2px]">
          {Array.from({ length: CELLS_PER_STEP }, (_, i) => {
            const color =
              state === 'done'
                ? 'bg-primary'
                : state === 'error'
                  ? 'bg-destructive'
                  : state === 'paused'
                    ? 'bg-amber-500'
                    : state === 'active' || state === 'wait'
                      ? 'bg-primary pixel-blink'
                      : 'bg-muted'
            // A travelling blink across the active step; slower while only waiting on Circle.
            const delay = state === 'active' ? i * 120 : state === 'wait' ? i * 240 : 0
            return (
              <span
                key={i}
                className={`h-2 w-2 ${color}`}
                style={delay ? { animationDelay: `${delay}ms` } : undefined}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
