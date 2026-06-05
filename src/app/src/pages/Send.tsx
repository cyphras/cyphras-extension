import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useBalances } from '@/hooks/useBalances'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import {
  ExternalLink,
  Settings,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  CheckCircle2,
  X,
  ArrowDown,
  Search,
} from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { StellarAvatar } from '@/components/StellarAvatar'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import { SERVICE_TYPES } from '@constants/services'
import type { PaymentParams } from '@ext-types/index'
import { fetchPrices } from '@/lib/api'
import type { AssetBalance } from '@/hooks/useBalances'

type Step = 'form' | 'confirm' | 'success'
type FeeTier = 'low' | 'medium' | 'high' | 'custom'

interface FeeStats {
  low: string
  medium: string
  high: string
  congestion: 'Low' | 'Medium' | 'High'
}

interface TxPreview {
  xdr: string
  fee: string
  feeUsd: string | null
  amountUsd: string | null
}

interface HorizonTxDetails {
  ledger: number
  created_at: string
  fee_charged: string
  envelope_xdr: string
}

function isValidPublicKey(key: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(key)
}

function stroopsToXlm(stroops: string): string {
  return (parseInt(stroops) / 10_000_000).toFixed(7)
}

async function checkMemoRequired(horizonUrl: string, destination: string): Promise<boolean> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${destination}`)
    if (!res.ok) return false
    const data = (await res.json()) as { data?: Record<string, string> }
    const val = data.data?.['config.memo_required']
    return val ? atob(val) === '1' : false
  } catch {
    return false
  }
}

async function checkTrustline(
  horizonUrl: string,
  destination: string,
  code: string,
  issuer: string
): Promise<boolean> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${destination}`)
    if (!res.ok) return false
    const data = (await res.json()) as {
      balances: Array<{ asset_code?: string; asset_issuer?: string; asset_type: string }>
    }
    return data.balances.some((b) => b.asset_code === code && b.asset_issuer === issuer)
  } catch {
    return true
  }
}

async function fetchFeeStats(horizonUrl: string): Promise<FeeStats> {
  try {
    const res = await fetch(`${horizonUrl}/fee_stats`)
    if (!res.ok) throw new Error()
    const data = (await res.json()) as {
      max_fee: { mode: string; p10: string; p50: string; p90: string }
      ledger_capacity_usage: string
    }
    const usage = parseFloat(data.ledger_capacity_usage)
    const base = Math.max(parseInt(data.max_fee.p10) || 100, 100)
    const mid = Math.max(parseInt(data.max_fee.mode) || 100, base * 5)
    const fast = Math.max(parseInt(data.max_fee.p90) || 100, base * 20)
    return {
      low: base.toString(),
      medium: mid.toString(),
      high: fast.toString(),
      congestion: usage > 0.75 ? 'High' : usage > 0.5 ? 'Medium' : 'Low',
    }
  } catch {
    return { low: '100', medium: '500', high: '2000', congestion: 'Low' }
  }
}

function feeLevel(tier: FeeTier, customFeeStr: string, feeStats: FeeStats): 1 | 2 | 3 {
  if (tier === 'low') return 1
  if (tier === 'medium') return 2
  if (tier === 'high') return 3
  const fee = parseInt(customFeeStr) || 0
  if (fee >= parseInt(feeStats.high)) return 3
  if (fee >= parseInt(feeStats.medium)) return 2
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
  onSelect,
  onClose,
}: {
  balances: AssetBalance[]
  selectedKey: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = balances.filter((b) => {
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
        {balances.length > 4 && (
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
            const isSelected = key === selectedKey
            return (
              <button
                key={key}
                onClick={() => {
                  onSelect(key)
                  onClose()
                }}
                className={`cursor-pointer flex items-center gap-3 w-full rounded-xl px-3 py-3 text-left transition-colors ${isSelected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted border border-transparent'}`}
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
                <div className="text-right shrink-0">
                  <p className="text-sm text-foreground tabular-nums">
                    {parseFloat(b.balance).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </p>
                  {b.usdValue !== null && (
                    <p className="text-xs text-muted-foreground">
                      {b.usdValue.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SettingsModal({
  feeStats,
  feeTier,
  customFee,
  timeout,
  onSave,
  onCancel,
}: {
  feeStats: FeeStats
  feeTier: FeeTier
  customFee: string
  timeout: number
  onSave: (tier: FeeTier, customFee: string, timeout: number) => void
  onCancel: () => void
}) {
  const [localTier, setLocalTier] = useState<FeeTier>(feeTier)
  const [localCustomFee, setLocalCustomFee] = useState(customFee)
  const [localTimeout, setLocalTimeout] = useState(timeout)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true))
  }, [])

  function handleClose() {
    setIsOpen(false)
    setTimeout(onCancel, 280)
  }

  const customNum = parseInt(localCustomFee)
  const customError =
    localTier === 'custom'
      ? !localCustomFee.trim()
        ? 'Enter a fee amount'
        : isNaN(customNum)
          ? 'Must be a whole number'
          : customNum <= 0
            ? 'Must be greater than 0'
            : customNum < 100
              ? 'Minimum is 100 stroops'
              : null
      : null

  const canSave = customError === null

  const presetFee =
    localTier !== 'custom' ? feeStats[localTier as Exclude<FeeTier, 'custom'>] : null
  const displayFee =
    localTier === 'custom'
      ? !localCustomFee.trim() || isNaN(customNum) || customNum <= 0
        ? '-'
        : `${stroopsToXlm(localCustomFee)} XLM`
      : presetFee
        ? `${stroopsToXlm(presetFee)} XLM`
        : '-'

  function handleCustomChange(val: string) {
    // Strip decimals - Stellar fees must be whole stroops
    const clean = val.replace(/[^0-9]/g, '')
    setLocalCustomFee(clean)
    setLocalTier('custom')
  }

  function handleSave() {
    if (!canSave) return
    const fee =
      localTier === 'custom'
        ? Math.max(100, customNum).toString()
        : feeStats[localTier as Exclude<FeeTier, 'custom'>]
    onSave(localTier, fee, localTimeout)
  }

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
          <p className="text-sm font-semibold text-foreground">Send settings</p>
          <button
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-5">
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
                  value={localTier === 'custom' ? localCustomFee : ''}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  onFocus={() => {
                    if (localTier !== 'custom') setLocalTier('custom')
                  }}
                  className="flex-1 py-2.5 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
                />
                {localTier === 'custom' &&
                  localCustomFee &&
                  !isNaN(customNum) &&
                  customNum >= 100 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {stroopsToXlm(localCustomFee)} XLM
                    </span>
                  )}
              </div>
              {customError && <p className="text-xs text-destructive px-1">{customError}</p>}
            </div>
          </div>

          {/* Transaction timeout */}
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

          <Button className="w-full" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function Send() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { balances, refresh: refreshBalances } = useBalances(status.publicKey)
  const { getExplorerTxUrl, formatValue } = usePreferences()

  const [step, setStep] = useState<Step>('form')
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  // Key = "CODE:ISSUER" (XLM = "XLM:")
  const [selectedAssetKey, setSelectedAssetKey] = useState('XLM:')
  const [memo, setMemo] = useState('')
  const [memoType, setMemoType] = useState<'text' | 'id'>('text')
  const [memoRequired, setMemoRequired] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  const [feeStats, setFeeStats] = useState<FeeStats>({
    low: '100',
    medium: '1000',
    high: '10000',
    congestion: 'Low',
  })
  const [feeTier, setFeeTier] = useState<FeeTier>('medium')
  const [customFee, setCustomFee] = useState('')
  const [txTimeout, setTxTimeout] = useState(180)
  const [txPreview, setTxPreview] = useState<TxPreview | null>(null)

  const [confirmXdrOpen, setConfirmXdrOpen] = useState(false)
  const [successXdrOpen, setSuccessXdrOpen] = useState(false)
  const [txHashCopied, setTxHashCopied] = useState(false)
  const [confirmXdrCopied, setConfirmXdrCopied] = useState(false)
  const [successXdrCopied, setSuccessXdrCopied] = useState(false)
  const [sendTxDetails, setSendTxDetails] = useState<HorizonTxDetails | null>(null)

  const [destinationFocused, setDestinationFocused] = useState(false)
  const destinationInputRef = useRef<HTMLInputElement>(null)

  const lastPreviewRef = useRef<TxPreview | null>(null)
  const lastDestRef = useRef('')
  if (txPreview) lastPreviewRef.current = txPreview
  if (destination) lastDestRef.current = destination

  useEffect(() => {
    fetchFeeStats(activeNetwork.horizonUrl).then(setFeeStats)
  }, [activeNetwork.horizonUrl])

  useEffect(() => {
    if (step !== 'success' || !txHash) return
    setSendTxDetails(null)
    fetch(`${activeNetwork.horizonUrl}/transactions/${txHash}`)
      .then((r) => r.json())
      .then((data: HorizonTxDetails) => setSendTxDetails(data))
      .catch(() => {})
  }, [step, txHash, activeNetwork.horizonUrl])

  // Sync selected asset key when balances load (in case default XLM is not the first)
  useEffect(() => {
    if (
      balances.length > 0 &&
      !balances.find((b) => `${b.code}:${b.issuer}` === selectedAssetKey)
    ) {
      const xlm = balances.find((b) => b.isNative)
      if (xlm) setSelectedAssetKey(`${xlm.code}:${xlm.issuer}`)
    }
  }, [balances])

  const selectedBalance = balances.find((b) => `${b.code}:${b.issuer}` === selectedAssetKey)
  const selectedAssetObj = {
    code: selectedBalance?.code ?? 'XLM',
    issuer: selectedBalance?.issuer ?? '',
    icon: selectedBalance?.icon,
    isNative: selectedBalance?.isNative ?? true,
  }

  const activeFeeStroops = feeTier === 'custom' ? customFee || feeStats.medium : feeStats[feeTier]
  const activeFeeXlm = stroopsToXlm(activeFeeStroops)

  async function handleContinue() {
    setError('')
    if (!isValidPublicKey(destination)) {
      setError('Invalid destination address')
      return
    }
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Invalid amount')
      return
    }
    if (selectedBalance && amountNum > parseFloat(selectedBalance.balance)) {
      setError('Insufficient balance')
      return
    }

    setLoading(true)

    if (!selectedAssetObj.isNative) {
      const hasTrustline = await checkTrustline(
        activeNetwork.horizonUrl,
        destination,
        selectedAssetObj.code,
        selectedAssetObj.issuer
      )
      if (!hasTrustline) {
        setLoading(false)
        setError(`Destination has no trustline for ${selectedAssetObj.code}`)
        return
      }
    }

    if (!memo) {
      const required = await checkMemoRequired(activeNetwork.horizonUrl, destination)
      if (required) {
        setLoading(false)
        setMemoRequired(true)
        setError('This account requires a memo')
        return
      }
    }

    const { prices } = await fetchPrices(['XLM', selectedAssetObj.code])
    const xlmPrice = prices['XLM'] ?? null
    const assetPrice = prices[selectedAssetObj.code] ?? null
    const feeUsd = xlmPrice !== null ? formatValue(parseFloat(activeFeeXlm) * xlmPrice) : null
    const amountUsd = assetPrice !== null ? formatValue(amountNum * assetPrice) : null
    const payment: PaymentParams = {
      destination,
      amount,
      assetCode: selectedAssetObj.code,
      assetIssuer: selectedAssetObj.issuer,
      memo: memo || undefined,
      memoType: memo ? memoType : undefined,
      fee: activeFeeStroops,
      timeout: txTimeout,
    }
    chrome.runtime.sendMessage(
      {
        type: SERVICE_TYPES.BUILD_PAYMENT_XDR,
        payment,
        horizonUrl: activeNetwork.horizonUrl,
        networkPassphrase: activeNetwork.passphrase,
      },
      (response) => {
        setLoading(false)
        if (response?.error) {
          setError(response.error)
          return
        }
        setTxPreview({ xdr: response.xdr, fee: activeFeeXlm, feeUsd, amountUsd })
        setConfirmXdrOpen(false)
        setStep('confirm')
      }
    )
  }

  async function handleConfirm() {
    setLoading(true)
    setError('')
    const payment: PaymentParams = {
      destination,
      amount,
      assetCode: selectedAssetObj.code,
      assetIssuer: selectedAssetObj.issuer,
      memo: memo || undefined,
      memoType: memo ? memoType : undefined,
      fee: activeFeeStroops,
      timeout: txTimeout,
    }
    chrome.runtime.sendMessage(
      {
        type: SERVICE_TYPES.SIGN_AND_SUBMIT_PAYMENT,
        payment,
        horizonUrl: activeNetwork.horizonUrl,
        networkPassphrase: activeNetwork.passphrase,
      },
      (response) => {
        setLoading(false)
        if (response?.error) {
          setError(response.error)
          return
        }
        setTxHash(response.txHash ?? '')
        setSuccessXdrOpen(false)
        refreshBalances()
        setStep('success')
      }
    )
  }

  const sheetOpen = step === 'confirm' || step === 'success'
  const shortDest = lastDestRef.current
    ? `${lastDestRef.current.slice(0, 4)}...${lastDestRef.current.slice(-4)}`
    : ''

  function focusDestination() {
    setDestinationFocused(true)
    setTimeout(() => destinationInputRef.current?.focus(), 10)
  }

  function clearDestination() {
    setDestination('')
    setDestinationFocused(true)
    setTimeout(() => destinationInputRef.current?.focus(), 10)
  }

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
          <WalletNavbar />
        </div>

        {/* Scrollable form area */}
        <div className="flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-4 py-4">
            {/* Header */}
            <div className="relative flex items-center justify-center">
              <button
                onClick={() => navigate(-1)}
                className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-bold text-foreground">Send</h2>
            </div>

            {/* Amount + asset card */}
            <div className="rounded-xl bg-card p-4 flex flex-col gap-3">
              <button
                onClick={() => setShowAssetPicker(true)}
                className="cursor-pointer self-start flex items-center gap-2 rounded-xl bg-muted px-3 py-2 hover:bg-muted/70 transition-colors"
              >
                <AssetIcon icon={selectedAssetObj.icon} code={selectedAssetObj.code} size={22} />
                <span className="text-sm font-semibold text-foreground">
                  {selectedAssetObj.code}
                </span>
                {!selectedAssetObj.isNative && (
                  <span className="text-xs font-mono text-muted-foreground">
                    {selectedAssetObj.issuer.slice(0, 4)}...{selectedAssetObj.issuer.slice(-4)}
                  </span>
                )}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>

              <input
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-4xl font-bold bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {selectedBalance
                    ? `Balance: ${parseFloat(selectedBalance.balance).toLocaleString('en-US', { maximumFractionDigits: 7 })} ${selectedAssetObj.code}`
                    : 'Balance: -'}
                </p>
                {selectedBalance && (
                  <button
                    onClick={() => {
                      const max = selectedAssetObj.isNative
                        ? Math.max(0, parseFloat(selectedBalance.balance) - 1).toFixed(7)
                        : selectedBalance.balance
                      setAmount(max)
                    }}
                    className="cursor-pointer text-xs font-medium text-primary hover:underline"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            {/* Destination */}
            <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">To</p>
              {isValidPublicKey(destination) && !destinationFocused ? (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={focusDestination}
                    className="cursor-pointer flex items-center gap-2 min-w-0"
                  >
                    <StellarAvatar publicKey={destination} size={22} />
                    <span className="text-sm font-mono text-foreground">
                      {destination.slice(0, 4)}...{destination.slice(-4)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={clearDestination}
                    className="cursor-pointer shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 ml-2"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={destinationInputRef}
                    type="text"
                    placeholder="G... Stellar address"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value.trim())}
                    onFocus={() => setDestinationFocused(true)}
                    onBlur={() => setDestinationFocused(false)}
                    className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
              )}
            </div>

            {/* Memo */}
            <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Memo{memoRequired && <span className="ml-1 text-destructive">*</span>}
                </p>
                <div className="flex rounded-md overflow-hidden bg-muted text-xs">
                  {(['text', 'id'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMemoType(t)}
                      className={`cursor-pointer px-2.5 py-1 font-medium transition-colors ${memoType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {t === 'text' ? 'Text' : 'ID'}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type={memoType === 'id' ? 'number' : 'text'}
                placeholder={memoRequired ? 'Required for this account' : 'Optional'}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={memoType === 'text' ? 28 : undefined}
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
              />
              {memoType === 'text' && memo && (
                <p className="text-xs text-muted-foreground text-right">{memo.length}/28</p>
              )}
            </div>

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

        {/* Fixed footer: error + Continue button */}
        <div className="shrink-0 px-5 pb-5 pt-3 border-t border-border/40">
          {error && <p className="text-xs text-destructive mb-3">{error}</p>}
          <Button className="w-full" onClick={handleContinue} disabled={loading}>
            {loading ? 'Preparing...' : 'Continue'}
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
            if (!loading && step === 'confirm') {
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
              {step === 'success' ? 'Transaction Sent' : 'Confirm Send'}
            </p>
            <button
              onClick={() => {
                if (loading) return
                if (step === 'success') navigate('/')
                else {
                  setStep('form')
                  setError('')
                }
              }}
              disabled={loading}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {step === 'success' ? (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 text-center pt-1">
                  <div className="h-14 w-14 rounded-full bg-green-500/15 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-green-500" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Payment sent</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {amount} {selectedAssetObj.code} to {shortDest}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Transaction hash</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(txHash)
                        setTxHashCopied(true)
                        window.setTimeout(() => setTxHashCopied(false), 2000)
                      }}
                      className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {txHashCopied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <p className="font-mono text-xs text-foreground break-all">{txHash}</p>
                </div>

                <AutoSkeleton loading={!sendTxDetails}>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Ledger</p>
                    <p className="text-sm font-mono text-foreground">
                      #{sendTxDetails?.ledger.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Timestamp</p>
                    <p className="text-sm text-foreground">
                      {sendTxDetails?.created_at
                        ? new Date(sendTxDetails.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Fee charged</p>
                    <p className="text-sm text-foreground">
                      {sendTxDetails?.fee_charged
                        ? stroopsToXlm(sendTxDetails.fee_charged) + ' XLM'
                        : '-'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Network</p>
                    <p className="text-sm text-foreground">{activeNetwork.name}</p>
                  </div>

                  {/* Operations */}
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
                    <p className="text-xs font-medium text-foreground">Operations (1)</p>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Type</span>
                      <span className="text-xs font-mono text-foreground">payment</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground shrink-0">Asset</span>
                      <div className="flex items-center gap-1.5">
                        <AssetIcon
                          icon={selectedAssetObj.icon}
                          code={selectedAssetObj.code}
                          size={14}
                        />
                        <span className="text-xs font-mono font-medium text-foreground">
                          {selectedAssetObj.code}
                        </span>
                      </div>
                    </div>
                    {selectedAssetObj.issuer && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground shrink-0">Issuer</span>
                        <div className="flex items-center gap-1.5">
                          <StellarAvatar publicKey={selectedAssetObj.issuer} size={14} />
                          <span className="text-xs font-mono text-foreground">
                            {selectedAssetObj.issuer.slice(0, 4)}...
                            {selectedAssetObj.issuer.slice(-4)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground shrink-0">From</span>
                      <div className="flex items-center gap-1.5">
                        {status.publicKey && (
                          <StellarAvatar publicKey={status.publicKey} size={14} />
                        )}
                        <span className="text-xs font-mono text-foreground">
                          {status.publicKey
                            ? `${status.publicKey.slice(0, 4)}...${status.publicKey.slice(-4)}`
                            : '-'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground shrink-0">To</span>
                      <div className="flex items-center gap-1.5">
                        {lastDestRef.current && (
                          <StellarAvatar publicKey={lastDestRef.current} size={14} />
                        )}
                        <span className="text-xs font-mono text-foreground">{shortDest}</span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Amount</span>
                      <span className="text-xs font-mono font-medium text-foreground">
                        {parseFloat(amount).toFixed(7)}
                      </span>
                    </div>
                    {memo && (
                      <div className="flex justify-between gap-4">
                        <span className="text-xs text-muted-foreground shrink-0">Memo</span>
                        <span className="text-xs text-foreground text-right">
                          {memoType.toUpperCase()}: {memo}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Envelope XDR */}
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-0">
                    <button
                      onClick={() => setSuccessXdrOpen((p) => !p)}
                      className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground hover:text-foreground w-full py-0.5"
                    >
                      <span>Envelope XDR</span>
                      {successXdrOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {successXdrOpen && sendTxDetails?.envelope_xdr && (
                      <div className="relative rounded-lg bg-muted p-3 mt-2">
                        <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                          {sendTxDetails.envelope_xdr}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(sendTxDetails.envelope_xdr)
                            setSuccessXdrCopied(true)
                            window.setTimeout(() => setSuccessXdrCopied(false), 2000)
                          }}
                          className="cursor-pointer absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {successXdrCopied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                </AutoSkeleton>
              </div>
              <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
                <Button variant="outline" className="flex-1" asChild>
                  <a
                    href={getExplorerTxUrl(txHash, activeNetwork.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5"
                  >
                    View on explorer <ExternalLink size={14} />
                  </a>
                </Button>
                <Button className="flex-1" onClick={() => navigate('/')}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {/* Amount hero */}
                <div className="rounded-xl bg-card px-4 py-3 flex items-center gap-3">
                  <AssetIcon icon={selectedAssetObj.icon} code={selectedAssetObj.code} size={36} />
                  <div className="flex flex-col min-w-0">
                    <p className="text-2xl font-bold text-foreground tabular-nums">
                      {amount} {selectedAssetObj.code}
                    </p>
                    <div className="flex items-center gap-2">
                      {lastPreviewRef.current?.amountUsd && (
                        <p className="text-xs text-muted-foreground">
                          {lastPreviewRef.current.amountUsd}
                        </p>
                      )}
                      {!selectedAssetObj.isNative && (
                        <p className="text-xs font-mono text-muted-foreground/60 truncate">
                          {selectedAssetObj.issuer.slice(0, 4)}...
                          {selectedAssetObj.issuer.slice(-4)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* From -> To */}
                <div className="rounded-xl bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">From</p>
                    <div className="flex items-center gap-2">
                      {status.publicKey && <StellarAvatar publicKey={status.publicKey} size={16} />}
                      <p className="text-xs font-mono text-foreground">
                        {status.publicKey
                          ? `${status.publicKey.slice(0, 4)}...${status.publicKey.slice(-4)}`
                          : '-'}
                      </p>
                    </div>
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
                    <p className="text-xs text-muted-foreground">To</p>
                    <div className="flex items-center gap-2">
                      {destination && <StellarAvatar publicKey={destination} size={16} />}
                      <p className="text-xs font-mono text-foreground">{shortDest}</p>
                    </div>
                  </div>
                </div>

                {/* Details row */}
                <div className="rounded-xl bg-card divide-y divide-border">
                  {memo && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <p className="text-xs text-muted-foreground">Memo</p>
                      <p className="text-sm text-foreground">
                        {memoType.toUpperCase()}: {memo}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">Network</p>
                    <p className="text-sm text-foreground">{activeNetwork.name}</p>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-muted-foreground">Max fee</p>
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">
                        {lastPreviewRef.current?.fee ?? activeFeeXlm} XLM
                      </p>
                      {lastPreviewRef.current?.feeUsd && (
                        <p className="text-xs text-muted-foreground">
                          {lastPreviewRef.current.feeUsd}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Operations (collapsible) */}
                {lastPreviewRef.current?.xdr && (
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-0">
                    <button
                      onClick={() => setConfirmXdrOpen((p) => !p)}
                      className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground hover:text-foreground w-full py-0.5"
                    >
                      <span>Unsigned XDR</span>
                      {confirmXdrOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {confirmXdrOpen && (
                      <div className="relative rounded-lg bg-muted p-3 mt-2">
                        <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                          {lastPreviewRef.current.xdr}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(lastPreviewRef.current!.xdr)
                            setConfirmXdrCopied(true)
                            window.setTimeout(() => setConfirmXdrCopied(false), 2000)
                          }}
                          className="cursor-pointer absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {confirmXdrCopied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
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
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button className="flex-1" onClick={handleConfirm} disabled={loading}>
                  {loading ? 'Sending...' : `Send ${amount} ${selectedAssetObj.code}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAssetPicker && (
        <AssetPickerSheet
          balances={balances}
          selectedKey={selectedAssetKey}
          onSelect={setSelectedAssetKey}
          onClose={() => setShowAssetPicker(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          feeStats={feeStats}
          feeTier={feeTier}
          customFee={customFee}
          timeout={txTimeout}
          onSave={(tier, fee, t) => {
            setFeeTier(tier)
            setCustomFee(fee)
            setTxTimeout(t)
            setShowSettings(false)
          }}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </>
  )
}
