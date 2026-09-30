import { useState, useEffect, useCallback, useRef } from 'react'
import { useAssetList } from '@/hooks/useAssetList'
import { useVerifiedAssets } from '@/hooks/useVerifiedAssets'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { Collapse } from '@/components/Collapse'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { usePreferences } from '@/context/PreferencesContext'
import { useBalances } from '@/hooks/useBalances'
import { Button } from '@/components/ui/button'
import {
  SideCard,
  AmountInput,
  AmountValue,
  QuickFillChips,
  FlipButton,
} from '@/components/PairCard'
import { AssetPickerSheet, type PickerItem } from '@/components/AssetPickerSheet'
import { getChainIcons } from '@/lib/chainInfo'
import { formatFiat } from '@/lib/activity'
import {
  parseUnits,
  formatUnits,
  fractionUnits,
  formatBalanceText,
  formatSignificant,
  spendableUnits,
  truncateDecimals,
} from '@/lib/amount'
import {
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
  AlertTriangle,
  ArrowLeftRight,
  ChevronRight,
} from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { SERVICE_TYPES } from '@constants/services'
import { chainById } from '@constants/chains'
import type { SwapQuote } from '@ext-types/index'
import { CopyValue, DetailRow, NetworkValue } from '@/components/TxDetailParts'
import { RoutePath } from '@/components/BrandMarks'
import { useStellarChain } from '@/hooks/useStellarChain'

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

const SLIPPAGE_PRESETS = ['0.5', '1', '2', '3']

// Picker keys for tokens the user does not hold yet (no trustline).
const ADD_PREFIX = 'add:'

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
  // Stellar is home: the bridge hint invites USDC in from the EVM side.
  const evmChainName =
    chainById(activeNetwork.id === 'testnet' ? 'eip155:11155111' : 'eip155:1')?.name ?? 'Ethereum'
  const stellarChain = useStellarChain()
  const {
    balances: allBalances,
    loading: balancesLoading,
    isFunded,
  } = useBalances(status.publicKey)
  // The swap engine is Stellar DEX path payments; EVM assets never enter it.
  const balances = allBalances.filter((b) => !b.chain.startsWith('eip155'))
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
  // What the path payment actually delivered, read back from Horizon once confirmed.
  const [received, setReceived] = useState('')
  useEffect(() => {
    if (!txHash) return
    let cancelled = false
    setReceived('')
    fetch(`${activeNetwork.horizonUrl}/transactions/${txHash}/operations`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { _embedded?: { records?: Array<{ type: string; amount?: string }> } } | null) => {
        const op = d?._embedded?.records?.find((o) => o.type.startsWith('path_payment'))
        if (!cancelled && op?.amount) setReceived(op.amount)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [txHash, activeNetwork.horizonUrl])

  const [showSettings, setShowSettings] = useState(false)
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)

  const [slippage, setSlippage] = useState('1')
  const [feeTier, setFeeTier] = useState<FeeTier>('medium')
  const [customFee, setCustomFee] = useState('')
  const [txTimeout, setTxTimeout] = useState(180)
  const [feeStats, setFeeStats] = useState<FeeStats>({ low: '100', medium: '500', high: '2000' })

  const [xdrOpen, setXdrOpen] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const isVerified = useVerifiedAssets()
  const { assets: curated } = useAssetList()
  const [stellarIcon, setStellarIcon] = useState<string | undefined>(undefined)
  useEffect(() => {
    const id = activeNetwork.id === 'testnet' ? 'stellar:testnet' : 'stellar:pubnet'
    let cancelled = false
    getChainIcons([id]).then((icons) => {
      if (!cancelled) setStellarIcon(icons.get(id))
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])
  const [xdrCopied, setXdrCopied] = useState(false)

  const lastFromKeyRef = useRef(fromKey)
  const lastToKeyRef = useRef(toKey)
  const lastAmountRef = useRef(amount)
  if (fromKey) lastFromKeyRef.current = fromKey
  if (toKey) lastToKeyRef.current = toKey
  if (amount) lastAmountRef.current = amount
  // The quote keeps refreshing after submit; the success screen shows what was confirmed.
  const lastReceivedRef = useRef('')

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

  // Pre-fill "To" once with the likeliest pair (a held verified USDC first),
  // and only while nothing is picked, so it never overrides a choice.
  const autoPickedTo = useRef(false)
  useEffect(() => {
    if (autoPickedTo.current || toKey || balances.length === 0) return
    autoPickedTo.current = true
    const others = balances.filter((b) => `${b.code}:${b.issuer}` !== fromKey)
    const pick =
      others.find((b) => b.code === 'USDC' && isVerified(b.code, b.issuer)) ??
      others.find((b) => isVerified(b.code, b.issuer)) ??
      others[0]
    if (pick) setToKey(`${pick.code}:${pick.issuer}`)
  }, [balances, fromKey, toKey, isVerified])

  const fromBalance = balances.find((b) => `${b.code}:${b.issuer}` === fromKey)
  const toBalance = balances.find((b) => `${b.code}:${b.issuer}` === toKey)
  const fromObj = parseKey(fromKey)
  const toObj = toKey ? parseKey(toKey) : null

  const activeFeeStroops = feeTier === 'custom' ? customFee || feeStats.medium : feeStats[feeTier]
  const activeFeeXlm = stroopsToXlm(activeFeeStroops)

  const amountNum = parseFloat(amount)
  // What can leave: the account reserve (grows 0.5 XLM per trustline or offer)
  // and open-offer liabilities stay behind, plus the fee when selling XLM.
  const feeUnits = BigInt(activeFeeStroops)
  const spendable = fromBalance
    ? spendableUnits(
        fromBalance.balance,
        fromBalance.decimals,
        fromBalance.locked,
        fromBalance.isNative ? feeUnits : 0n
      )
    : 0n
  const xlmBalance = balances.find((b) => b.isNative)
  const xlmFree = xlmBalance ? spendableUnits(xlmBalance.balance, 7, xlmBalance.locked) : 0n
  const amountUnits = fromBalance
    ? parseUnits(truncateDecimals(amount || '0', fromBalance.decimals), fromBalance.decimals)
    : null

  // Quick fills work in base units so the reserve, fee and asset decimals are
  // respected exactly, with no float rounding.
  const setSwapAmount = (value: string) => {
    setAmount(value)
    setQuote(null)
    setError('')
  }
  const fillSwapFraction = (fraction: number) => {
    if (!fromBalance) return
    setSwapAmount(formatUnits(fractionUnits(spendable, fraction), fromBalance.decimals))
  }

  const amountError: string | null = (() => {
    if (!amount || amountNum <= 0) return null
    if (fromKey === toKey) return 'Cannot swap an asset with itself'
    if (!fromBalance) return null // balances still loading
    if (amountUnits !== null && amountUnits > spendable) {
      return `You can swap up to ${formatUnits(spendable, fromBalance.decimals)} ${fromObj.code}${
        fromBalance.isNative ? ' (the rest is the account reserve and the fee)' : ''
      }`
    }
    if (!fromBalance.isNative && xlmFree < feeUnits) return 'Not enough XLM for the network fee'
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

  // Going rate for 1 unit of the From asset, read straight from Horizon's
  // path finder: shown before an amount exists. undefined = loading, null = no route.
  const [spotRate, setSpotRate] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!fromKey || !toKey || fromKey === toKey) return
    const assetParams = (key: string, prefix: string) => {
      const a = parseKey(key)
      if (!a.issuer) return `${prefix}_asset_type=native`
      const type = a.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12'
      return `${prefix}_asset_type=${type}&${prefix}_asset_code=${a.code}&${prefix}_asset_issuer=${a.issuer}`
    }
    const to = parseKey(toKey)
    const dest = to.issuer ? `${to.code}:${to.issuer}` : 'native'
    let cancelled = false
    setSpotRate(undefined)
    fetch(
      `${activeNetwork.horizonUrl}/paths/strict-send?${assetParams(fromKey, 'source')}&source_amount=1&destination_assets=${encodeURIComponent(dest)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { _embedded?: { records?: Array<{ destination_amount: string }> } } | null) => {
        if (cancelled) return
        const best = (d?._embedded?.records ?? [])
          .map((r) => r.destination_amount)
          .sort((x, y) => parseFloat(y) - parseFloat(x))[0]
        setSpotRate(best ?? null)
      })
      .catch(() => {
        if (!cancelled) setSpotRate(null)
      })
    return () => {
      cancelled = true
    }
  }, [fromKey, toKey, activeNetwork.horizonUrl])

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

  function handleConfirm() {
    if (!toKey) return
    const from = parseKey(fromKey)
    const to = parseKey(toKey)
    setSubmitLoading(true)
    lastReceivedRef.current = quote?.destinationAmount ?? ''
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

  const trimAmount = (v: string) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 7 }) : v
  }
  // The big figure only has room for a few decimals; the exact value is in
  // "Min received" and the review sheet.
  const displayAmount = (v: string) => {
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return v
    return n >= 1
      ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : n.toLocaleString('en-US', { maximumSignificantDigits: 6 })
  }
  // Each picker leaves out the asset the other side already uses: a pair of
  // the same token is not a swap, and the flip button covers reversing.
  const pickerItems = (otherKey: string, sectioned: boolean): PickerItem[] =>
    balances
      .filter((b) => `${b.code}:${b.issuer}` !== otherKey)
      .map((b) => {
        const key = `${b.code}:${b.issuer}`
        return {
          section: sectioned ? 'Your assets' : undefined,
          key,
          code: b.code,
          name: b.name ?? (b.isNative ? 'Stellar Lumens' : undefined),
          icon: b.icon,
          chainName: 'Stellar',
          chainIcon: stellarIcon,
          balance: parseFloat(b.balance).toLocaleString('en-US', { maximumFractionDigits: 4 }),
          fiat: b.usdValue != null ? formatFiat(b.usdValue) : null,
          verified: b.verified,
        }
      })
  const heldKeys = new Set(balances.map((b) => `${b.code}:${b.issuer}`))
  // Two tokens can share a code (testnet has two USDC issuers); such rows name
  // their issuer, by domain when the list knows it, so they never read alike.
  const issuerLabel = (key: string) => {
    const { code, issuer } = parseKey(
      key.startsWith(ADD_PREFIX) ? key.slice(ADD_PREFIX.length) : key
    )
    const listed = curated.find((a) => a.code === code && a.issuer === issuer)
    return listed?.domain || (issuer ? `${issuer.slice(0, 4)}...${issuer.slice(-4)}` : '')
  }
  const disambiguate = (items: PickerItem[]): PickerItem[] => {
    const counts = new Map<string, number>()
    for (const i of items) counts.set(i.code, (counts.get(i.code) ?? 0) + 1)
    return items.map((i) =>
      (counts.get(i.code) ?? 0) > 1 ? { ...i, name: issuerLabel(i.key) } : i
    )
  }
  // Verified tokens the user could receive once they add a trustline; held
  // ones are already listed above.
  const receiveSuggestions: PickerItem[] = curated
    .filter((a) => !heldKeys.has(`${a.code}:${a.issuer}`) && isVerified(a.code, a.issuer))
    .slice(0, 8)
    .map((a) => ({
      key: `${ADD_PREFIX}${a.code}:${a.issuer}`,
      code: a.code,
      name: a.name,
      icon: a.icon,
      chainName: 'Stellar',
      chainIcon: stellarIcon,
      balance: 'Add',
      hint: 'Needs trustline',
      verified: true,
      section: 'Add to receive',
    }))
  const fromFiat =
    fromBalance?.usdPrice != null
      ? formatFiat(!isNaN(amountNum) && amountNum > 0 ? amountNum * fromBalance.usdPrice : 0)
      : ''
  const toFiat =
    toBalance?.usdPrice != null
      ? formatFiat(quote ? parseFloat(quote.destinationAmount) * toBalance.usdPrice : 0)
      : ''
  const rate = quote && amountNum > 0 ? parseFloat(quote.destinationAmount) / amountNum : null

  // The button says what is missing, in the order a user fixes things.
  const cta: { label: string; enabled: boolean } =
    !isFunded && !balancesLoading
      ? { label: 'Activate the account first', enabled: false }
      : !toKey
        ? { label: 'Select an asset', enabled: false }
        : !amount || !(amountNum > 0)
          ? { label: 'Enter an amount', enabled: false }
          : fromKey === toKey
            ? { label: 'Pick two different assets', enabled: false }
            : amountError
              ? {
                  label: amountError.startsWith('Not enough XLM')
                    ? 'Not enough XLM for fees'
                    : `Insufficient ${fromObj.code}`,
                  enabled: false,
                }
              : quoteLoading
                ? { label: 'Getting quote...', enabled: false }
                : !quote
                  ? { label: error ? 'No route for this pair' : 'Getting quote...', enabled: false }
                  : { label: 'Review swap', enabled: true }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 bg-background">
        <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
          <WalletNavbar />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5">
          <div className="flex flex-col gap-2.5 py-5">
            <div className="relative mb-0.5 flex items-center justify-center">
              <button
                onClick={() => navigate(-1)}
                aria-label="Go back"
                className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-center leading-tight">
                <h2 className="text-lg font-bold text-foreground">Swap</h2>
                <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                  {stellarIcon && <img src={stellarIcon} alt="" className="h-3 w-3 rounded-full" />}
                  Stellar assets on the Stellar DEX
                </p>
              </div>
            </div>

            {!balancesLoading && !isFunded && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle size={14} className="mt-px shrink-0 text-amber-500" />
                <p className="text-[11px] leading-snug text-foreground">
                  Send at least 1 XLM to this account to activate it before swapping.
                </p>
              </div>
            )}

            <div className="relative flex flex-col gap-1.5">
              <SideCard
                label="From"
                corner={
                  fromBalance
                    ? formatBalanceText(fromBalance.balance, fromObj.code, fromBalance.decimals)
                    : balancesLoading
                      ? 'Loading...'
                      : 'Balance: 0'
                }
                chip={{
                  code: fromObj.code,
                  issuer: fromObj.issuer,
                  icon: fromBalance?.icon,
                  chainIcon: stellarIcon,
                  subLabel: 'Stellar',
                  onPick: () => setShowFromPicker(true),
                  ariaLabel: 'Select asset to swap from',
                }}
                value={<AmountInput value={amount} onChange={setSwapAmount} />}
                footAmount={fromFiat}
                footAsset={fromBalance ? <QuickFillChips onFill={fillSwapFraction} /> : null}
                error={amountError && fromKey !== toKey ? amountError : null}
              />

              <FlipButton onClick={handleSwapAssets} disabled={!toKey} />

              <SideCard
                label="To"
                corner={
                  toBalance
                    ? formatBalanceText(toBalance.balance, toBalance.code, toBalance.decimals)
                    : ''
                }
                chip={{
                  code: toObj?.code,
                  issuer: toObj?.issuer,
                  icon: toBalance?.icon,
                  chainIcon: stellarIcon,
                  subLabel: toObj ? 'Stellar' : undefined,
                  onPick: () => setShowToPicker(true),
                  ariaLabel: 'Select asset to receive',
                }}
                value={
                  <AmountValue
                    text={
                      quote ? displayAmount(quote.destinationAmount) : quoteLoading ? '...' : '0'
                    }
                    muted={!quote}
                  />
                }
                footAmount={toFiat}
                footAsset={quote && toObj ? `Min ${trimAmount(quote.destMin)} ${toObj.code}` : ''}
              />
            </div>

            {quote && toObj && !quoteLoading && (
              <div className="rounded-xl bg-card">
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                  className="cursor-pointer flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
                >
                  <span className="min-w-0 text-xs">
                    <span className="block font-medium text-foreground">
                      1 {fromObj.code} = {rate !== null ? trimAmount(rate.toPrecision(6)) : '-'}{' '}
                      {toObj.code}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {slippage}% slippage, fee up to {formatSignificant(activeFeeXlm)} XLM
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
                    Details
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>
                <Collapse open={showDetails}>
                  <div className="flex flex-col divide-y divide-border/60 border-t border-border/60 px-4 text-xs">
                    <div className="flex items-center justify-between py-2.5">
                      <span className="text-muted-foreground">Minimum received</span>
                      <span className="font-medium text-foreground">
                        {trimAmount(quote.destMin)} {toObj.code}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <span className="text-muted-foreground">Slippage tolerance</span>
                      <span className="font-medium text-foreground">{slippage}%</span>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <span className="text-muted-foreground">Network fee (max)</span>
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        {activeFeeXlm} XLM <FeeBar level={feeLevel(feeTier, customFee, feeStats)} />
                      </span>
                    </div>
                    {quote.path.length > 0 && (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-muted-foreground">Route</span>
                        <RoutePath
                          codes={[fromObj.code, ...quote.path.map((p) => p.assetCode), toObj.code]}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => setShowSettings(true)}
                      className="flex cursor-pointer items-center justify-center gap-1.5 py-2.5 font-medium text-primary hover:underline"
                    >
                      <Settings size={12} /> Slippage and fee settings
                    </button>
                  </div>
                </Collapse>
              </div>
            )}

            {!quote && !quoteLoading && (
              // No amount yet: still show the going rate and terms to judge the pair.
              <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4 text-xs">
                {toObj && (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-muted-foreground">Rate</span>
                    <span className="truncate font-medium text-foreground">
                      {spotRate === undefined
                        ? '...'
                        : spotRate === null
                          ? 'No route yet'
                          : `1 ${fromObj.code} = ${trimAmount(Number(spotRate).toPrecision(6))} ${toObj.code}`}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setShowSettings(true)}
                  className="group flex cursor-pointer items-center justify-between gap-3 py-2.5 text-left"
                >
                  <span className="text-muted-foreground">
                    {slippage}% slippage, fee up to {formatSignificant(activeFeeXlm)} XLM
                  </span>
                  <Settings
                    size={13}
                    className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  />
                </button>
                <button
                  onClick={() => navigate('/bridge', { state: { direction: 'evm-to-stellar' } })}
                  className="group flex cursor-pointer items-center justify-between gap-3 py-2.5 text-left"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <ArrowLeftRight size={12} className="shrink-0" />
                    Have USDC on {evmChainName}? Bridge it to Stellar
                  </span>
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  />
                </button>
              </div>
            )}

            {error && !quote && <p className="px-1 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/40 px-5 py-4">
          <Button
            className="w-full"
            disabled={!cta.enabled}
            onClick={() => {
              setXdrOpen(false)
              setStep('confirm')
            }}
          >
            {cta.label}
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
              {step === 'success' ? 'Swap complete' : 'Review swap'}
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
              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4 [&>*]:shrink-0">
                <div className="flex flex-col items-center rounded-xl bg-card px-4 py-5 text-center">
                  <div className="value-enter mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
                    <CheckCircle2 size={24} className="text-green-500" />
                  </div>
                  {snapshotToObj && (
                    <p className="text-2xl font-bold tabular-nums text-green-500">
                      {received
                        ? `+${displayAmount(received)}`
                        : lastReceivedRef.current
                          ? `~${displayAmount(lastReceivedRef.current)}`
                          : ''}{' '}
                      <span className="text-base font-medium text-muted-foreground">
                        {snapshotToObj.code}
                      </span>
                      <VerifiedMark
                        code={snapshotToObj.code}
                        issuer={snapshotToObj.issuer}
                        className="ml-1 h-4 w-4"
                      />
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    for {lastAmountRef.current} {snapshotFromObj.code}
                  </p>
                </div>
                <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
                  <DetailRow label="Network">
                    <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                  </DetailRow>
                  {txHash && (
                    <DetailRow label="Transaction">
                      <CopyValue value={txHash} />
                    </DetailRow>
                  )}
                </div>
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
                      View on explorer <ExternalLink size={14} />
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
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 [&>*]:shrink-0">
                {/* Amount hero */}
                <div className="rounded-xl bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <AssetIcon icon={snapshotFrom?.icon} code={snapshotFromObj.code} size={18} />
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {snapshotFromObj.code}
                        <VerifiedMark
                          code={snapshotFromObj.code}
                          issuer={snapshotFromObj.issuer}
                          className="h-3 w-3"
                        />
                      </p>
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
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          {snapshotToObj.code}
                          <VerifiedMark
                            code={snapshotToObj.code}
                            issuer={snapshotToObj.issuer}
                            className="h-3 w-3"
                          />
                        </p>
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
                    <p className="text-sm text-foreground">
                      <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                    </p>
                  </div>
                </div>

                {/* Route */}
                {quote && quote.path.length > 0 && (
                  <div className="rounded-xl bg-card px-4 py-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Route</p>
                    <p className="text-xs">
                      <RoutePath
                        codes={[
                          snapshotFromObj.code,
                          ...quote.path.map((p) => p.assetCode),
                          snapshotToObj?.code ?? '',
                        ]}
                      />
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

      <AssetPickerSheet
        open={showFromPicker || showToPicker}
        title={showToPicker ? 'You receive' : 'You pay'}
        note={
          showToPicker
            ? 'Stellar assets only'
            : 'Stellar assets you hold. Ethereum swaps are not supported yet'
        }
        items={disambiguate(
          showToPicker
            ? [...pickerItems(fromKey, true), ...receiveSuggestions]
            : pickerItems(toKey, false)
        )}
        selectedKey={showToPicker ? toKey : fromKey}
        onSelect={(key) => {
          if (key.startsWith(ADD_PREFIX)) {
            // Receiving a token needs its trustline first; the Add Asset page
            // opens straight on it, and the user comes back to swap.
            const target = parseKey(key.slice(ADD_PREFIX.length))
            setShowToPicker(false)
            navigate('/assets/add', { state: { code: target.code, issuer: target.issuer } })
            return
          }
          if (showToPicker) setToKey(key)
          else setFromKey(key)
          setQuote(null)
          setError('')
          setShowFromPicker(false)
          setShowToPicker(false)
        }}
        onClose={() => {
          setShowFromPicker(false)
          setShowToPicker(false)
        }}
      />
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
