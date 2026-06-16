import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Clock,
  BarChart2,
  KeyRound,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'

const ANALYTICS_OPT_OUT_KEY = 'cyphras_analytics_opt_out'

const AUTO_LOCK_OPTIONS = [
  { label: 'Immediately', seconds: 0 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 5 * 60 },
  { label: '10 minutes', seconds: 10 * 60 },
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '30 minutes', seconds: 30 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '4 hours', seconds: 4 * 60 * 60 },
  { label: '8 hours', seconds: 8 * 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`cursor-pointer relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${checked ? 'bg-primary' : 'bg-muted-foreground/40'}`}
    >
      <span
        className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

export default function SettingsSecurity() {
  const navigate = useNavigate()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true)
  const [autoLockLabel, setAutoLockLabel] = useState('15 minutes')

  useEffect(() => {
    chrome.storage.local.get(ANALYTICS_OPT_OUT_KEY, (res) => {
      setAnalyticsEnabled(res[ANALYTICS_OPT_OUT_KEY] !== true)
    })
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_AUTO_LOCK_TIMEOUT }, (res) => {
      if (chrome.runtime.lastError) return
      if (res?.timeoutSeconds !== undefined) {
        const match = AUTO_LOCK_OPTIONS.find((o) => o.seconds === res.timeoutSeconds)
        setAutoLockLabel(match?.label ?? '15 minutes')
      }
    })
  }, [])

  function handleToggleAnalytics() {
    const next = !analyticsEnabled
    setAnalyticsEnabled(next)
    chrome.storage.local.set({ [ANALYTICS_OPT_OUT_KEY]: !next })
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Security & Privacy</h2>
        </div>

        {/* Group 1 - Security */}
        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <button
            onClick={() => navigate('/settings/security/auto-lock')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Clock size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Auto-lock</p>
            <span className="text-xs text-muted-foreground mr-2">{autoLockLabel}</span>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/security/change-password')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Lock size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Change Password</p>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/security/recovery-phrase')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <KeyRound size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Show Recovery Phrase</p>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/security/secret-key')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <KeyRound size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Show Secret Key</p>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>
        </div>

        {/* Group 2 - Privacy */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
            <div className="flex w-full items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
                <BarChart2 size={16} className="text-primary" />
              </div>
              <p className="flex-1 text-sm font-medium text-foreground">Anonymous Analytics</p>
              <Toggle checked={analyticsEnabled} onChange={handleToggleAnalytics} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground px-1 leading-relaxed">
            Cyphras does not collect or store personal data. Analytics are anonymous and only used
            to improve the app.
          </p>
        </div>

        {/* Group 3 - Danger */}
        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <button
            onClick={() => navigate('/settings/security/delete-wallet')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 flex-shrink-0">
              <Trash2 size={16} className="text-destructive" />
            </div>
            <p className="flex-1 text-sm font-medium text-destructive">Delete Wallet</p>
            <ChevronRight size={16} className="text-destructive/50 flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/security/reset-app')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 flex-shrink-0">
              <RotateCcw size={16} className="text-destructive" />
            </div>
            <p className="flex-1 text-sm font-medium text-destructive">Reset App</p>
            <ChevronRight size={16} className="text-destructive/50 flex-shrink-0" />
          </button>
        </div>
      </div>
    </Layout>
  )
}
