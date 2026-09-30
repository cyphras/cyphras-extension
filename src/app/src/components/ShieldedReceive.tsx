import { useState, useEffect, useRef } from 'react'
import { Copy, Check, X } from 'lucide-react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { useWallet } from '@/context/WalletContext'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse } from '@ext-types/index'

interface ShieldedReceiveProps {
  open: boolean
  onClose: () => void
}

// Shielded cy1 receive address plus QR; spend keys never leave the background.
export default function ShieldedReceive({ open, onClose }: ShieldedReceiveProps) {
  const { activePublicKey } = useWallet()
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Drops a slow address response from a prior account so it cannot paint after a switch.
  const runIdRef = useRef(0)

  // Re-derives the cy1 on account change, clearing the stale one first so it never shows for the wrong account.
  useEffect(() => {
    if (!open) return
    const runId = ++runIdRef.current
    setError(null)
    setAddress(null)
    setQrDataUrl(null)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_RECEIVE_ADDRESS },
      (r: ServiceResponse) => {
        if (runId !== runIdRef.current) return
        if (chrome.runtime.lastError) {
          setError('Extension error')
          return
        }
        if (r?.error) {
          setError(r.error)
          return
        }
        if (r?.shieldedAddress) setAddress(r.shieldedAddress)
      }
    )
  }, [open, activePublicKey])

  useEffect(() => {
    if (!address) return
    QRCode.toDataURL(address, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [address])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  function handleCopy() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const short = address ? `${address.slice(0, 10)}...${address.slice(-8)}` : ''

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <p className="text-lg font-bold text-foreground">Private receive</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-5">
          {error ? (
            <p className="text-sm text-destructive text-center py-6">{error}</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl overflow-hidden bg-white p-3">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR Code" width={200} height={200} className="block" />
                ) : (
                  <div className="h-[200px] w-[200px] animate-pulse bg-muted" />
                )}
              </div>

              <div className="flex flex-col items-center gap-2 w-full">
                <p className="text-xs text-muted-foreground">Your private address</p>
                <button
                  onClick={handleCopy}
                  aria-label="Copy private address"
                  className="cursor-pointer rounded-lg px-2 py-1 hover:bg-muted transition-colors w-full"
                >
                  <span className="font-mono text-xs text-foreground break-all text-center leading-relaxed block">
                    {short}
                  </span>
                </button>
              </div>

              <Button className="w-full" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check size={14} /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy address
                  </>
                )}
              </Button>

              <div className="rounded-xl bg-muted px-4 py-3 w-full">
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Share this private address to receive XLM or USDC. Senders and amounts stay
                  hidden on-chain.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Private address copied to clipboard' : ''}
      </span>
    </>
  )
}
