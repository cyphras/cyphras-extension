import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { PasswordInput } from '@/components/PasswordInput'
import { PASSWORD_RULES } from '@constants/services'
import { AlertTriangle, RotateCcw, ChevronLeft, ArrowDownToLine, Plus, Check, Lock } from 'lucide-react'

type View = 'unlock' | 'reset-prompt' | 'reset-confirm' | 'overwrite-confirm'
type PendingRoute = 'import' | 'create'

function CyphrasLogo({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1620 1620"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: '22%' }}
    >
      <path
        d="M0 405C0 181.325 181.325 0 405 0H1215C1438.68 0 1620 181.325 1620 405V1215C1620 1438.68 1438.68 1620 1215 1620H405C181.325 1620 0 1438.68 0 1215V405Z"
        fill="#009FE1"
      />
      <path
        d="M713.184 848.184C692.095 827.095 692.095 792.905 713.184 771.816L771.816 713.184C792.905 692.095 827.095 692.095 848.184 713.184L906.816 771.816C927.905 792.905 927.905 827.095 906.816 848.184L848.184 906.816C827.095 927.905 792.905 927.905 771.816 906.816L713.184 848.184Z"
        fill="white"
      />
      <path
        d="M810 270C1077.57 270 1299.68 464.606 1342.53 720H1064.64C1027.57 615.133 927.56 540 810 540C660.883 540 540 660.883 540 810C540 959.117 660.883 1080 810 1080C927.56 1080 1027.57 1004.87 1064.64 900H1342.53C1299.68 1155.39 1077.57 1350 810 1350C511.766 1350 270 1108.23 270 810C270 511.766 511.766 270 810 270Z"
        fill="white"
      />
    </svg>
  )
}

export default function Unlock() {
  const { unlockWallet, resetWallet, status } = useWallet()
  const [view, setView] = useState<View>('unlock')
  const [password, setPassword] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [resetAcknowledged, setResetAcknowledged] = useState(false)
  const [overwriteAcknowledged, setOverwriteAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [pendingRoute, setPendingRoute] = useState<PendingRoute>('import')
  const [now, setNow] = useState(Date.now())
  const wasLockedRef = useRef(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const isLocked = status.lockedUntil ? now < status.lockedUntil : false
  const secondsLeft = isLocked ? Math.ceil(((status.lockedUntil ?? 0) - now) / 1000) : 0
  const timeDisplay = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
  const attemptsLeft = PASSWORD_RULES.MAX_ATTEMPTS - (status.failedAttempts ?? 0)

  useEffect(() => {
    if (wasLockedRef.current && !isLocked) {
      setError('')
      setPassword('')
    }
    wasLockedRef.current = isLocked
  }, [isLocked])

  async function handleUnlock() {
    if (!password || isLocked) return
    setError('')
    setLoading(true)
    const result = await unlockWallet(password)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      setPassword('')
    }
  }

  async function handleReset() {
    if (confirmInput !== 'RESET') return
    setResetting(true)
    setError('')
    const result = await resetWallet()
    setResetting(false)
    if ('error' in result) {
      setError(result.error)
    }
  }

  async function handleOverwrite() {
    setResetting(true)
    setError('')
    sessionStorage.setItem('cyphras_onboarding_start', pendingRoute)
    const result = await resetWallet()
    setResetting(false)
    if ('error' in result) {
      sessionStorage.removeItem('cyphras_onboarding_start')
      setError(result.error)
      return
    }
    // App.tsx will redirect to onboarding.html when status.hasWallet becomes false.
    // Onboarding reads cyphras_onboarding_start from sessionStorage and navigates to the right step.
  }

  if (view === 'reset-confirm') {
    return (
      <Layout
        variant="centered"
        navbar={
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => {
                setView('reset-prompt')
                setConfirmInput('')
                setResetAcknowledged(false)
                setError('')
              }}
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Reset wallet</h2>
          </div>
        }
        footer={
          <div className="flex flex-col gap-2">
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <Button
              variant="destructive"
              className="w-full"
              disabled={!resetAcknowledged || confirmInput !== 'RESET' || resetting}
              onClick={handleReset}
            >
              {resetting ? 'Resetting...' : 'Reset wallet'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6 w-full">
          <div className="rounded-xl bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will permanently delete all accounts and data from this device.
            </p>
          </div>

          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-destructive shrink-0" />
              <p className="text-xs font-semibold text-destructive">Warning</p>
            </div>
            <ul className="flex flex-col gap-1.5 text-xs text-destructive/90 pl-0.5">
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>All accounts and keys will be erased from
                this device
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>Your funds are safe only if you have your
                recovery phrase backed up
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>This action cannot be undone
              </li>
            </ul>
          </div>

          <button
            onClick={() => setResetAcknowledged((p) => !p)}
            className="cursor-pointer flex items-start gap-3 rounded-xl border border-border px-4 py-3 text-left w-full transition-colors hover:bg-muted/40"
          >
            <div
              className={`mt-0.5 h-4 w-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${resetAcknowledged ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}
            >
              {resetAcknowledged && <Check size={10} className="text-primary-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              I have my recovery phrase backed up and understand this action cannot be undone
            </p>
          </button>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground text-center">
              Type <span className="font-mono font-bold text-foreground">RESET</span> to confirm
            </p>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => {
                setConfirmInput(e.target.value.toUpperCase())
                setError('')
              }}
              placeholder="RESET"
              className="w-full rounded-xl bg-card px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive text-center tracking-widest uppercase"
            />
          </div>
        </div>
      </Layout>
    )
  }

  if (view === 'overwrite-confirm') {
    const isImport = pendingRoute === 'import'
    return (
      <Layout
        variant="centered"
        navbar={
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => {
                setView('reset-prompt')
                setOverwriteAcknowledged(false)
                setError('')
              }}
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">
              {isImport ? 'Import wallet' : 'Create wallet'}
            </h2>
          </div>
        }
        footer={
          <div className="flex flex-col gap-2">
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            <Button
              variant="destructive"
              className="w-full"
              disabled={!overwriteAcknowledged || resetting}
              onClick={handleOverwrite}
            >
              {resetting ? 'Processing...' : isImport ? 'Continue to import' : 'Continue to create'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6 w-full">
          <div className="rounded-xl bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are overwriting an existing account. You will permanently lose access to the
              account currently stored in Cyphras unless you have your recovery phrase backed up.
            </p>
          </div>

          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-destructive shrink-0" />
              <p className="text-xs font-semibold text-destructive">Warning</p>
            </div>
            <ul className="flex flex-col gap-1.5 text-xs text-destructive/90 pl-0.5">
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>All current accounts and keys will be
                erased from this device
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>Your funds are safe only if you have your
                recovery phrase backed up
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">-</span>This action cannot be undone
              </li>
            </ul>
          </div>

          <button
            onClick={() => setOverwriteAcknowledged((p) => !p)}
            className="cursor-pointer flex items-start gap-3 rounded-xl border border-border px-4 py-3 text-left w-full transition-colors hover:bg-muted/40"
          >
            <div
              className={`mt-0.5 h-4 w-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${overwriteAcknowledged ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}
            >
              {overwriteAcknowledged && <Check size={10} className="text-primary-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              I have my recovery phrase backed up and understand this action cannot be undone
            </p>
          </button>
        </div>
      </Layout>
    )
  }

  if (view === 'reset-prompt') {
    return (
      <Layout
        variant="centered"
        navbar={
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => {
                setView('unlock')
                setError('')
              }}
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Forgot password?</h2>
          </div>
        }
      >
        <div className="flex flex-col gap-5 w-full">
          <p className="text-sm text-muted-foreground">
            Lost your password? Want to replace your accounts?
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                setPendingRoute('import')
                setView('overwrite-confirm')
                setError('')
              }}
              className="cursor-pointer flex items-start gap-3 rounded-xl bg-card p-4 text-left hover:bg-muted/60 transition-colors border border-border"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <ArrowDownToLine size={16} className="text-primary" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-sm font-semibold text-foreground">Import using seed phrase</p>
                <p className="text-xs text-muted-foreground">
                  Replace all data with a new wallet from your recovery phrase
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                setPendingRoute('create')
                setView('overwrite-confirm')
                setError('')
              }}
              className="cursor-pointer flex items-start gap-3 rounded-xl bg-card p-4 text-left hover:bg-muted/60 transition-colors border border-border"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <Plus size={16} className="text-primary" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-sm font-semibold text-foreground">Create a new wallet</p>
                <p className="text-xs text-muted-foreground">
                  Erase all data and set up a brand new wallet with a new password
                </p>
              </div>
            </button>

            <button
              onClick={() => setView('reset-confirm')}
              className="cursor-pointer flex items-start gap-3 rounded-xl bg-card p-4 text-left hover:bg-muted/60 transition-colors border border-border"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 mt-0.5">
                <RotateCcw size={16} className="text-destructive" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-sm font-semibold text-foreground">Reset & wipe wallet</p>
                <p className="text-xs text-muted-foreground">
                  Erase all data from this device without setting up a new wallet
                </p>
              </div>
            </button>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-3">
            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Make sure you have your recovery phrase before proceeding. Without it you will lose
              access to your funds permanently.
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout
      variant="centered"
      footer={
        <div className="flex flex-col gap-3">
          {!isLocked && (
            <Button
              className="w-full"
              onClick={handleUnlock}
              disabled={loading || !password}
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setView('reset-prompt')
              setError('')
            }}
          >
            Forgot your password?
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 text-center w-full">
        <div className="flex flex-col items-center gap-3">
          <CyphrasLogo size={56} />
          <div className="flex flex-col gap-1">
            <img
              src="/logo.svg"
              alt="Cyphras"
              className="h-6 w-auto dark:invert"
              draggable={false}
            />
            <p className="text-sm text-muted-foreground">
              {isLocked ? 'Too many failed attempts' : 'Enter password to unlock'}
            </p>
          </div>
        </div>

        {isLocked ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <Lock size={22} className="text-destructive" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-medium text-foreground">Wallet locked</p>
              <p className="text-xs text-muted-foreground">Try again in</p>
            </div>
            <div className="rounded-2xl bg-card border border-border px-8 py-4 text-center">
              <p className="text-4xl font-mono font-bold text-foreground tabular-nums tracking-tight">
                {timeDisplay}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 text-left">
            <PasswordInput
              value={password}
              onChange={(v) => {
                setPassword(v)
                setError('')
              }}
              placeholder="Password"
              error={!!error}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            />
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                <AlertTriangle size={13} className="text-destructive shrink-0" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
            {(status.failedAttempts ?? 0) > 0 && attemptsLeft <= 2 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {attemptsLeft === 1
                    ? 'Last attempt before lockout'
                    : `${attemptsLeft} attempts remaining before lockout`}
                </p>
              </div>
            )}
            {(status.failedAttempts ?? 0) > 0 && attemptsLeft > 2 && !error && (
              <p className="text-xs text-muted-foreground text-center">
                {attemptsLeft} attempts remaining
              </p>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
