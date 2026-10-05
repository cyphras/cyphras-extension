import { useState, useEffect, useRef } from 'react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { X, Send, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePreferences } from '@/context/PreferencesContext'
import type { ShieldedTokenRow } from '@/components/ShieldedTokenPicker'

function XlmIconLarge() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="76 34 238 238"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <circle cx="195.1" cy="153.1" r="118.9" fill="black" />
      <path
        fill="white"
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}

function AssetIconLarge({ icon, code }: { icon?: string; code: string }) {
  const [err, setErr] = useState(false)
  if (code === 'XLM') return <XlmIconLarge />
  if (icon && !err) {
    return (
      <img
        src={icon}
        alt={code}
        className="h-12 w-12 rounded-full object-cover shrink-0"
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

interface ShieldedTokenSheetProps {
  token: ShieldedTokenRow | null
  onSend: (poolId: string) => void
  onReceive: () => void
  onClose: () => void
}

// Tap-a-token shortcut sheet for the private list; Send pre-selects this pool.
export default function ShieldedTokenSheet({
  token,
  onSend,
  onReceive,
  onClose,
}: ShieldedTokenSheetProps) {
  const { formatValue, formatPrice } = usePreferences()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Keep the last non-null token so content stays visible during the close slide.
  const lastTokenRef = useRef<ShieldedTokenRow | null>(null)
  if (token) lastTokenRef.current = token
  const t = token ?? lastTokenRef.current

  const isOpen = token !== null

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {t && (
          <>
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <AssetIconLarge icon={t.icon} code={t.code} />
                <div className="flex flex-col">
                  <p className="flex items-center gap-1 text-lg font-bold text-foreground leading-tight">
                    {t.code}
                    <VerifiedBadge className="h-4 w-4" />
                  </p>
                  {t.usdPrice != null ? (
                    <p className="text-xs text-muted-foreground">{formatPrice(t.usdPrice)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">-</p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 pb-2">
              <div className="rounded-xl bg-card px-4 py-4 text-center">
                <p className="text-3xl font-bold text-foreground tabular-nums">
                  {t.balance} <span className="text-xl text-muted-foreground">{t.code}</span>
                </p>
                {t.usdValue !== null && (
                  <p className="mt-1 text-sm text-muted-foreground">{formatValue(t.usdValue)}</p>
                )}
                {t.detail && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t.detail}</p>
                )}
              </div>
            </div>

            <div className="shrink-0 flex gap-3 border-t border-border px-5 py-4">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  onClose()
                  onSend(t.poolId)
                }}
              >
                <Send size={14} />
                Send
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  onClose()
                  onReceive()
                }}
              >
                <QrCode size={14} />
                Receive
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
