import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { usePreferences } from '@/context/PreferencesContext'
import { useBalances } from '@/hooks/useBalances'
import { Button } from '@/components/ui/button'
import {
  ArrowUpDown,
  ExternalLink,
  Settings,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Copy,
  Check,
  CheckCircle2,
  ArrowDown,
  X,
  Search,
  AlertTriangle,
} from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { SERVICE_TYPES } from '@constants/services'
import type { SwapQuote } from '@ext-types/index'
import type { AssetBalance } from '@/hooks/useBalances'

type Step = 'form' | 'confirm' | 'success'
type FeeTier = 'low' | 'medium' | 'high' | 'custom'

interface FeeStats {
  low: string
  medium: string
  high: string
}

function stroopsToXlm(s: string): string {
  return (parseInt(s) / 10_000_000).toFixed(7)
}

async function fetchFeeStats(horizonUrl: string): Promise<FeeStats> {
  try {
    const res = await fetch(`${horizonUrl}/fee_stats`)
    if (!res.ok) throw new Error()
    const data = (await res.json()) as { max_fee: { mode: string; p10: string; p90: string } }
    const base = Math.max(parseInt(data.max_fee.p10) || 100, 100)
    const mid = Math.max(parseInt(data.max_fee.mode) || 100, base * 5)
    const fast = Math.max(parseInt(data.max_fee.p90) || 100, base * 20)
    return { low: base.toString(), medium: mid.toString(), high: fast.toString() }
  } catch {
    return { low: '100', medium: '500', high: '2000' }
  }
}

function parseKey(key: string): { code: string; issuer: string } {
  const idx = key.indexOf(':')
  if (idx === -1) return { code: key, issuer: '' }
  return { code: key.slice(0, idx), issuer: key.slice(idx + 1) }
}

function friendlyError(raw: string): string {
  const r = raw.toLowerCase()
  if (r.includes('no path') || r.includes('path not found'))
    return 'No swap path found between these assets. Try a different pair or amount.'
  if (r.includes('op_underfunded') || (r.includes('insufficient') && r.includes('balance')))
    return 'Insufficient balance to complete this swap.'
  if (r.includes('op_no_trust'))
    return 'Missing trustline for the destination asset. Add the asset first.'
  if (r.includes('op_line_full')) return 'Destination account trustline limit reached.'
  if (r.includes('op_cross_self'))
    return 'Order would cross your own offer. Try a different amount.'
  if (r.includes('tx_too_late') || r.includes('too late'))
    return 'Transaction expired. Please try again.'
  if (r.includes('slippage') || r.includes('destmin'))
    return 'Price moved too much. Try increasing slippage tolerance.'
  if (r.includes('timeout') || r.includes('timed out'))
    return 'Request timed out. Check your connection and try again.'
  if (r.includes('user rejected') || r.includes('cancelled')) return 'Swap cancelled.'
  if (r.includes('not connected') || r.includes('not allowed')) return 'Wallet not connected.'
  return raw
}

function feeLevel(tier: FeeTier, customFeeStr: string, stats: FeeStats): 1 | 2 | 3 {
  if (tier === 'low') return 1
  if (tier === 'medium') return 2
  if (tier === 'high') return 3
  const fee = parseInt(customFeeStr) || 0
  if (fee >= parseInt(stats.high)) return 3
  if (fee >= parseInt(stats.medium)) return 2
  return 1
}

function FeeBar({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="flex items-end gap-[2px]">
      {([1, 2, 3] as const).map((i) => (
        <div
          key={i}
          style={{ height: 2 + i * 3 }}
          className={`w-[3px] rounded-[1px] ${i <= level ? 'bg-primary' : 'bg-muted-foreground/25'}`}
        />
      ))}
    </div>
  )
}

function XlmCircle({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function AssetIcon({ icon, code, size = 32 }: { icon?: string; code: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (code === 'XLM') {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full overflow-hidden bg-black shrink-0 flex items-center justify-center"
      >
        <XlmCircle size={size} />
      </div>
    )
  }
  if (icon && !err) {
    return (
      <img
        src={icon}
        alt={code}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-muted shrink-0 flex items-center justify-center"
    >
      <span className="text-xs font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

function AssetPickerSheet({
  balances,
  selectedKey,
  excludeKey,
  onSelect,
  onClose,
}: {
  balances: AssetBalance[]
  selectedKey: string
  excludeKey?: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const available = excludeKey
    ? balances.filter((b) => `${b.code}:${b.issuer}` !== excludeKey)
    : balances
  const filtered = available.filter((b) => {
    const q = query.toLowerCase()
    return b.code.toLowerCase().includes(q) || b.issuer.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-[60] flex flex-col">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[75vh]">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <p className="text-sm font-semibold text-foreground">Select asset</p>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {available.length > 4 && (
          <div className="px-5 pb-3 shrink-0">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Search size={14} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
          </div>
        )}
        <div className="overflow-y-auto flex-1 px-3 pb-4 flex flex-col gap-1">
          {filtered.map((b) => {
            const key = `${b.code}:${b.issuer}`
            return (
              <button
                key={key}
                onClick={() => {
                  onSelect(key)
                  onClose()
                }}
                className={`cursor-pointer flex items-center gap-3 w-full rounded-xl px-3 py-3 text-left transition-colors ${key === selectedKey ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted border border-transparent'}`}
              >
                <AssetIcon icon={b.icon} code={b.code} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{b.code}</p>
                  {!b.isNative && (
                    <p className="text-xs font-mono text-muted-foreground truncate">
                      {b.issuer.slice(0, 6)}...{b.issuer.slice(-6)}
                    </p>
                  )}
                </div>
                <p className="text-sm text-foreground tabular-nums shrink-0">
                  {parseFloat(b.balance).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                </p>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No assets found</p>
          )}
        </div>
      </div>
    </div>
  )
}

const SLIPPAGE_PRESETS = ['0.5', '1', '2', '3']

function SettingsModal({
  feeStats,
  feeTier,
  customFee,
  slippage,
  txTimeout,
  onSave,
  onCancel,
}: {
  feeStats: FeeStats
  feeTier: FeeTier
  customFee: string
  slippage: string
  txTimeout: number
  onSave: (tier: FeeTier, fee: string, slippage: string, timeout: number) => void
  onCancel: () => void
}) {
  const [localTier, setLocalTier] = useState<FeeTier>(feeTier)
  const [localFee, setLocalFee] = useState(customFee)
  const [localSlippage, setLocalSlippage] = useState(slippage)
  const [localTimeout, setLocalTimeout] = useState(txTimeout)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true))
  }, [])
  function handleClose() {
    setIsOpen(false)
    setTimeout(onCancel, 280)
  }

  const feeNum = parseInt(localFee)
  const feeError =
    localTier === 'custom'
      ? !localFee.trim()
        ? 'Enter a fee amount'
        : isNaN(feeNum)
          ? 'Must be a whole number'
          : feeNum <= 0
            ? 'Must be greater than 0'
            : feeNum < 100
              ? 'Minimum is 100 stroops'
              : null
      : null

  const slipNum = parseFloat(localSlippage)
  const slipError =
    !SLIPPAGE_PRESETS.includes(localSlippage) && localSlippage !== ''
      ? isNaN(slipNum)
        ? 'Must be a number'
        : slipNum <= 0
          ? 'Must be greater than 0'
          : slipNum > 50
            ? 'Maximum is 50%'
            : null
      : null

  const isCustomSlippage = !SLIPPAGE_PRESETS.includes(localSlippage)
  const canSave = feeError === null && slipError === null && localSlippage !== ''

  const presetFee =
    localTier !== 'custom' ? feeStats[localTier as Exclude<FeeTier, 'custom'>] : null
  const displayFee =
    localTier === 'custom'
      ? !localFee.trim() || isNaN(feeNum) || feeNum <= 0
        ? '-'
        : `${stroopsToXlm(localFee)} XLM`
      : presetFee
        ? `${stroopsToXlm(presetFee)} XLM`
        : '-'

  return (
    <div
      className={`fixed inset-0 z-[60] transition-all duration-300 ${isOpen ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col transition-transform duration-300 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">Swap settings</p>
          <button
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">
          {/* Slippage */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Slippage tolerance</p>
              <p className="text-xs text-muted-foreground">{localSlippage}%</p>
            </div>
            <div className="flex rounded-xl bg-muted p-1 gap-0.5">
              {SLIPPAGE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setLocalSlippage(s)}
                  className={`cursor-pointer flex-1 rounded-lg py-2 text-xs font-medium transition-all ${localSlippage === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s}%
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <div
                className={`flex items-center gap-2 rounded-lg bg-input px-3 transition-all ${isCustomSlippage && localSlippage ? 'ring-2 ring-ring' : ''}`}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Custom %"
                  value={isCustomSlippage ? localSlippage : ''}
                  onChange={(e) => setLocalSlippage(e.target.value.replace(/[^0-9.]/g, ''))}
                  onFocus={() => {
                    if (!isCustomSlippage) setLocalSlippage('')
                  }}
                  className="flex-1 py-2.5 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
                />
                {isCustomSlippage && localSlippage && (
                  <span className="text-xs text-muted-foreground shrink-0">%</span>
                )}
              </div>
              {slipError && <p className="text-xs text-destructive px-1">{slipError}</p>}
            </div>
          </div>

          {/* Network fee */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Network fee</p>
              <p className="text-xs font-mono text-muted-foreground">{displayFee}</p>
            </div>
            <div className="flex rounded-xl bg-muted p-1 gap-0.5">
              {(['low', 'medium', 'high'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setLocalTier(tier)}
                  className={`cursor-pointer flex-1 rounded-lg py-2.5 flex flex-col items-center gap-1.5 transition-all ${localTier === tier ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <FeeBar level={tier === 'low' ? 1 : tier === 'medium' ? 2 : 3} />
                  <span className="text-xs font-medium">
                    {tier === 'low' ? 'Slow' : tier === 'medium' ? 'Normal' : 'Fast'}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <div
                className={`flex items-center gap-2 rounded-lg bg-input px-3 transition-all ${localTier === 'custom' ? 'ring-2 ring-ring' : ''}`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Custom (stroops)"
                  value={localTier === 'custom' ? localFee : ''}
                  onChange={(e) => {
                    setLocalFee(e.target.value.replace(/[^0-9]/g, ''))
                    setLocalTier('custom')
                  }}
                  onFocus={() => {
                    if (localTier !== 'custom') setLocalTier('custom')
                  }}
                  className="flex-1 py-2.5 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
                />
                {localTier === 'custom' && localFee && !isNaN(feeNum) && feeNum >= 100 && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {stroopsToXlm(localFee)} XLM
                  </span>
                )}
              </div>
              {feeError && <p className="text-xs text-destructive px-1">{feeError}</p>}
            </div>
          </div>

          {/* Timeout */}
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Timeout</p>
            <div className="flex rounded-xl bg-muted p-1 gap-0.5">
              {[
                { value: 60, label: '1 min' },
                { value: 180, label: '3 min' },
                { value: 300, label: '5 min' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setLocalTimeout(value)}
                  className={`cursor-pointer flex-1 rounded-lg py-2 text-xs font-medium transition-all ${localTimeout === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return
              const fee =
                localTier === 'custom'
                  ? Math.max(100, feeNum).toString()
                  : feeStats[localTier as Exclude<FeeTier, 'custom'>]
              onSave(localTier, fee, localSlippage, localTimeout)
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function Swap() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { balances, loading: balancesLoading, isFunded } = useBalances(status.publicKey)
  const { getExplorerTxUrl } = usePreferences()

  const [step, setStep] = useState<Step>('form')
  const [fromKey, setFromKey] = useState('XLM:')
  const [toKey, setToKey] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [error, setError] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [txHash, setTxHash] = useState('')

  const [showSettings, setShowSettings] = useState(false)
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)

  const [slippage, setSlippage] = useState('1')
  const [feeTier, setFeeTier] = useState<FeeTier>('medium')
  const [customFee, setCustomFee] = useState('')
  const [txTimeout, setTxTimeout] = useState(180)
  const [feeStats, setFeeStats] = useState<FeeStats>({ low: '100', medium: '500', high: '2000' })

  const [xdrOpen, setXdrOpen] = useState(false)
  const [xdrCopied, setXdrCopied] = useState(false)

  const lastFromKeyRef = useRef(fromKey)
  const lastToKeyRef = useRef(toKey)
  const lastAmountRef = useRef(amount)
  if (fromKey) lastFromKeyRef.current = fromKey
  if (toKey) lastToKeyRef.current = toKey
  if (amount) lastAmountRef.current = amount

  useEffect(() => {
    fetchFeeStats(activeNetwork.horizonUrl).then(setFeeStats)
  }, [activeNetwork.horizonUrl])

  useEffect(() => {
    if (balances.length > 0 && !balances.find((b) => `${b.code}:${b.issuer}` === fromKey)) {
      const xlm = balances.find((b) => b.isNative)
      if (xlm) setFromKey(`${xlm.code}:${xlm.issuer}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances])

  const fromBalance = balances.find((b) => `${b.code}:${b.issuer}` === fromKey)
  const toBalance = balances.find((b) => `${b.code}:${b.issuer}` === toKey)
  const fromObj = parseKey(fromKey)
  const toObj = toKey ? parseKey(toKey) : null

  const activeFeeStroops = feeTier === 'custom' ? customFee || feeStats.medium : feeStats[feeTier]
  const activeFeeXlm = stroopsToXlm(activeFeeStroops)

  const amountNum = parseFloat(amount)
  const fromBalanceNum = fromBalance ? parseFloat(fromBalance.balance) : 0
  const maxSendable = fromBalance?.isNative ? Math.max(0, fromBalanceNum - 1) : fromBalanceNum

  const amountError: string | null = (() => {
    if (!amount || amountNum <= 0) return null
    if (fromKey === toKey) return 'Cannot swap an asset with itself'
    if (!fromBalance) return null // balances still loading
    if (amountNum > maxSendable) {
      return fromBalance.isNative
        ? `Insufficient balance. Max sendable: ${maxSendable.toFixed(7)} XLM (1 XLM reserved for fees)`
        : `Insufficient balance. You have ${parseFloat(fromBalance.balance).toFixed(7)} ${fromObj.code}`
    }
    return null
  })()

  function handleSwapAssets() {
    if (!toKey) return
    const prev = fromKey
    setFromKey(toKey)
    setToKey(prev)
    setAmount('')
    setQuote(null)
    setError('')
  }

  const fetchQuote = useCallback(async () => {
    const fk = fromKey
    const tk = toKey
    if (!fk || !tk || !amount || parseFloat(amount) <= 0) return
    if (fk === tk) return
    const from = parseKey(fk)
    const to = parseKey(tk)
    setQuoteLoading(true)
    setError('')
    setQuote(null)
    chrome.runtime.sendMessage(
      {
        type: SERVICE_TYPES.GET_SWAP_QUOTE,
        swap: {
          fromAssetCode: from.code,
          fromAssetIssuer: from.issuer,
          toAssetCode: to.code,
          toAssetIssuer: to.issuer,
          amount,
          slippage,
          fee: activeFeeStroops,
          timeout: txTimeout,
        },
        horizonUrl: activeNetwork.horizonUrl,
        networkPassphrase: activeNetwork.passphrase,
      },
      (response) => {
        setQuoteLoading(false)
        if (chrome.runtime.lastError) {
          setError('Extension error. Try again.')
          return
        }
        if (response?.error) {
          setError(friendlyError(response.error))
          return
        }
        if (!response?.quote) {
          setError('No quote returned. Try a different pair or amount.')
          return
        }
        setQuote(response.quote)
      }
    )
  }, [fromKey, toKey, amount, slippage, activeFeeStroops, txTimeout, activeNetwork])

  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0 || !toKey || amountError) return
    const timer = window.setTimeout(() => {
      fetchQuote()
    }, 600)
    return () => window.clearTimeout(timer)
  }, [amount, fromKey, toKey, slippage, fetchQuote, amountError])

  async function handleReview() {
    if (amountError) return
    if (!quote) {
      await fetchQuote()
      return
    }
    setXdrOpen(false)
    setStep('confirm')
  }

  function handleConfirm() {
    if (!toKey) return
    const from = parseKey(fromKey)
    const to = parseKey(toKey)
    setSubmitLoading(true)
    setError('')
    chrome.runtime.sendMessage(
      {
        type: SERVICE_TYPES.SIGN_AND_SUBMIT_SWAP,
        swap: {
          fromAssetCode: from.code,
          fromAssetIssuer: from.issuer,
          toAssetCode: to.code,
          toAssetIssuer: to.issuer,
          amount,
          slippage,
          fee: activeFeeStroops,
          timeout: txTimeout,
        },
        horizonUrl: activeNetwork.horizonUrl,
        networkPassphrase: activeNetwork.passphrase,
      },
      (response) => {
        setSubmitLoading(false)
        if (chrome.runtime.lastError) {
          setError('Extension error. Try again.')
          return
        }
        if (response?.error) {
          setError(friendlyError(response.error))
          return
        }
        setTxHash(response.txHash ?? '')
        setStep('success')
      }
    )
  }

  const sheetOpen = step === 'confirm' || step === 'success'
  const snapshotFrom = balances.find((b) => `${b.code}:${b.issuer}` === lastFromKeyRef.current)
  const snapshotTo = balances.find((b) => `${b.code}:${b.issuer}` === lastToKeyRef.current)
  const snapshotFromObj = parseKey(lastFromKeyRef.current)
  const snapshotToObj = lastToKeyRef.current ? parseKey(lastToKeyRef.current) : null

  const canReview = !!toKey && !!amount && amountNum > 0 && !quoteLoading && !amountError

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 bg-background">
        <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
          <WalletNavbar />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5">
          <div className="flex flex-col gap-4 py-4 pb-6">
            {/* Header */}
            <div className="relative flex items-center justify-center">
              <button
                onClick={() => navigate(-1)}
                className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-bold text-foreground">Swap</h2>
            </div>

            {/* Unfunded account warning */}
            {!balancesLoading && !isFunded && (
              <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-3">
                <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Account not funded. Send at least 1 XLM to this address to activate it before
                  swapping.
                </p>
              </div>
            )}

            {/* From + To combined card */}
            <div className="rounded-2xl bg-card">
              {/* From section */}
              <div className="p-4 pb-3">
                <button
                  onClick={() => setShowFromPicker(true)}
                  className="cursor-pointer self-start flex items-center gap-2 rounded-xl bg-muted px-3 py-2 hover:bg-muted/70 transition-colors mb-3"
                >
                  <AssetIcon icon={fromBalance?.icon} code={fromObj.code} size={22} />
                  <span className="text-sm font-semibold text-foreground">{fromObj.code}</span>
                  {fromObj.issuer && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {fromObj.issuer.slice(0, 4)}...{fromObj.issuer.slice(-4)}
                    </span>
                  )}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>

                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    setQuote(null)
                    setError('')
                  }}
                  className="text-4xl font-bold bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />

                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    {fromBalance
                      ? `Balance: ${parseFloat(fromBalance.balance).toLocaleString('en-US', { maximumFractionDigits: 7 })} ${fromObj.code}`
                      : balancesLoading
                        ? 'Loading...'
                        : 'Balance: -'}
                  </p>
                  {fromBalance && (
                    <button
                      onClick={() => {
                        setAmount(maxSendable.toFixed(7))
                        setQuote(null)
                        setError('')
                      }}
                      className="cursor-pointer text-xs font-medium text-primary hover:underline"
                    >
                      Max
                    </button>
                  )}
                </div>
              </div>

              {/* Divider with swap arrow */}
              <div className="relative flex items-center px-4 py-0">
                <div className="flex-1 h-px bg-border" />
                <button
                  onClick={handleSwapAssets}
                  disabled={!toKey}
                  className="cursor-pointer mx-2 rounded-xl bg-background border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <ArrowUpDown size={14} />
                </button>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* To section */}
              <div className="p-4 pt-3">
                <button
                  onClick={() => setShowToPicker(true)}
                  className="cursor-pointer self-start flex items-center gap-2 rounded-xl bg-muted px-3 py-2 hover:bg-muted/70 transition-colors mb-3"
                >
                  {toObj ? (
                    <>
                      <AssetIcon icon={toBalance?.icon} code={toObj.code} size={22} />
                      <span className="text-sm font-semibold text-foreground">{toObj.code}</span>
                      {toObj.issuer && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {toObj.issuer.slice(0, 4)}...{toObj.issuer.slice(-4)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Select asset</span>
                  )}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>

                <div className="min-h-[44px] flex items-center">
                  {quoteLoading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <p
                      className={`text-4xl font-bold ${quote ? 'text-foreground' : 'text-muted-foreground/40'}`}
                    >
                      {quote ? `~${parseFloat(quote.destinationAmount).toFixed(7)}` : '0.00'}
                    </p>
                  )}
                </div>

                {toObj && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {toBalance
                      ? `Balance: ${parseFloat(toBalance.balance).toLocaleString('en-US', { maximumFractionDigits: 7 })} ${toObj.code}`
                      : 'Balance: 0'}
                  </p>
                )}
              </div>
            </div>

            {/* Inline amount error */}
            {amountError && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 px-3.5 py-3">
                <AlertTriangle size={14} className="text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive">{amountError}</p>
              </div>
            )}

            {/* Rate info row */}
            {quote && !quoteLoading && toObj && !amountError && (
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">
                  1 {fromObj.code} ~ {(parseFloat(quote.destinationAmount) / amountNum).toFixed(4)}{' '}
                  {toObj.code}
                </p>
                <p className="text-xs text-muted-foreground">
                  Min: {parseFloat(quote.destMin).toFixed(4)} {toObj.code}
                </p>
              </div>
            )}

            {/* Fee row */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Max fee</span>
                <span className="text-foreground font-medium">{activeFeeXlm} XLM</span>
                <FeeBar level={feeLevel(feeTier, customFee, feeStats)} />
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="cursor-pointer flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Settings size={11} />
                Edit
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 pb-5 pt-3 border-t border-border/40">
          {error && (
            <div className="flex items-start gap-2 mb-3 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
              <AlertTriangle size={13} className="text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          <Button className="w-full" onClick={handleReview} disabled={!canReview}>
            {quoteLoading ? 'Getting quote...' : !quote ? 'Get quote' : 'Review swap'}
          </Button>
        </div>
      </div>

      {/* Confirm / Success sheet */}
      <div
        className={`fixed inset-0 z-[70] transition-all duration-300 ${sheetOpen ? '' : 'pointer-events-none'}`}
      >
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${sheetOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => {
            if (!submitLoading && step === 'confirm') {
              setStep('form')
              setError('')
            }
          }}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] transition-transform duration-300 ease-out ${sheetOpen ? 'translate-y-0' : 'translate-y-full'}`}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <p className="text-sm font-semibold text-foreground">
              {step === 'success' ? 'Swap complete' : 'Confirm swap'}
            </p>
            <button
              onClick={() => {
                if (submitLoading) return
                if (step === 'success') navigate('/')
                else {
                  setStep('form')
                  setError('')
                }
              }}
              disabled={submitLoading}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {step === 'success' ? (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 pt-2 text-center">
                  <div className="h-14 w-14 rounded-full bg-green-500/15 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-green-500" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Swap complete</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {lastAmountRef.current} {snapshotFromObj.code} to {snapshotToObj?.code}
                    </p>
                  </div>
                </div>
                {txHash && (
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">Transaction hash</p>
                    <p className="font-mono text-xs text-foreground break-all">{txHash}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
                {txHash && (
                  <Button variant="outline" className="flex-1" asChild>
                    <a
                      href={getExplorerTxUrl(txHash, activeNetwork.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5"
                    >
                      Explorer <ExternalLink size={14} />
                    </a>
                  </Button>
                )}
                <Button className="flex-1" onClick={() => navigate('/')}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {/* Amount hero */}
                <div className="rounded-xl bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <AssetIcon icon={snapshotFrom?.icon} code={snapshotFromObj.code} size={18} />
                      <p className="text-xs text-muted-foreground">{snapshotFromObj.code}</p>
                    </div>
                    <p className="text-xl font-bold text-foreground tabular-nums">
                      {lastAmountRef.current}
                    </p>
                  </div>
                  <div className="relative">
                    <div className="h-px bg-border mx-4" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-card px-1.5">
                        <ArrowDown size={11} className="text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      {snapshotToObj && (
                        <AssetIcon icon={snapshotTo?.icon} code={snapshotToObj.code} size={18} />
                      )}
                      {snapshotToObj && (
                        <p className="text-xs text-muted-foreground">{snapshotToObj.code}</p>
                      )}
                    </div>
                    {quote && (
                      <p className="text-xl font-bold text-green-500 tabular-nums">
                        ~{parseFloat(quote.destinationAmount).toFixed(4)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="rounded-xl bg-card divide-y divide-border">
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">Slippage</p>
                    <p className="text-sm text-foreground">{slippage}%</p>
                  </div>
                  {quote && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <p className="text-xs text-muted-foreground">Min received</p>
                      <p className="text-sm font-mono text-foreground">
                        {parseFloat(quote.destMin).toFixed(7)} {snapshotToObj?.code}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">Max fee</p>
                    <p className="text-sm font-medium text-foreground">{activeFeeXlm} XLM</p>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">Network</p>
                    <p className="text-sm text-foreground">{activeNetwork.name}</p>
                  </div>
                </div>

                {/* Route */}
                {quote && quote.path.length > 0 && (
                  <div className="rounded-xl bg-card px-4 py-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Route</p>
                    <p className="text-xs font-mono text-foreground">
                      {[
                        snapshotFromObj.code,
                        ...quote.path.map((p) => p.assetCode),
                        snapshotToObj?.code,
                      ].join(' > ')}
                    </p>
                  </div>
                )}

                {/* XDR */}
                {quote?.xdr && (
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-0">
                    <button
                      onClick={() => setXdrOpen((p) => !p)}
                      className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground hover:text-foreground w-full py-0.5"
                    >
                      <span>Unsigned XDR</span>
                      {xdrOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {xdrOpen && (
                      <div className="relative rounded-lg bg-muted p-3 mt-2">
                        <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                          {quote.xdr}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(quote!.xdr)
                            setXdrCopied(true)
                            window.setTimeout(() => setXdrCopied(false), 2000)
                          }}
                          className="cursor-pointer absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {xdrCopied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                    <AlertTriangle size={13} className="text-destructive mt-0.5 shrink-0" />
                    <p className="text-xs text-destructive">{error}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setStep('form')
                    setError('')
                  }}
                  disabled={submitLoading}
                >
                  Cancel
                </Button>
                <Button className="flex-1" onClick={handleConfirm} disabled={submitLoading}>
                  {submitLoading ? 'Swapping...' : `Swap ${snapshotFromObj.code}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {showFromPicker && (
        <AssetPickerSheet
          balances={balances}
          selectedKey={fromKey}
          excludeKey={toKey}
          onSelect={(key) => {
            setFromKey(key)
            setQuote(null)
            setError('')
          }}
          onClose={() => setShowFromPicker(false)}
        />
      )}
      {showToPicker && (
        <AssetPickerSheet
          balances={balances}
          selectedKey={toKey}
          excludeKey={fromKey}
          onSelect={(key) => {
            setToKey(key)
            setQuote(null)
            setError('')
          }}
          onClose={() => setShowToPicker(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          feeStats={feeStats}
          feeTier={feeTier}
          customFee={customFee}
          slippage={slippage}
          txTimeout={txTimeout}
          onSave={(tier, fee, slip, t) => {
            setFeeTier(tier)
            setCustomFee(fee)
            setSlippage(slip)
            setTxTimeout(t)
            setShowSettings(false)
            setQuote(null)
          }}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </>
  )
}
