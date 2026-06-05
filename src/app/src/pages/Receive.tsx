import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { Copy, Check, ChevronLeft } from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'

export default function Receive() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!status.publicKey) return

    QRCode.toDataURL(status.publicKey, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [status.publicKey])

  function handleCopy() {
    if (!status.publicKey) return
    navigator.clipboard.writeText(status.publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Layout navbar={<WalletNavbar />}>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Receive</h2>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl bg-card p-5 flex flex-col items-center gap-4 w-full">
            {qrDataUrl ? (
              <div className="rounded-xl overflow-hidden bg-white p-3">
                <img src={qrDataUrl} alt="QR Code" width={200} height={200} className="block" />
              </div>
            ) : (
              <div className="h-[224px] w-[224px] rounded-xl bg-muted animate-pulse" />
            )}

            <div className="flex flex-col items-center gap-2 w-full">
              <p className="text-xs text-muted-foreground">Your Stellar address</p>
              <p className="font-mono text-xs text-foreground break-all text-center leading-relaxed px-2">
                {status.publicKey}
              </p>
            </div>
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
              Only send Stellar assets to this address. Sending other assets may result in permanent
              loss.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  )
}
