import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

// The caller's formatter owns currency, grouping and decimals; only the digits in its
// output roll, so "$", "," and "." stay fixed and the width never jumps.

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  format: (value: number) => string
  delay?: number
}

type Cell = {
  // position counted from the right, so a changing digit count never reshuffles columns
  id: number
  char: string
}

const ROLL_MS = 550
const STAGGER_MS = 30
const MAX_STAGGER_STEPS = 6 // caps settle time under ~0.9s even for many-digit values
const FADE_MS = 150
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
// three laps so a roll can always travel a full 0-9 sweep before landing,
// however close the start and target digits are (including landing on itself)
const DIGITS_LOOP = [...DIGITS, ...DIGITS, ...DIGITS]

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function toCells(formatted: string): Cell[] {
  const chars = Array.from(formatted)
  const lastIndex = chars.length - 1
  return chars.map((char, i) => ({ id: lastIndex - i, char }))
}

function staggerDelay(id: number): number {
  return Math.min(id, MAX_STAGGER_STEPS) * STAGGER_MS
}

export function NumberTicker({
  value,
  format,
  delay = 0.1,
  className,
  ...props
}: NumberTickerProps) {
  const reducedMotion = usePrefersReducedMotion()
  const formatted = format(value)

  // Starts as the target's own shape with every digit at 0, so each column
  // already exists at mount and rolls up into place instead of fading in.
  const [cells, setCells] = useState<Cell[]>(() =>
    toCells(reducedMotion ? formatted : formatted.replace(/\d/g, '0'))
  )
  const [exiting, setExiting] = useState<Cell[]>([])
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // bumped every time cells move to a freshly resolved value, so every digit
  // column re-sweeps even when its own digit happens not to change
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (reducedMotion) {
      setCells(toCells(formatted))
      return
    }
    const timer = setTimeout(() => {
      const next = toCells(formatted)
      setCells((prev) => {
        const nextIds = new Set(next.map((c) => c.id))
        const dropped = prev.filter((c) => !nextIds.has(c.id))
        if (dropped.length > 0) {
          // keep dropped columns mounted just long enough to fade out instead of jumping
          setExiting((prevExiting) => [...dropped, ...prevExiting])
          if (exitTimer.current) clearTimeout(exitTimer.current)
          exitTimer.current = setTimeout(() => setExiting([]), FADE_MS + 80)
        }
        return next
      })
      setRevision((r) => r + 1)
    }, delay * 1000)
    return () => clearTimeout(timer)
  }, [reducedMotion, formatted, delay])

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [])

  return (
    <span className={cn('inline-block tabular-nums', className)} {...props}>
      <span className="sr-only">{formatted}</span>
      {/* every cell is one em tall and top-aligned: a clipped digit column's
          baseline is its bottom edge, so baseline alignment would lift the
          digits above "$", "," and "." */}
      <span aria-hidden="true" className="inline-flex items-start leading-none">
        {exiting.map((cell) => (
          <ExitingCell key={`x${cell.id}`} cell={cell} />
        ))}
        {cells.map((cell) => (
          <TickerCell key={cell.id} cell={cell} reducedMotion={reducedMotion} revision={revision} />
        ))}
      </span>
    </span>
  )
}

function TickerCell({
  cell,
  reducedMotion,
  revision,
}: {
  cell: Cell
  reducedMotion: boolean
  revision: number
}) {
  const [visible, setVisible] = useState(reducedMotion)

  useEffect(() => {
    if (reducedMotion) return
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  const digit = cell.char >= '0' && cell.char <= '9' ? Number(cell.char) : null

  return (
    <span
      className="inline-block"
      style={{
        opacity: visible ? 1 : 0,
        transition: reducedMotion ? undefined : `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {digit === null ? (
        cell.char
      ) : (
        <DigitColumn
          digit={digit}
          delayMs={staggerDelay(cell.id)}
          reducedMotion={reducedMotion}
          revision={revision}
        />
      )}
    </span>
  )
}

function ExitingCell({ cell }: { cell: Cell }) {
  const [shown, setShown] = useState(true)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(false))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <span
      className="inline-block"
      style={{ opacity: shown ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out` }}
    >
      {cell.char}
    </span>
  )
}

function DigitColumn({
  digit,
  delayMs,
  reducedMotion,
  revision,
}: {
  digit: number
  delayMs: number
  reducedMotion: boolean
  revision: number
}) {
  const stripRef = useRef<HTMLSpanElement>(null)
  const prevRevision = useRef(revision)
  // the digit this column is currently resting on, once any in-flight roll settles
  const restingDigit = useRef(digit)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // place the very first paint at rest, outside of any transition
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return
    el.style.transitionProperty = 'none'
    el.style.transform = `translateY(${-digit}em)`
    void el.offsetHeight
    el.style.transitionProperty = 'transform, filter'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const el = stripRef.current
    const shouldSpin = prevRevision.current !== revision && !reducedMotion
    prevRevision.current = revision
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    if (!el) return
    if (!shouldSpin) {
      if (restingDigit.current !== digit) {
        el.style.transitionProperty = 'none'
        el.style.transform = `translateY(${-digit}em)`
        void el.offsetHeight
        el.style.transitionProperty = 'transform, filter'
      }
      restingDigit.current = digit
      return
    }
    // land at least one full lap past the resting digit so every column visibly
    // sweeps 0-9, even when the target is the same or the next digit
    const from = restingDigit.current
    const offset = (digit - from + 10) % 10
    const target = from + 10 + offset
    // snap blur to its peak before the transition starts, then ease both the
    // roll and the blur back to sharp together so it never gets stuck hazy
    el.style.transitionProperty = 'none'
    el.style.filter = 'blur(1.5px)'
    void el.offsetHeight
    el.style.transitionProperty = 'transform, filter'
    el.style.transform = `translateY(${-target}em)`
    el.style.filter = 'blur(0px)'
    resetTimer.current = setTimeout(
      () => {
        const strip = stripRef.current
        restingDigit.current = digit
        if (!strip) return
        // rewind the extra laps silently so the strip never needs more than
        // three laps of rows, and the next roll has the same headroom again
        strip.style.transitionProperty = 'none'
        strip.style.transform = `translateY(${-digit}em)`
        void strip.offsetHeight
        strip.style.transitionProperty = 'transform, filter'
      },
      delayMs + ROLL_MS + 40
    )
  }, [revision, digit, reducedMotion, delayMs])

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  return (
    <span className="relative inline-block h-[1em] w-[1ch] overflow-hidden">
      <span
        ref={stripRef}
        className="absolute inset-x-0 top-0 flex flex-col"
        style={{
          transitionProperty: 'transform, filter',
          transitionDuration: reducedMotion ? '0ms' : `${ROLL_MS}ms`,
          transitionDelay: reducedMotion ? '0ms' : `${delayMs}ms`,
          transitionTimingFunction: 'var(--ease-out)',
        }}
      >
        {DIGITS_LOOP.map((d, i) => (
          <span key={i} className="h-[1em] text-center leading-[1em]">
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}
