import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Megaphone, X, ChevronRight } from 'lucide-react'
import { Collapse } from '@/components/Collapse'
import { walletPageOf, type Announcement } from '@/lib/announcements'

const TONES: Record<Announcement['tone'], string> = {
  info: 'bg-sky-500/10',
  success: 'bg-emerald-600/15',
  warning: 'bg-amber-500/15',
}

const AUTO_ADVANCE_MS = 5000
const SLIDE_MS = 450
const SWIPE_PX = 40

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function CardBody({
  card,
  onDismiss,
  onOpenPage,
  swipedRef,
}: {
  card: Announcement
  onDismiss: () => void
  onOpenPage: (route: string) => void
  swipedRef: { current: boolean }
}) {
  const [iconFailed, setIconFailed] = useState(false)
  // A title-only card centers on its icon instead of hanging from the top.
  const align = card.body || card.linkUrl ? 'items-start' : 'items-center'

  const content = (
    <>
      {card.icon && !iconFailed ? (
        <img
          src={card.icon}
          alt=""
          draggable={false}
          onError={() => setIconFailed(true)}
          className="h-9 w-9 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/60 text-primary">
          <Megaphone size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{card.title}</span>
        {card.body && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{card.body}</span>
        )}
        {card.linkUrl && (
          <span className="mt-0.5 flex items-center gap-0.5 text-xs font-semibold text-primary">
            {card.linkLabel || 'Learn more'} <ChevronRight size={12} />
          </span>
        )}
      </span>
    </>
  )
  const inner = `flex min-w-0 flex-1 ${align} gap-3 text-left ${card.dismissible ? 'pr-6' : ''}`
  const walletPage = card.linkUrl ? walletPageOf(card.linkUrl) : null

  // Slides share the tallest card's height; centering keeps a shorter card
  // from leaving an empty band under its text.
  return (
    <div
      className={`relative flex h-full items-center gap-3 rounded-xl px-3.5 py-3 ${TONES[card.tone]}`}
    >
      {walletPage ? (
        <button
          type="button"
          onClick={() => {
            if (!swipedRef.current) onOpenPage(walletPage)
          }}
          className={`${inner} cursor-pointer`}
        >
          {content}
        </button>
      ) : card.linkUrl ? (
        <a
          href={card.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          // A swipe that ends on the card must not also open its link.
          onClick={(e) => {
            if (swipedRef.current) e.preventDefault()
          }}
          className={inner}
        >
          {content}
        </a>
      ) : (
        <div className={inner}>{content}</div>
      )}
      {card.dismissible && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss announcement"
          className="absolute right-2 top-2 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/**
 * Home-screen announcements from the admin panel. Several cards auto-rotate in a
 * forward loop, paused on hover or focus and never under reduced motion.
 */
export function AnnouncementCarousel({
  cards,
  onDismiss,
  onOpenPage,
}: {
  cards: Announcement[]
  onDismiss: (card: Announcement) => void
  onOpenPage: (route: string) => void
}) {
  const count = cards.length
  const [index, setIndex] = useState(0)
  const [animate, setAnimate] = useState(true)
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState(true)
  const swipeStart = useRef<number | null>(null)
  const swipedRef = useRef(false)

  // A dismissal shrinks the list under the current slide; stay in range.
  const current = count > 0 ? Math.min(index, count) : 0
  useEffect(() => {
    if (index > count) setIndex(0)
  }, [index, count])

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return
    const t = setInterval(() => {
      setAnimate(true)
      setIndex((i) => i + 1)
    }, AUTO_ADVANCE_MS)
    return () => clearInterval(t)
  }, [count, paused])

  // Landing on the clone of the first card: jump back to the real first card
  // without a transition, then turn transitions back on for the next move.
  useEffect(() => {
    if (count < 2 || current !== count) return
    const t = setTimeout(() => {
      setAnimate(false)
      setIndex(0)
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
    }, SLIDE_MS)
    return () => clearTimeout(t)
  }, [current, count])

  if (count === 0) return null

  const go = (i: number) => {
    setAnimate(true)
    setIndex(((i % count) + count) % count)
  }
  const shownIdx = current % count

  const dismiss = (card: Announcement) => {
    if (count === 1) {
      setOpen(false)
      setTimeout(() => onDismiss(card), 300)
      return
    }
    onDismiss(card)
  }

  const onPointerDown = (e: PointerEvent) => {
    swipeStart.current = e.clientX
    swipedRef.current = false
  }
  const onPointerUp = (e: PointerEvent) => {
    if (swipeStart.current === null || count < 2) return
    const dx = e.clientX - swipeStart.current
    swipeStart.current = null
    if (Math.abs(dx) < SWIPE_PX) return
    swipedRef.current = true
    go(dx < 0 ? shownIdx + 1 : shownIdx - 1)
  }

  const slides = count > 1 ? [...cards, cards[0]] : cards

  return (
    <Collapse open={open}>
      <div
        className="flex flex-col gap-1.5"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div
          className="touch-pan-y overflow-hidden rounded-xl"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          role="region"
          aria-roledescription="carousel"
          aria-label="Announcements"
        >
          <div
            className="flex"
            style={{
              transform: `translateX(-${current * 100}%)`,
              transition: animate ? `transform ${SLIDE_MS}ms var(--ease-out)` : 'none',
            }}
          >
            {slides.map((card, i) => (
              <div
                key={i === count ? `clone-${card.id}` : `${card.id}:${card.version}`}
                className="w-full shrink-0"
                aria-hidden={i % count !== shownIdx || i === count}
              >
                <CardBody
                  card={card}
                  onDismiss={() => dismiss(card)}
                  onOpenPage={onOpenPage}
                  swipedRef={swipedRef}
                />
              </div>
            ))}
          </div>
        </div>
        {count > 1 && (
          <div
            className="flex justify-center gap-1"
            role="tablist"
            aria-label="Choose announcement"
          >
            {cards.map((card, i) => (
              <button
                key={card.id}
                role="tab"
                aria-selected={i === shownIdx}
                aria-label={`Announcement ${i + 1} of ${count}`}
                onClick={() => go(i)}
                className={`h-1.5 cursor-pointer transition-all duration-300 ${
                  i === shownIdx
                    ? 'w-3 bg-foreground/60'
                    : 'w-1.5 bg-foreground/20 hover:bg-foreground/40'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </Collapse>
  )
}
