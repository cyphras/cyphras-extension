import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { StellarAvatar } from '@/components/StellarAvatar'
import { useWallet } from '@/context/WalletContext'
import { ChevronLeft, Trash2, RotateCcw, AlertTriangle, Check, Eye, EyeOff } from 'lucide-react'

type View = 'confirm' | 'password'

export default function SettingsSecurityDeleteWallet() {
  const navigate = useNavigate()
  const { status, accounts, activePublicKey, switchAccount, removeAccount } = useWallet()
  const [view, setView] = useState<View>('confirm')
  const [acknowledged, setAcknowledged] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const activeKey = activePublicKey || status.publicKey || ''
  const shortKey = activeKey ? `${activeKey.slice(0, 4)}...${activeKey.slice(-4)}` : ''
  const isOnlyAccount = accounts.length <= 1

  async function handleDelete() {
    if (!activeKey || !password) return
    setLoading(true)
    setError('')
    const other = accounts.find((a) => a.publicKey !== activeKey)
    if (other) await switchAccount(other.publicKey)
    const result = await removeAccount(activeKey, password)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    navigate('/')
  }

  if (isOnlyAccount) {
    return (
      <Layout
        footer={
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/settings/security/reset-app')}
          >
            <RotateCcw size={15} />
            Go to Reset App
          </Button>
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
            <h2 className="text-lg font-bold text-foreground">Delete Wallet</h2>
          </div>

          <div className="rounded-xl bg-card px-4 py-5 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Trash2 size={22} className="text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">Only one wallet</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You only have one wallet. To remove all data and start over, use Reset App instead.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  if (view === 'password') {
    return (
      <Layout
        footer={
          <div className="flex flex-col gap-2">
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <Button
              variant="destructive"
              className="w-full"
              disabled={!password || loading}
              onClick={handleDelete}
            >
              {loading ? 'Deleting...' : 'Delete Wallet'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => {
                setView('confirm')
                setPassword('')
                setShowPassword(false)
                setError('')
              }}
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Delete Wallet</h2>
          </div>

          {activeKey && (
            <div className="rounded-xl bg-card divide-y divide-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-muted-foreground">Wallet</span>
                <div className="flex items-center gap-1.5">
                  <StellarAvatar publicKey={activeKey} size={14} />
                  <span className="text-xs font-mono text-foreground">{shortKey}</span>
                </div>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Enter your password to confirm this action.
          </p>

          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleDelete()}
              placeholder="Password"
              autoFocus
              className="w-full rounded-xl bg-card px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout
      footer={
        <Button
          variant="destructive"
          className="w-full"
          disabled={!acknowledged}
          onClick={() => setView('password')}
        >
          Continue
        </Button>
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
          <h2 className="text-lg font-bold text-foreground">Delete Wallet</h2>
        </div>

        {activeKey && (
          <div className="rounded-xl bg-card divide-y divide-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-muted-foreground">Wallet</span>
              <div className="flex items-center gap-1.5">
                <StellarAvatar publicKey={activeKey} size={14} />
                <span className="text-xs font-mono text-foreground">{shortKey}</span>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-destructive shrink-0" />
            <p className="text-xs font-semibold text-destructive">Warning</p>
          </div>
          <ul className="flex flex-col gap-1.5 text-xs text-destructive/90 pl-0.5">
            <li className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">-</span>This wallet will be removed from this device
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">-</span>Your funds are safe if you have your
              recovery phrase
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">-</span>This action cannot be undone
            </li>
          </ul>
        </div>

        <button
          onClick={() => setAcknowledged((p) => !p)}
          className="cursor-pointer flex items-start gap-3 rounded-xl border border-border px-4 py-3 text-left w-full transition-colors hover:bg-muted/40"
        >
          <div
            className={`mt-0.5 h-4 w-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${acknowledged ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}
          >
            {acknowledged && <Check size={10} className="text-primary-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            I have my recovery phrase backed up and understand this action cannot be undone
          </p>
        </button>
      </div>
    </Layout>
  )
}
