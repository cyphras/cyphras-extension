import { useEffect, useRef, useState, type ReactNode } from 'react'
import WalletNavbar from '@/components/WalletNavbar'
import { useAppContext } from '@/hooks/useAppContext'

// A private-mode page over Home: Home's backdrop behind it, Home's navbar standing still above it,
// and the page sliding in from the right. In a tab it keeps to Home's column. It mounts on its
// first opening and stays, so its content shows while it slides away.
export function PrivatePage({
  open,
  onHistory,
  navbarDisabled = false,
  children,
}: {
  open: boolean
  onHistory: () => void
  // While a payment is being proved or submitted, the navbar must not take the user elsewhere.
  navbarDisabled?: boolean
  children: ReactNode
}) {
  const tab = useAppContext() === 'tab'
  const opened = useRef(open)
  if (open) opened.current = true

  // The slide-in needs a painted closed frame to start from (double rAF).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [open])

  if (!opened.current) return null
  const fade = `transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`
  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${open ? '' : 'pointer-events-none'}`}>
      <div
        aria-hidden
        className={`private-backdrop absolute inset-0 -z-10 bg-background ${fade}`}
      />
      <div className={`shrink-0 ${fade} ${navbarDisabled ? 'pointer-events-none' : ''}`}>
        <div
          className={`border-b border-border/40 bg-background pt-5 pb-3 ${tab ? 'mx-auto w-full max-w-md px-6' : 'px-5'}`}
        >
          <WalletNavbar onHistory={onHistory} />
        </div>
      </div>
      {/* No transform once settled, so the backdrop's fixed slices behind sticky headers line up. */}
      <div
        className={`flex min-h-0 flex-1 flex-col transition-transform duration-300 ease-out ${shown ? '' : 'translate-x-full'}`}
      >
        <div className={`flex min-h-0 flex-1 flex-col ${tab ? 'mx-auto w-full max-w-md' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
