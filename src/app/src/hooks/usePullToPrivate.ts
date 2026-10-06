import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const COMMIT_DIST = 80
const SWIPE_PX = 120
const PEEK = 24

type Pt = [number, number]
type Vert = { p: Pt; corner: boolean }

const CARD_R = 14
const ARC_C1 = 0.8660254
const ARC_S1 = 0.5
const ARC_C2 = 0.5
const ARC_S2 = 0.8660254

// Round real card corners; crease crossings stay sharp.
function roundVerts(verts: Vert[]): Pt[] {
  const vs: Vert[] = []
  for (const cur of verts) {
    const prev = vs[vs.length - 1]
    if (prev && Math.hypot(cur.p[0] - prev.p[0], cur.p[1] - prev.p[1]) < 0.5) {
      if (!prev.corner && cur.corner) vs[vs.length - 1] = cur
      continue
    }
    vs.push(cur)
  }
  if (vs.length > 1) {
    const a = vs[0].p
    const b = vs[vs.length - 1].p
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) vs.pop()
  }
  const n = vs.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const cur = vs[i]
    if (!cur.corner) {
      out.push(cur.p)
      continue
    }
    const V = cur.p
    const prev = vs[(i - 1 + n) % n]
    const next = vs[(i + 1) % n]
    const upx = prev.p[0] - V[0]
    const upy = prev.p[1] - V[1]
    const unx = next.p[0] - V[0]
    const uny = next.p[1] - V[1]
    const lp = Math.hypot(upx, upy)
    const ln = Math.hypot(unx, uny)
    // Halve the reach so adjacent fillets do not overlap.
    const t = Math.min(CARD_R, prev.corner ? lp * 0.5 : lp, next.corner ? ln * 0.5 : ln)
    if (t < 0.5) {
      out.push(V)
      continue
    }
    const ux = upx / lp
    const uy = upy / lp
    const nx = unx / ln
    const ny = uny / ln
    const cx = V[0] + ux * t + nx * t
    const cy = V[1] + uy * t + ny * t
    out.push([V[0] + ux * t, V[1] + uy * t])
    out.push([cx + t * (ARC_C1 * -nx + ARC_S1 * -ux), cy + t * (ARC_C1 * -ny + ARC_S1 * -uy)])
    out.push([cx + t * (ARC_C2 * -nx + ARC_S2 * -ux), cy + t * (ARC_C2 * -ny + ARC_S2 * -uy)])
    out.push([V[0] + nx * t, V[1] + ny * t])
  }
  return out
}

function toPoly(pts: Pt[], offX: number, offY: number): string {
  return (
    'polygon(' +
    pts.map((p) => `${(p[0] + offX).toFixed(1)}px ${(p[1] + offY).toFixed(1)}px`).join(',') +
    ')'
  )
}

// Page-curl fold: far side is the kept card, reflected near side is the flap.
function buildPeel(
  W: number,
  H: number,
  dx: number,
  dy: number,
  flapOffX: number,
  flapOffY: number
): { card: string; flap: string; angle: number } | null {
  const mag = Math.hypot(dx, dy)
  if (mag < 2) return null
  const coneMid = 1.5 * Math.PI - Math.atan2(W, H)
  const coneHalf = 1.4
  let diff = Math.atan2(dy, dx) - coneMid
  if (diff > Math.PI) diff -= 2 * Math.PI
  else if (diff < -Math.PI) diff += 2 * Math.PI
  if (diff > coneHalf) diff = coneHalf
  else if (diff < -coneHalf) diff = -coneHalf
  const ang = coneMid + diff
  dx = Math.cos(ang) * mag
  dy = Math.sin(ang) * mag
  const d2 = dx * dx + dy * dy
  if (d2 < 4) return null
  const K = W * dx + H * dy + d2 / 2
  const rect: Pt[] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ]
  const f = (p: Pt) => p[0] * dx + p[1] * dy - K
  const cross = (a: Pt, b: Pt): Pt => {
    const fa = f(a)
    const t = fa / (fa - f(b))
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  }
  const clip = (keepFar: boolean): Vert[] => {
    const out: Vert[] = []
    for (let i = 0; i < 4; i++) {
      const a = rect[i]
      const b = rect[(i + 1) % 4]
      const ia = keepFar ? f(a) >= 0 : f(a) < 0
      const ib = keepFar ? f(b) >= 0 : f(b) < 0
      if (ia) out.push({ p: a, corner: true })
      if (ia !== ib) out.push({ p: cross(a, b), corner: false })
    }
    return out
  }
  const folded = clip(false)
  if (folded.length < 3) return null
  const reflect = (p: Pt): Pt => {
    const t = f(p) / d2
    return [p[0] - 2 * t * dx, p[1] - 2 * t * dy]
  }
  const kept = clip(true)
  // Whole card folded past the crease: front clips to nothing.
  const card =
    kept.length >= 3 ? toPoly(roundVerts(kept), 0, 0) : 'polygon(0px 0px,0px 0px,0px 0px)'
  const flap = folded.map((v): Vert => ({ p: reflect(v.p), corner: v.corner }))
  // Gradient angle along the fold for the flap shading.
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI
  return { card, flap: toPoly(roundVerts(flap), flapOffX, flapOffY), angle }
}

// Same arc as the peeled card so the corners match.
function buildUnderClip(W: number, H: number): string {
  return toPoly(
    roundVerts([
      { p: [0, 0], corner: true },
      { p: [W, 0], corner: true },
      { p: [W, H], corner: true },
      { p: [0, H], corner: true },
    ]),
    0,
    0
  )
}

export function usePullToPrivate() {
  const [active, setActive] = useState(false)
  // Card text/amount swap at the crossfade midpoint.
  const [showPrivate, setShowPrivate] = useState(false)
  const peelStart = useRef<{ x: number; y: number } | null>(null)
  const swipeStart = useRef<number | null>(null)
  const cardSize = useRef({ w: 1, h: 1, x: 0, y: 0 })
  const dragDist = useRef(0)
  const progressRef = useRef(0)
  const wrapEl = useRef<HTMLElement | null>(null)
  const scrollEl = useRef<Element | null>(null)
  const cardEl = useRef<HTMLElement | null>(null)
  const flapEl = useRef<HTMLElement | null>(null)
  const underEl = useRef<HTMLElement | null>(null)
  const peelVec = useRef({ dx: 0, dy: 0 })
  const dragBase = useRef({ dx: 0, dy: 0 })
  const animRef = useRef<number | null>(null)
  // Deferred private-shifting removal on exit; a new peel cancels it.
  const shiftTimer = useRef<number | null>(null)
  // Marks a commit in progress across the async setActive.
  const committingRef = useRef(false)

  const cancelShiftTimer = () => {
    if (shiftTimer.current !== null) {
      clearTimeout(shiftTimer.current)
      shiftTimer.current = null
    }
  }

  useEffect(() => {
    // Re-apply on scroll so the fixed flap tracks the card.
    const onScroll = () => {
      const { dx, dy } = peelVec.current
      if (dx !== 0 || dy !== 0) applyPeel(dx, dy)
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      const root = document.documentElement
      root.classList.remove(
        'private-shifting',
        'private-dragging',
        'private-active',
        'force-dark',
        'force-light'
      )
      root.style.removeProperty('--ghost-progress')
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
      cancelShiftTimer()
      committingRef.current = false
      cardEl.current?.style.removeProperty('clip-path')
      flapEl.current?.style.removeProperty('clip-path')
      underEl.current?.style.removeProperty('clip-path')
    }
  }, [])

  // Committed private CSS is derived from active.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (active) {
      cancelShiftTimer()
      root.classList.add('private-shifting', 'private-active')
      setGhost(1)
      committingRef.current = false
    } else {
      root.classList.remove('private-active')
      setGhost(0)
      cancelShiftTimer()
      // Drop private-shifting after the crossfade.
      shiftTimer.current = window.setTimeout(() => {
        shiftTimer.current = null
        if (!committingRef.current && progressRef.current === 0 && !peelStart.current) {
          root.classList.remove('private-shifting')
        }
      }, 340)
    }
    return () => cancelShiftTimer()
  }, [active])

  const cacheEls = () => {
    wrapEl.current = document.querySelector('.peel-wrap')
    cardEl.current = document.querySelector('.peel-card')
    flapEl.current = document.querySelector('.peel-flap')
    underEl.current = document.querySelector('.peel-under')
    scrollEl.current = wrapEl.current?.closest('.overflow-y-auto') ?? null
  }

  // Match the revealed card's corners to the peeled card's arc.
  const armUnder = () => {
    if (underEl.current) {
      underEl.current.style.clipPath = buildUnderClip(cardSize.current.w, cardSize.current.h)
    }
  }

  const dims = () => {
    const rect = document.querySelector('.peel-wrap')?.getBoundingClientRect()
    return { w: rect?.width ?? 1, h: rect?.height ?? 1, x: rect?.left ?? 0, y: rect?.top ?? 0 }
  }

  const applyPeel = (dx: number, dy: number) => {
    const { w, h } = cardSize.current
    // Offset the fixed flap to the card's live viewport position.
    const rect = wrapEl.current?.getBoundingClientRect()
    const x = rect?.left ?? cardSize.current.x
    const y = rect?.top ?? cardSize.current.y
    // Box the flap to the scroll viewport once the card scrolls under the header.
    const scrollTop = scrollEl.current?.getBoundingClientRect().top ?? 0
    const underHeader = y < scrollTop
    const flapTop = underHeader ? scrollTop : 0
    const r = buildPeel(w, h, dx, dy, x, underHeader ? y - scrollTop : y)
    if (!cardEl.current || !flapEl.current) return
    if (!r) {
      clearPeel()
      return
    }
    flapEl.current.style.top = `${flapTop}px`
    cardEl.current.style.clipPath = r.card
    flapEl.current.style.clipPath = r.flap
    flapEl.current.style.setProperty('--flap-angle', `${r.angle.toFixed(1)}deg`)
  }

  const clearPeel = () => {
    peelVec.current = { dx: 0, dy: 0 }
    cardEl.current?.style.removeProperty('clip-path')
    flapEl.current?.style.removeProperty('clip-path')
  }

  const setPeelVec = (dx: number, dy: number) => {
    peelVec.current = { dx, dy }
    applyPeel(dx, dy)
  }

  // Ease the peel vector to a target.
  const animateTo = (tx: number, ty: number, done?: () => void) => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    const sx = peelVec.current.dx
    const sy = peelVec.current.dy
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / 160)
      const e = 1 - (1 - t) ** 3
      setPeelVec(sx + (tx - sx) * e, sy + (ty - sy) * e)
      if (t < 1) {
        animRef.current = requestAnimationFrame(step)
      } else {
        animRef.current = null
        done?.()
      }
    }
    animRef.current = requestAnimationFrame(step)
  }

  // Commit: fling the fold off, fade the flap, then drop the clip.
  const commitPeel = () => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    const sx = peelVec.current.dx
    const sy = peelVec.current.dy
    const m = Math.hypot(sx, sy) || 1
    const tx = (sx / m) * 700
    const ty = (sy / m) * 700
    const flap = flapEl.current
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / 300)
      const e = 1 - (1 - t) ** 3
      setPeelVec(sx + (tx - sx) * e, sy + (ty - sy) * e)
      if (flap) flap.style.opacity = String(1 - e)
      if (t < 1) {
        animRef.current = requestAnimationFrame(step)
      } else {
        animRef.current = null
        if (flap) flap.style.removeProperty('opacity')
        clearPeel()
      }
    }
    animRef.current = requestAnimationFrame(step)
  }

  const setGhost = (p: number) => {
    progressRef.current = p
    document.documentElement.style.setProperty('--ghost-progress', String(p))
    setShowPrivate(p >= 0.5)
    // Past the midpoint, flip dark: variants via force classes.
    const root = document.documentElement
    if (p >= 0.5) {
      const userDark = root.classList.contains('dark')
      root.classList.toggle('force-dark', !userDark)
      root.classList.toggle('force-light', userDark)
    } else {
      root.classList.remove('force-dark', 'force-light')
    }
  }

  const enter = useCallback(() => {
    // Assert the committed palette synchronously for a zero-flash commit.
    committingRef.current = true
    cancelShiftTimer()
    document.documentElement.classList.add('private-shifting', 'private-active')
    setGhost(1)
    setActive(true)
    commitPeel()
  }, [])

  const exit = useCallback(() => {
    committingRef.current = false
    setActive(false)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Cancel a pending private-shifting removal before re-peeling.
      cancelShiftTimer()
      if (active || committingRef.current) return
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
      peelStart.current = { x: e.clientX, y: e.clientY }
      // Continue from the current peek vector.
      dragBase.current = { ...peelVec.current }
      dragDist.current = 0
      cacheEls()
      cardSize.current = dims()
      armUnder()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      document.documentElement.classList.add('private-shifting', 'private-dragging')
    },
    [active]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!peelStart.current) return
    const ddx = e.clientX - peelStart.current.x
    const ddy = e.clientY - peelStart.current.y
    const dx = dragBase.current.dx + ddx
    const dy = dragBase.current.dy + ddy
    // Commit threshold uses the finger's travel, not the peek-offset vector.
    dragDist.current = Math.hypot(ddx, ddy)
    setPeelVec(dx, dy)
  }, [])

  const onPointerUp = useCallback(() => {
    if (!peelStart.current) return
    peelStart.current = null
    document.documentElement.classList.remove('private-dragging')
    if (dragDist.current >= COMMIT_DIST) enter()
    else {
      animateTo(0, 0, () => {
        if (!committingRef.current && progressRef.current === 0 && !peelStart.current) {
          document.documentElement.classList.remove('private-shifting')
        }
      })
    }
  }, [enter])

  // Hover peek; private leaves via swipe.
  const onPeekEnter = useCallback(() => {
    if (active || committingRef.current || peelStart.current) return
    cancelShiftTimer()
    cacheEls()
    cardSize.current = dims()
    armUnder()
    // Arm the private palette for the peek reveal.
    document.documentElement.classList.add('private-shifting')
    animateTo(-PEEK, -PEEK)
  }, [active])

  const onPeekLeave = useCallback(() => {
    if (active || committingRef.current || peelStart.current) return
    animateTo(0, 0, () => {
      if (!committingRef.current && progressRef.current === 0 && !peelStart.current) {
        document.documentElement.classList.remove('private-shifting')
      }
    })
  }, [active])

  const onSwipeDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return
      swipeStart.current = e.clientY
      e.currentTarget.setPointerCapture?.(e.pointerId)
      document.documentElement.classList.add('private-dragging')
    },
    [active]
  )

  const onSwipeMove = useCallback(
    (e: React.PointerEvent) => {
      if (swipeStart.current === null) return
      const up = Math.max(0, swipeStart.current - e.clientY)
      const d = Math.min(1, up / SWIPE_PX)
      if (d >= 0.6) {
        swipeStart.current = null
        document.documentElement.classList.remove('private-dragging')
        exit()
        return
      }
      setGhost(Math.max(0, 1 - d / 0.6))
    },
    [exit]
  )

  const onSwipeUp = useCallback(() => {
    if (swipeStart.current === null) return
    swipeStart.current = null
    document.documentElement.classList.remove('private-dragging')
    if (progressRef.current <= 0.5) exit()
    else setGhost(1)
  }, [exit])

  return {
    active,
    showPrivate,
    exit,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    peek: { onMouseEnter: onPeekEnter, onMouseLeave: onPeekLeave },
    swipe: { onPointerDown: onSwipeDown, onPointerMove: onSwipeMove, onPointerUp: onSwipeUp },
  }
}
