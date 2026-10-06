import { useEffect, useRef, useState, type ReactNode } from 'react'

const EXIT_MS = 300
import { X } from 'lucide-react'

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  zIndex = 'z-[70]',
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children?: ReactNode
  zIndex?: string
}) {
  // Enter waits a double rAF (the first fires before the initial paint) so the
  // slide has a closed frame to start from. Exit keeps rendering the last open
  // content, since callers usually clear its state as they close.
  const [shown, setShown] = useState(false)
  const [mounted, setMounted] = useState(open)
  const lastContent = useRef<{ title: ReactNode; children: ReactNode }>({ title, children })
  if (open) lastContent.current = { title, children }

  useEffect(() => {
    if (open) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open])

  if (!mounted) return null
  const { title: shownTitle, children: shownChildren } = open
    ? { title, children }
    : lastContent.current
  return (
    <div className={`fixed inset-0 ${zIndex} flex flex-col ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out ${shown ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex shrink-0 justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex shrink-0 items-center justify-between px-5 py-3">
          <div className="min-w-0 flex-1 text-sm font-semibold text-foreground">{shownTitle}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">{shownChildren}</div>
      </div>
    </div>
  )
}
