import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useState, useRef } from 'react'
import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/PasswordInput'
import { Layout } from '@/components/Layout'
import { useAppContext } from '@/hooks/useAppContext'
import { validatePassword } from '@/lib/password'
import { CheckCircle2, Eye, EyeOff, Copy, Check, ChevronLeft, Pin } from 'lucide-react'
import bip39English from 'bip39/src/wordlists/english.json'

const BIP39_WORDS = new Set<string>(bip39English)

function CyphrasLogo({ size = 64 }: { size?: number }) {
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

function PinHint() {
  return (
    <div className="fixed top-6 right-6 z-50 w-[268px] rounded-2xl bg-card shadow-xl overflow-hidden">
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-foreground">Pin Cyphras to the toolbar</p>
        <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
          <div className="flex-1 h-3.5 rounded-full bg-muted-foreground/15" />
          <div className="h-7 w-7 rounded-lg bg-background flex items-center justify-center shrink-0 text-muted-foreground">
            <svg className="h-4 w-4 opacity-60" fill="currentColor" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                <path d="M345.14,480H274a18,18,0,0,1-18-18V434.29a31.32,31.32,0,0,0-9.71-22.77c-7.78-7.59-19.08-11.8-30.89-11.51-21.36.5-39.4,19.3-39.4,41.06V462a18,18,0,0,1-18,18H87.62A55.62,55.62,0,0,1,32,424.38V354a18,18,0,0,1,18-18H77.71c9.16,0,18.07-3.92,25.09-11A42.06,42.06,0,0,0,115,295.08C114.7,273.89,97.26,256,76.91,256H50a18,18,0,0,1-18-18V167.62A55.62,55.62,0,0,1,87.62,112h55.24a8,8,0,0,0,8-8V97.52A65.53,65.53,0,0,1,217.54,32c35.49.62,64.36,30.38,64.36,66.33V104a8,8,0,0,0,8,8h55.24A54.86,54.86,0,0,1,400,166.86V222.1a8,8,0,0,0,8,8h5.66c36.58,0,66.34,29,66.34,64.64,0,36.61-29.39,66.4-65.52,66.4H408a8,8,0,0,0-8,8v56A54.86,54.86,0,0,1,345.14,480Z" />
              </svg>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2">
          <img src="/icon-32.png" alt="Cyphras" className="h-5 w-5 rounded shrink-0" />
          <p className="flex-1 text-sm text-foreground">Cyphras</p>
          <Pin size={14} className="text-muted-foreground shrink-0" />
        </div>
      </div>
    </div>
  )
}

function TermsCheckbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <div
        className={`mt-0.5 h-4 w-4 shrink-0 rounded flex items-center justify-center border transition-colors ${checked ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`}
      >
        {checked && (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path
              d="M1 3.5L3.2 5.5L8 1"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span className="text-xs text-muted-foreground leading-relaxed">
        I agree to the{' '}
        <a
          href="https://cyphras.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Terms of Service
        </a>
      </span>
    </label>
  )
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="relative flex items-center justify-center">
      <button
        onClick={onBack}
        className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <ChevronLeft size={18} />
      </button>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
    </div>
  )
}

function OnboardingLayout({
  children,
  header,
  footer,
  variant = 'scroll',
}: {
  children: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  variant?: 'scroll' | 'centered'
}) {
  const ctx = useAppContext()
  if (ctx === 'tab') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-[420px] rounded-2xl bg-card shadow-xl overflow-hidden">
          <div className="flex flex-col px-7 py-7 gap-5">
            {header}
            {children}
            {footer}
          </div>
        </div>
      </div>
    )
  }
  return (
    <Layout variant={variant} navbar={header} footer={footer}>
      {children}
    </Layout>
  )
}

function SuccessPage() {
  const ctx = useAppContext()

  if (ctx !== 'tab') {
    return (
      <Layout
        variant="centered"
        footer={
          <Button className="w-full" onClick={() => window.close()}>
            Close and get started
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle2 size={28} className="text-green-500" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-foreground">Wallet ready!</h2>
            <p className="text-sm text-muted-foreground">
              Your Cyphras wallet is set up and ready to use
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <>
      <PinHint />
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-[420px] rounded-2xl bg-card shadow-xl px-7 py-8 flex flex-col gap-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-bold text-foreground">Wallet ready!</h2>
              <p className="text-sm text-muted-foreground">
                Your Cyphras wallet is set up and ready to use
              </p>
            </div>
          </div>
          <div className="rounded-xl bg-muted p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">Next steps</p>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                  1
                </span>
                <p className="text-sm text-muted-foreground">
                  Pin Cyphras to your toolbar using the hint in the top-right corner
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                  2
                </span>
                <p className="text-sm text-muted-foreground">
                  Click the Cyphras icon to open your wallet anytime
                </p>
              </div>
            </div>
          </div>
          <Button className="w-full" onClick={() => window.close()}>
            Close and get started
          </Button>
        </div>
      </div>
    </>
  )
}

function OnboardingCreate() {
  const navigate = useNavigate()
  const { createWallet } = useWallet()
  const [step, setStep] = useState<'password' | 'mnemonic' | 'verify' | 'success'>('password')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [verifyWord, setVerifyWord] = useState('')
  const [verifyIndex, setVerifyIndex] = useState(0)
  const [apiError, setApiError] = useState('')
  const [verifyError, setVerifyError] = useState('')
  const [revealError, setRevealError] = useState('')
  const [loading, setLoading] = useState(false)

  const pwCheck = validatePassword(password)
  const canContinue = pwCheck.valid && password === confirmPassword && termsAccepted

  async function handleCreatePassword() {
    if (!canContinue) return
    setApiError('')
    setLoading(true)
    const result = await createWallet(password)
    setLoading(false)
    if ('error' in result) {
      setApiError(result.error)
      return
    }
    setMnemonic(result.mnemonic)
    const words = result.mnemonic.split(' ')
    setVerifyIndex(Math.floor(Math.random() * words.length))
    setStep('mnemonic')
  }

  function handleProceedToVerify() {
    if (!revealed) {
      setRevealError('Please reveal and save your recovery phrase first')
      return
    }
    setRevealError('')
    setStep('verify')
  }

  function handleVerify() {
    const words = mnemonic.split(' ')
    if (verifyWord.trim().toLowerCase() !== words[verifyIndex].toLowerCase()) {
      setVerifyError(`Incorrect. Please check word #${verifyIndex + 1} again`)
      return
    }
    setVerifyError('')
    setStep('success')
  }

  function handleCopy() {
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (step === 'success') return <SuccessPage />

  if (step === 'verify') {
    return (
      <OnboardingLayout
        variant="centered"
        header={
          <ScreenHeader
            title="Verify phrase"
            onBack={() => {
              setVerifyWord('')
              setVerifyError('')
              setStep('mnemonic')
            }}
          />
        }
        footer={
          <div className="flex flex-col gap-2">
            {verifyError && <p className="text-xs text-destructive">{verifyError}</p>}
            <Button className="w-full" onClick={handleVerify} disabled={!verifyWord.trim()}>
              Confirm
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Enter word <span className="font-semibold text-foreground">#{verifyIndex + 1}</span>{' '}
            from your recovery phrase
          </p>
          <input
            type="text"
            placeholder={`Word #${verifyIndex + 1}`}
            value={verifyWord}
            onChange={(e) => {
              setVerifyWord(e.target.value)
              setVerifyError('')
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            className="w-full rounded-xl bg-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </div>
      </OnboardingLayout>
    )
  }

  if (step === 'mnemonic') {
    return (
      <OnboardingLayout
        header={<ScreenHeader title="Recovery phrase" onBack={() => navigate('/')} />}
        footer={
          <div className="flex flex-col gap-2">
            {revealError && <p className="text-xs text-destructive text-center">{revealError}</p>}
            <Button className="w-full" onClick={handleProceedToVerify} disabled={!revealed}>
              {revealed ? 'I saved it' : 'Reveal phrase first'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Write down all {mnemonic.split(' ').length} words in order. This is the only way to
            recover your wallet.
          </p>
          <div className="relative rounded-xl bg-muted p-4">
            <div
              className={`grid grid-cols-3 gap-2 ${!revealed ? 'blur-sm select-none pointer-events-none' : ''}`}
            >
              {mnemonic.split(' ').map((word, i) => (
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
                  onClick={() => {
                    setRevealed(true)
                    setRevealError('')
                  }}
                  className="cursor-pointer flex items-center gap-2 rounded-xl bg-background border border-border px-4 py-2.5 text-sm font-medium text-foreground shadow hover:bg-muted transition-colors"
                >
                  <Eye size={15} />
                  Reveal phrase
                </button>
              </div>
            )}
          </div>
          {revealed && (
            <button
              onClick={handleCopy}
              className="cursor-pointer flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          )}
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-3">
            <EyeOff size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Never share your recovery phrase with anyone. Cyphras will never ask for it. If you copy
              it, clear your clipboard afterward.
            </p>
          </div>
        </div>
      </OnboardingLayout>
    )
  }

  return (
    <OnboardingLayout
      variant="centered"
      header={<ScreenHeader title="Create password" onBack={() => navigate('/')} />}
      footer={
        <div className="flex flex-col gap-2">
          {apiError && <p className="text-xs text-destructive">{apiError}</p>}
          <Button
            className="w-full"
            onClick={handleCreatePassword}
            disabled={loading || !canContinue}
          >
            {loading ? 'Creating...' : 'Continue'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          This password encrypts your wallet on this device only
        </p>
        <div className="flex flex-col gap-3">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Password (min. 8 characters)"
            showStrength
          />
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm password"
            confirmOf={password}
            onKeyDown={(e) => e.key === 'Enter' && canContinue && handleCreatePassword()}
          />
          <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
        </div>
      </div>
    </OnboardingLayout>
  )
}

function OnboardingImport() {
  const navigate = useNavigate()
  const { importWallet } = useWallet()
  const [step, setStep] = useState<'phrase' | 'password' | 'success'>('phrase')
  const [phraseLength, setPhraseLength] = useState<12 | 24>(12)
  const [phraseWords, setPhraseWords] = useState<string[]>(Array(12).fill(''))
  const [showPhrase, setShowPhrase] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [mnemonicError, setMnemonicError] = useState('')
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)
  const wordRefs = useRef<(HTMLInputElement | null)[]>([])

  function handlePhraseLengthChange(len: 12 | 24) {
    setPhraseLength(len)
    setPhraseWords((prev) => {
      const next: string[] = Array(len).fill('')
      for (let i = 0; i < Math.min(prev.length, len); i++) next[i] = prev[i]
      return next
    })
  }

  function handleWordChange(index: number, value: string) {
    setMnemonicError('')
    setPhraseWords((prev) => {
      const next = [...prev]
      next[index] = value.toLowerCase().replace(/[^a-z]/g, '')
      return next
    })
  }

  function handleWordPaste(e: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const pasted = e.clipboardData.getData('text').trim().split(/\s+/).filter(Boolean)
    if (pasted.length <= 1) return
    e.preventDefault()
    setMnemonicError('')
    setPhraseWords((prev) => {
      const next = [...prev]
      for (let i = 0; i < pasted.length && index + i < phraseLength; i++) {
        next[index + i] = pasted[i].toLowerCase().replace(/[^a-z]/g, '')
      }
      return next
    })
  }

  function handleWordKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (index + 1 < phraseLength) {
      wordRefs.current[index + 1]?.focus()
    } else {
      handlePhraseContinue()
    }
  }

  const filledCount = phraseWords.filter((w) => w.trim()).length
  const allFilled = filledCount === phraseLength
  const mnemonic = phraseWords.map((w) => w.trim()).join(' ')

  function handlePhraseContinue() {
    if (!allFilled) {
      setMnemonicError('Please fill in all words')
      return
    }
    const invalid = phraseWords.findIndex((w) => !BIP39_WORDS.has(w.trim()))
    if (invalid !== -1) {
      setMnemonicError(`Word #${invalid + 1} is not a valid recovery word`)
      wordRefs.current[invalid]?.focus()
      return
    }
    setMnemonicError('')
    setStep('password')
  }

  const pwCheck = validatePassword(password)
  const canImport = pwCheck.valid && password === confirmPassword && termsAccepted

  async function handleImport() {
    if (!pwCheck.valid || password !== confirmPassword) return
    setApiError('')
    setLoading(true)
    const result = await importWallet(mnemonic, password)
    setLoading(false)
    if ('error' in result) {
      setApiError('Invalid recovery phrase. Please check your words and try again.')
      return
    }
    setStep('success')
  }

  if (step === 'success') return <SuccessPage />

  if (step === 'password') {
    return (
      <OnboardingLayout
        variant="centered"
        header={
          <ScreenHeader
            title="Create password"
            onBack={() => {
              setApiError('')
              setStep('phrase')
            }}
          />
        }
        footer={
          <div className="flex flex-col gap-2">
            {apiError && <p className="text-xs text-destructive">{apiError}</p>}
            <Button className="w-full" onClick={handleImport} disabled={loading || !canImport}>
              {loading ? 'Importing...' : 'Import wallet'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This password encrypts your wallet on this device only
          </p>
          <div className="flex flex-col gap-3">
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Password (min. 8 characters)"
              showStrength
            />
            <PasswordInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Confirm password"
              confirmOf={password}
              onKeyDown={(e) => e.key === 'Enter' && canImport && handleImport()}
            />
            <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
          </div>
        </div>
      </OnboardingLayout>
    )
  }

  return (
    <OnboardingLayout
      header={<ScreenHeader title="Import wallet" onBack={() => navigate('/')} />}
      footer={
        <div className="flex flex-col gap-2">
          {mnemonicError && <p className="text-xs text-destructive">{mnemonicError}</p>}
          <Button className="w-full" onClick={handlePhraseContinue} disabled={!allFilled}>
            Continue
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex rounded-xl bg-muted p-1 gap-1">
          {([12, 24] as const).map((len) => (
            <button
              key={len}
              type="button"
              onClick={() => handlePhraseLengthChange(len)}
              className={`flex-1 cursor-pointer rounded-lg py-1.5 text-sm font-medium transition-colors ${
                phraseLength === len
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {len} words
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {filledCount < phraseLength
                ? `${filledCount} / ${phraseLength} words`
                : `${phraseLength} words entered`}
            </p>
            <button
              type="button"
              onClick={() => setShowPhrase((p) => !p)}
              className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPhrase ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPhrase ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {phraseWords.map((word, i) => (
              <div
                key={i}
                className="flex items-center rounded-lg bg-input ring-1 ring-transparent focus-within:ring-ring overflow-hidden transition-shadow"
              >
                <span className="pl-2 text-[10px] text-muted-foreground/60 tabular-nums shrink-0 select-none w-5 text-right">
                  {i + 1}
                </span>
                <input
                  ref={(el) => {
                    wordRefs.current[i] = el
                  }}
                  type={showPhrase ? 'text' : 'password'}
                  value={word}
                  onChange={(e) => handleWordChange(i, e.target.value)}
                  onPaste={(e) => handleWordPaste(e, i)}
                  onKeyDown={(e) => handleWordKeyDown(e, i)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full bg-transparent px-1.5 py-2 text-sm text-foreground focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </OnboardingLayout>
  )
}

function OnboardingStart() {
  const navigate = useNavigate()
  const ctx = useAppContext()

  if (ctx !== 'tab') {
    return (
      <Layout
        variant="centered"
        footer={
          <div className="flex flex-col gap-3">
            <Button className="w-full" onClick={() => navigate('/create')}>
              Create new wallet
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate('/import')}>
              Import using seed phrase
            </Button>
          </div>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <CyphrasLogo size={56} />
          <img src="/logo.svg" alt="Cyphras" className="h-6 w-auto dark:invert" draggable={false} />
        </div>
      </Layout>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] rounded-2xl bg-card shadow-xl px-7 py-8 flex flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center pt-2">
          <CyphrasLogo size={64} />
          <img
            src="/logo.svg"
            alt="Cyphras"
            className="h-7 w-auto dark:invert mx-auto"
            draggable={false}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Button size="lg" className="w-full" onClick={() => navigate('/create')}>
            Create new wallet
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => navigate('/import')}
          >
            Import using seed phrase
          </Button>
        </div>
      </div>
    </div>
  )
}

function OnboardingStartRoute() {
  const start = sessionStorage.getItem('cyphras_onboarding_start')
  if (start === 'import' || start === 'create') {
    sessionStorage.removeItem('cyphras_onboarding_start')
    return <Navigate to={'/' + start} replace />
  }
  return <OnboardingStart />
}

export default function Onboarding() {
  return (
    <Routes>
      <Route path="/" element={<OnboardingStartRoute />} />
      <Route path="/create" element={<OnboardingCreate />} />
      <Route path="/import" element={<OnboardingImport />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
