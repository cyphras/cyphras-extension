import { useState, useRef } from 'react'
import {
  X,
  Download,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
  UserPlus,
  ChevronLeft,
} from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import bip39English from 'bip39/src/wordlists/english.json'

type WalletType = 'add-account' | 'import-phrase' | 'import-key'
type Step = 'choose' | 'phrase' | 'key' | 'password' | 'success'

const BIP39_WORDS = new Set<string>(bip39English)

interface AddWalletModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function AddWalletModal({ isOpen, onClose }: AddWalletModalProps) {
  const { importHDWallet, importSecretKey, addAccount, switchAccount } = useWallet()

  const [step, setStep] = useState<Step>('choose')
  const [walletType, setWalletType] = useState<WalletType | null>(null)

  const [phraseLength, setPhraseLength] = useState<12 | 24>(12)
  const [phraseWords, setPhraseWords] = useState<string[]>(Array(12).fill(''))
  const [showPhrase, setShowPhrase] = useState(false)
  const [phraseError, setPhraseError] = useState('')

  const [secretKey, setSecretKey] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [keyError, setKeyError] = useState('')

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const [loading, setLoading] = useState(false)
  const wordRefs = useRef<(HTMLInputElement | null)[]>([])

  function reset() {
    setStep('choose')
    setWalletType(null)
    setPhraseLength(12)
    setPhraseWords(Array(12).fill(''))
    setShowPhrase(false)
    setPhraseError('')
    setSecretKey('')
    setShowSecret(false)
    setKeyError('')
    setPassword('')
    setShowPassword(false)
    setPasswordError('')
    setLoading(false)
  }

  function handleClose() {
    // Block closing mid-import so the wallet is never left half-applied.
    if (loading) return
    reset()
    onClose()
  }

  function selectType(type: WalletType) {
    setWalletType(type)
    if (type === 'add-account') {
      setStep('password')
    } else if (type === 'import-phrase') {
      setStep('phrase')
    } else {
      setStep('key')
    }
  }

  function handleBack() {
    if (loading) return
    if (step === 'phrase' || step === 'key') {
      setStep('choose')
      setPhraseError('')
      setKeyError('')
    } else if (step === 'password') {
      if (walletType === 'add-account') {
        setStep('choose')
      } else if (walletType === 'import-phrase') {
        setStep('phrase')
      } else {
        setStep('key')
      }
      setPasswordError('')
    }
  }

  function handlePhraseLengthChange(len: 12 | 24) {
    setPhraseLength(len)
    setPhraseWords((prev) => {
      const next: string[] = Array(len).fill('')
      for (let i = 0; i < Math.min(prev.length, len); i++) next[i] = prev[i]
      return next
    })
  }

  function handleWordChange(index: number, value: string) {
    setPhraseError('')
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
    setPhraseError('')
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

  function handlePhraseContinue() {
    if (!allFilled) {
      setPhraseError('Please fill in all words')
      return
    }
    const invalid = phraseWords.findIndex((w) => !BIP39_WORDS.has(w.trim()))
    if (invalid !== -1) {
      setPhraseError(`Word #${invalid + 1} is not a valid recovery word`)
      wordRefs.current[invalid]?.focus()
      return
    }
    setPhraseError('')
    setStep('password')
  }

  function handleKeyContinue() {
    const key = secretKey.trim()
    if (!key) {
      setKeyError('Secret key is required')
      return
    }
    if (!key.startsWith('S') || key.length !== 56) {
      setKeyError('Invalid secret key. Must start with S and be 56 characters.')
      return
    }
    setKeyError('')
    setStep('password')
  }

  async function handlePasswordSubmit() {
    if (!password) {
      setPasswordError('Password is required')
      return
    }
    setLoading(true)
    setPasswordError('')

    if (walletType === 'add-account') {
      const result = await addAccount('primary', undefined, password)
      if ('error' in result) {
        setLoading(false)
        setPasswordError(result.error)
        return
      }
      await switchAccount(result.account.publicKey)
      setLoading(false)
      setStep('success')
    } else if (walletType === 'import-phrase') {
      const mnemonic = phraseWords.map((w) => w.trim()).join(' ')
      const result = await importHDWallet(mnemonic, password)
      setLoading(false)
      if ('error' in result) {
        setPasswordError(result.error)
        return
      }
      setStep('success')
    } else if (walletType === 'import-key') {
      const result = await importSecretKey(secretKey.trim(), password)
      setLoading(false)
      if ('error' in result) {
        setPasswordError(result.error)
        return
      }
      setStep('success')
    }
  }

  const headerTitle =
    step === 'choose'
      ? 'Add Wallet'
      : step === 'phrase'
        ? 'Recovery Phrase'
        : step === 'key'
          ? 'Import Secret Key'
          : step === 'password'
            ? 'Confirm Password'
            : walletType === 'add-account'
              ? 'Account Added'
              : 'Wallet Imported'

  const footerContent = (() => {
    if (step === 'choose') return null
    if (step === 'phrase') {
      return (
        <div className="flex flex-col gap-2">
          {phraseError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{phraseError}</p>
            </div>
          )}
          <Button className="w-full" onClick={handlePhraseContinue} disabled={!allFilled}>
            Continue
          </Button>
        </div>
      )
    }
    if (step === 'key') {
      return (
        <div className="flex flex-col gap-2">
          {keyError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{keyError}</p>
            </div>
          )}
          <Button className="w-full" onClick={handleKeyContinue} disabled={!secretKey.trim()}>
            Continue
          </Button>
        </div>
      )
    }
    if (step === 'password') {
      return (
        <div className="flex flex-col gap-2">
          {passwordError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{passwordError}</p>
            </div>
          )}
          <Button className="w-full" onClick={handlePasswordSubmit} disabled={loading || !password}>
            {loading && <Loader2 size={14} className="animate-spin mr-1" />}
            {loading
              ? walletType === 'add-account'
                ? 'Adding...'
                : 'Importing...'
              : walletType === 'add-account'
                ? 'Add Account'
                : 'Import'}
          </Button>
        </div>
      )
    }
    if (step === 'success') {
      return (
        <Button className="w-full" onClick={handleClose}>
          Done
        </Button>
      )
    }
    return null
  })()

  return (
    <>
      <div
        className={`fixed inset-0 z-[100] bg-black/50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleClose}
      />

      <div
        className={`fixed bottom-0 left-0 right-0 z-[110] rounded-t-2xl bg-background shadow-2xl flex flex-col max-h-[80vh] transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1 shrink-0">
          <div className="flex items-center gap-0.5">
            {step !== 'choose' && step !== 'success' && (
              <button
                onClick={handleBack}
                disabled={loading}
                className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <span className="text-sm font-semibold text-foreground">{headerTitle}</span>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 min-h-0">
          {step === 'choose' && (
            <div className="flex flex-col gap-2 pb-5">
              <button
                onClick={() => selectType('add-account')}
                className="cursor-pointer flex items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left hover:bg-primary/5 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <UserPlus size={14} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Add Account</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Derive a new address from your wallet
                  </p>
                </div>
              </button>

              <button
                onClick={() => selectType('import-phrase')}
                className="cursor-pointer flex items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left hover:bg-primary/5 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Download size={14} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Import Recovery Phrase</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add accounts from another seed phrase
                  </p>
                </div>
              </button>

              <button
                onClick={() => selectType('import-key')}
                className="cursor-pointer flex items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left hover:bg-primary/5 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <KeyRound size={14} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Import Secret Key</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add an account with a Stellar S... key
                  </p>
                </div>
              </button>
            </div>
          )}

          {step === 'phrase' && (
            <div className="flex flex-col gap-3 pb-4">
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
          )}

          {step === 'key' && (
            <div className="flex flex-col gap-3 pb-4">
              <p className="text-sm text-muted-foreground">
                Enter your Stellar secret key starting with S.
              </p>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={secretKey}
                  onChange={(e) => {
                    setSecretKey(e.target.value)
                    setKeyError('')
                  }}
                  placeholder="S..."
                  onKeyDown={(e) => e.key === 'Enter' && handleKeyContinue()}
                  autoFocus
                  className="w-full rounded-xl bg-input px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {step === 'password' && (
            <div className="flex flex-col gap-3 pb-4">
              <p className="text-sm text-muted-foreground">
                Enter your wallet password to authorize this action.
              </p>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setPasswordError('')
                  }}
                  placeholder="Wallet password"
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handlePasswordSubmit()}
                  autoFocus
                  className="w-full rounded-xl bg-input px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-6 pb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                <Check size={28} className="text-green-500" />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="text-sm font-medium text-foreground">
                  {walletType === 'add-account' ? 'Account added!' : 'Wallet imported!'}
                </p>
                <p className="text-xs text-muted-foreground">Ready to use</p>
              </div>
            </div>
          )}
        </div>

        {footerContent && (
          <div className="shrink-0 px-4 pt-3 pb-5 border-t border-border bg-background">
            {footerContent}
          </div>
        )}
      </div>
    </>
  )
}
