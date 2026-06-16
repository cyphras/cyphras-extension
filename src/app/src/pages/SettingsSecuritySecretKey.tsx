import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'

export default function SettingsSecuritySecretKey() {
  const navigate = useNavigate()
  const { getSecretKey, activePublicKey, status } = useWallet()
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  // Re-mask on focus loss and wipe entirely when the wallet is hidden (e.g. a side panel left open),
  // so the secret key is never left exposed on an unattended screen.
  useEffect(() => {
    if (!secretKey) return
    const remask = () => setShowKey(false)
    const onHidden = () => {
      if (document.hidden) {
        setSecretKey(null)
        setShowKey(false)
        setPassword('')
      }
    }
    window.addEventListener('blur', remask)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', remask)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [secretKey])

  const publicKey = activePublicKey || status.publicKey || ''

  function handleReveal() {
    setError(null)
    if (!password) {
      setError('Enter your password to continue')
      return
    }
    setLoading(true)
    getSecretKey(publicKey, password).then((result) => {
      setLoading(false)
      if ('error' in result) {
        setError(result.error)
      } else {
        setSecretKey(result.secretKey)
        setPassword('')
      }
    })
  }

  function handleCopy() {
    if (!secretKey) return
    navigator.clipboard.writeText(secretKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleHide() {
    setSecretKey(null)
    setShowKey(false)
    setCopied(false)
  }

  return (
    <Layout
      footer={
        !secretKey ? (
          <div className="flex flex-col gap-2">
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleReveal}
              disabled={loading}
            >
              {loading ? 'Verifying...' : 'Reveal Secret Key'}
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={handleHide}>
            Hide
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Secret Key</h2>
        </div>

        {!secretKey ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground px-1">
              Enter your password to reveal your secret key. Never share it with anyone.
            </p>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReveal()}
                className="w-full rounded-xl bg-card px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground px-1">
              Keep this key secret and backed up somewhere safe.
            </p>

            <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Secret Key</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              <p className="text-xs font-mono text-foreground break-all leading-relaxed">
                {showKey ? secretKey : '*'.repeat(secretKey.length)}
              </p>
            </div>

            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
              <p className="text-xs text-destructive leading-relaxed">
                Never share your secret key with anyone. Anyone with this key has full control of your
                funds. Copying places it in your clipboard - clear it after use.
              </p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
