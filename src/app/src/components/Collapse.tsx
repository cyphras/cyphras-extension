import { useEffect, useRef, useState, type ReactNode } from 'react'

const EXIT_MS = 300

// Height animation without measuring: a one-row grid animates between 0fr and
// 1fr, and the inner overflow-hidden wrapper clips the content as it grows.
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * Conditional content that grows into place instead of popping in, so nothing
 * around it jumps. It mounts closed, opens on the next frame, and keeps its
 * last content through the close. Inside a flex column, pass the parent's gap
 * in px: it is cancelled while closed, so the space animates too.
 */
export function Reveal({
  show,
  gap = 0,
  children,
}: {
  show: boolean
  gap?: number
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(show)
  const [open, setOpen] = useState(show)
  const last = useRef<ReactNode>(children)
  if (show) last.current = children

  useEffect(() => {
    if (show) {
      setMounted(true)
      // Double rAF: the first fires before the closed frame is painted.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpen(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setOpen(false)
    const t = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [show])

  if (!mounted) return null
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      style={{ marginTop: open ? 0 : -gap }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{show ? children : last.current}</div>
    </div>
  )
}
