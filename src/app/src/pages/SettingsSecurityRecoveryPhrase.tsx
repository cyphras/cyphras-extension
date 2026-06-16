import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'

export default function SettingsSecurityRecoveryPhrase() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  // Re-hide on focus loss and wipe entirely when the wallet is hidden (e.g. a side panel left open),
  // so the seed is never left exposed on an unattended screen.
  useEffect(() => {
    if (!phrase) return
    const reblur = () => setRevealed(false)
    const onHidden = () => {
      if (document.hidden) {
        setPhrase(null)
        setRevealed(false)
        setPassword('')
      }
    }
    window.addEventListener('blur', reblur)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', reblur)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [phrase])

  function handleReveal() {
    setError(null)
    if (!password) {
      setError('Enter your password to continue')
      return
    }
    setLoading(true)
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_RECOVERY_PHRASE, password }, (res) => {
      if (chrome.runtime.lastError) {
        setLoading(false)
        return
      }
      setLoading(false)
      if (res?.error) {
        setError(res.error)
      } else {
        setPhrase(res.mnemonic)
        setPassword('')
      }
    })
  }

  function handleHide() {
    setPhrase(null)
    setRevealed(false)
  }

  return (
    <Layout
      footer={
        !phrase ? (
          <div className="flex flex-col gap-2">
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleReveal}
              disabled={loading}
            >
              {loading ? 'Verifying...' : 'Reveal Recovery Phrase'}
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
          <h2 className="text-lg font-bold text-foreground">Recovery Phrase</h2>
        </div>

        {!phrase ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground px-1">
              Enter your password to reveal your recovery phrase. Never share it with anyone.
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
              Write these words down in order and store them somewhere safe. They also restore your
              pending private payments on a new device.
            </p>
            <div className="relative rounded-xl bg-muted p-4">
              <div
                className={`grid grid-cols-3 gap-2 ${!revealed ? 'blur-sm select-none pointer-events-none' : ''}`}
              >
                {phrase.split(' ').map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg bg-background px-2 py-1.5"
                  >
                    <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">
                      {i + 1}.
                    </span>
                    <span className="text-sm font-medium text-foreground">{word}</span>
                  </div>
                ))}
              </div>
              {!revealed && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                  <button
                    onClick={() => setRevealed(true)}
                    className="cursor-pointer flex items-center gap-2 rounded-xl bg-background border border-border px-4 py-2.5 text-sm font-medium text-foreground shadow hover:bg-muted transition-colors"
                  >
                    <Eye size={15} />
                    Reveal phrase
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-3">
              <EyeOff size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Never share your recovery phrase with anyone. Cyphras will never ask for it.
              </p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
