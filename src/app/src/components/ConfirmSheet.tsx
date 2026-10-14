import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// The sheet a payment is confirmed in and shows its result in: the step's title with any extra
// buttons beside the close button, and a body that slides in afresh at each step. The body brings
// its own scrolling area and footer.
export function ConfirmSheet({
  open,
  title,
  actions,
  closeDisabled = false,
  modal = false,
  stepKey,
  onClose,
  onBackdrop,
  children,
}: {
  open: boolean
  title: ReactNode
  actions?: ReactNode
  closeDisabled?: boolean
  // Over the whole app, which goes inert while it is open, so focus can reach nothing behind it.
  modal?: boolean
  stepKey: string
  onClose: () => void
  onBackdrop: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!modal || !open) return
    const app = document.getElementById('root')
    const panel = panelRef.current
    app?.setAttribute('inert', '')
    panel?.focus()
    const keepFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.matches(':disabled')
      )
      const first = items.at(0)
      const last = items.at(-1)
      const at = document.activeElement
      if (!first || !last) {
        e.preventDefault()
      } else if (!panel.contains(at) || (e.shiftKey ? at === first || at === panel : at === last)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', keepFocus)
    return () => {
      document.removeEventListener('keydown', keepFocus)
      app?.removeAttribute('inert')
    }
  }, [modal, open])

  // A closed sheet stays mounted for its slide, but none of its buttons may take focus.
  const sheet = (
    <div
      inert={!open}
      className={`fixed inset-0 z-[70] transition-all duration-300 ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onBackdrop}
      />
      <div
        ref={panelRef}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal || undefined}
        aria-labelledby={modal ? titleId : undefined}
        tabIndex={modal ? -1 : undefined}
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] outline-none transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </p>
          <div className="flex items-center gap-1">
            {actions}
            <button
              onClick={onClose}
              disabled={closeDisabled}
              aria-label="Close"
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          key={stepKey}
          className="flex flex-1 flex-col min-h-0 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          {children}
        </div>
      </div>
    </div>
  )
  return modal ? createPortal(sheet, document.body) : sheet
}
