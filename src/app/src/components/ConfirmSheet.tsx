import type { ReactNode } from 'react'
import { X } from 'lucide-react'

// The sheet a payment is confirmed in and shows its result in: the step's title with any extra
// buttons beside the close button, and a body that slides in afresh at each step. The body brings
// its own scrolling area and footer.
export function ConfirmSheet({
  open,
  title,
  actions,
  closeDisabled = false,
  stepKey,
  onClose,
  onBackdrop,
  children,
}: {
  open: boolean
  title: ReactNode
  actions?: ReactNode
  closeDisabled?: boolean
  stepKey: string
  onClose: () => void
  onBackdrop: () => void
  children: ReactNode
}) {
  return (
    <div
      className={`fixed inset-0 z-[70] transition-all duration-300 ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onBackdrop}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
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
}
