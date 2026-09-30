import { useLayoutEffect, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'

// One-time intro spotlighting the balance card; click-through except the caption so the user can peel it right away.
export function PrivateModeHint({
  targetRef,
  onDismiss,
}: {
  targetRef: RefObject<HTMLElement | null>
  onDismiss: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      if (targetRef.current) setRect(targetRef.current.getBoundingClientRect())
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (targetRef.current) ro.observe(targetRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [targetRef])

  if (!rect) return null

  const pad = 0

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {/* Spotlight hole over the card via an oversized surrounding box-shadow. */}
      <div
        className="absolute rounded-xl transition-all"
        style={{
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
        }}
      />

      {/* Pulsing marker on the bottom-right grab corner. */}
      <div className="absolute" style={{ left: rect.right - 18, top: rect.bottom - 18 }}>
        <span className="block h-9 w-9 rounded-full bg-primary/50 animate-ping" />
      </div>

      <div
        className="pointer-events-auto absolute left-1/2 w-[16rem] -translate-x-1/2 rounded-2xl bg-card p-4 text-center shadow-2xl"
        style={{ top: rect.bottom + 32 }}
      >
        <p className="text-sm font-bold text-foreground">Private mode</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Drag the balance card from its bottom-right corner to shield, send, and receive
          privately.
        </p>
        <Button className="mt-3 w-full" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </div>
  )
}
