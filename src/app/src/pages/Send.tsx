import { useState, useEffect, useRef } from 'react'
import { Reveal } from '@/components/Collapse'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { AssetIcon as TokenAssetIcon } from '@/components/token/AssetIcon'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useBalances } from '@/hooks/useBalances'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import { ExternalLink, Settings, ChevronLeft, X, Search } from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { SendEvm } from '@/components/SendEvm'
import { SendBitcoin } from '@/components/SendBitcoin'
import { SendRecipientStep, type RecipientSuggestion } from '@/components/SendRecipientStep'
import { detectRecipientFamily, type RecipientFamily } from '@/lib/address'
import { getBitcoinChainsForEnv, getEvmChainsForEnv } from '@bg/chainRegistry'
import { StellarAvatar } from '@/components/StellarAvatar'
import { SERVICE_TYPES } from '@constants/services'
import { chainById, type ChainEntry } from '@constants/chains'
import { getChainIcons, getChainNames } from '@/lib/chainInfo'
import {
  parseUnits as toStroops,
  formatUnits,
  formatBalanceText,
  fractionUnits,
  spendableUnits,
} from '@/lib/amount'
import { SideCard, AmountInput, QuickFillChips } from '@/components/PairCard'
import { RecipientRow } from '@/components/RecipientRow'
import type { PaymentParams } from '@ext-types/index'
import { fetchPrices, priceKey } from '@/lib/api'
import type { AssetBalance } from '@/hooks/useBalances'
import { trimZeros } from '@/lib/historyUtils'
import {
  AddressValue,
  AdvancedDetails,
  CopyValue,
  DetailRow,
  NetworkValue,
  TxResultHero,
} from '@/components/TxDetailParts'
import { useStellarChain } from '@/hooks/useStellarChain'

// Scoped per (networkId, account) so recents do not bleed across accounts or networks.
function chainRecentsKey(networkId: string, account: string): string {
  return `cyphras_recent_chain_recipients_${networkId}_${account}`
}

function recentRecipientsKey(networkId: string, account: string): string {
  return `cyphras_recent_recipients_${networkId}_${account}`
}
const MAX_RECENT_RECIPIENTS = 5

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
  return /^G[A-Z2-7]{55}$/.test(key)
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
  chainName,
  onSelect,
  onClose,
}: {
  balances: AssetBalance[]
  selectedKey: string
  chainName: (chainId: string) => string
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
        <div className="overflow-y-auto flex-1 px-3 pb-4 flex flex-col gap-1 [&>*]:shrink-0">
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
                  <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                    {b.code}
                    <VerifiedMark code={b.code} issuer={b.issuer} />
                  </p>
                  <p className="text-xs text-muted-foreground">{chainName(b.chain)}</p>
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
      className={`fixed inset-0 z-[80] transition-all duration-300 ${isOpen ? '' : 'pointer-events-none'}`}
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
  const { status, accounts } = useWallet()
  const { activeNetwork } = useNetwork()
  const stellarChain = useStellarChain()
  const { balances, refresh: refreshBalances } = useBalances(status.publicKey)

  // Registry names first: builtins only know Ethereum and Sepolia, so a chain
  // added in the admin panel would otherwise print its raw CAIP-2 id.
  const chainIdsKey = [...new Set(balances.map((b) => b.chain))].sort().join(',')
  const [chainNames, setChainNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let cancelled = false
    getChainNames(chainIdsKey ? chainIdsKey.split(',') : []).then((names) => {
      if (!cancelled) setChainNames(names)
    })
    return () => {
      cancelled = true
    }
  }, [chainIdsKey])
  const chainNameOf = (chainId: string) =>
    chainNames.get(chainId) ?? chainById(chainId)?.name ?? chainId
  const { getExplorerTxUrl, formatValue } = usePreferences()

  const [step, setStep] = useState<Step>('form')
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  // Opened from a token's detail sheet: that token, per chain it lives on.
  const location = useLocation()
  const wantedAssets = (
    location.state as { assets?: Array<{ chain: string; code: string; issuer: string }> } | null
  )?.assets
  // Key = "CODE:ISSUER" (XLM = "XLM:")
  const [selectedAssetKey, setSelectedAssetKey] = useState(
    wantedAssets?.[0] ? `${wantedAssets[0].code}:${wantedAssets[0].issuer}` : 'XLM:'
  )
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
  const [sendTxDetails, setSendTxDetails] = useState<HorizonTxDetails | null>(null)

  const [destinationFocused, setDestinationFocused] = useState(false)
  const [destinationTouched, setDestinationTouched] = useState(false)
  const destinationInputRef = useRef<HTMLInputElement>(null)

  const [recentRecipients, setRecentRecipients] = useState<string[]>([])

  const [liveFiat, setLiveFiat] = useState<string | null>(null)
  const [selectedAssetPrice, setSelectedAssetPrice] = useState<number | null>(null)

  const lastPreviewRef = useRef<TxPreview | null>(null)
  const lastDestRef = useRef('')
  if (txPreview) lastPreviewRef.current = txPreview
  if (destination) lastDestRef.current = destination

  useEffect(() => {
    fetchFeeStats(activeNetwork.horizonUrl).then(setFeeStats)
  }, [activeNetwork.horizonUrl])

  useEffect(() => {
    if (!status.publicKey) return
    const key = recentRecipientsKey(activeNetwork.id, status.publicKey)
    chrome.storage.local.get(key, (result) => {
      const stored = result[key]
      setRecentRecipients(
        Array.isArray(stored)
          ? stored.filter((d) => typeof d === 'string' && isValidPublicKey(d))
          : []
      )
    })
  }, [status.publicKey, activeNetwork.id])

  const selectedBalance = balances.find((b) => `${b.code}:${b.issuer}` === selectedAssetKey)

  // Recipient first (SendRecipientStep): the address picks the network, and
  // the asset list after it only offers assets that can reach that network.
  const [recipientFamily, setRecipientFamily] = useState<RecipientFamily | null>(null)
  // The picked EVM or Bitcoin recipient; Stellar recipients live in `destination`.
  const [chainRecipient, setChainRecipient] = useState('')
  const [chainRecents, setChainRecents] = useState<string[]>([])
  const [evmChains, setEvmChains] = useState<ChainEntry[]>([])
  const [btcChain, setBtcChain] = useState<ChainEntry | undefined>(undefined)
  const [familyIcons, setFamilyIcons] = useState<Map<string, string>>(new Map())
  const stellarChainId = activeNetwork.id === 'testnet' ? 'stellar:testnet' : 'stellar:pubnet'
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getEvmChainsForEnv(activeNetwork.id),
      getBitcoinChainsForEnv(activeNetwork.id),
    ]).then(async ([chains, btc]) => {
      if (cancelled) return
      setEvmChains(chains)
      setBtcChain(btc[0])
      const icons = await getChainIcons([stellarChainId, ...[...chains, ...btc].map((c) => c.id)])
      if (!cancelled) setFamilyIcons(icons)
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id, stellarChainId])
  useEffect(() => {
    if (!status.publicKey) return
    const key = chainRecentsKey(activeNetwork.id, status.publicKey)
    chrome.storage.local.get(key, (result) => {
      const stored = result[key]
      setChainRecents(
        Array.isArray(stored)
          ? stored.filter(
              (d) =>
                typeof d === 'string' &&
                (detectRecipientFamily(d) === 'evm' || detectRecipientFamily(d) === 'bitcoin')
            )
          : []
      )
    })
  }, [status.publicKey, activeNetwork.id])
  function rememberChainRecipient(dest: string) {
    const family = detectRecipientFamily(dest)
    if (!status.publicKey || (family !== 'evm' && family !== 'bitcoin')) return
    const key = chainRecentsKey(activeNetwork.id, status.publicKey)
    setChainRecents((prev) => {
      const next = [dest, ...prev.filter((d) => d.toLowerCase() !== dest.toLowerCase())].slice(
        0,
        MAX_RECENT_RECIPIENTS
      )
      chrome.storage.local.set({ [key]: next })
      return next
    })
  }
  const ownAccountFor = (address: string) =>
    accounts.find(
      (a) =>
        a.publicKey === address ||
        a.addresses?.evm?.toLowerCase() === address.toLowerCase() ||
        a.addresses?.bitcoin === address ||
        a.addresses?.bitcoinTestnet === address
    )
  const ownLabelFor = (address: string) => {
    const a = ownAccountFor(address)
    return a ? a.label || `Account ${a.index + 1}` : undefined
  }
  const familyOf = (b: AssetBalance): RecipientFamily =>
    b.chain.startsWith('eip155') ? 'evm' : b.chain.startsWith('bip122') ? 'bitcoin' : 'stellar'
  // Keep the chosen asset on the recipient's network, natives first.
  useEffect(() => {
    if (!recipientFamily) return
    const current = balances.find((b) => `${b.code}:${b.issuer}` === selectedAssetKey)
    if (current && familyOf(current) === recipientFamily) return
    const sameFamily = balances.filter((b) => familyOf(b) === recipientFamily)
    const wanted = sameFamily.find((b) =>
      wantedAssets?.some((w) => w.chain === b.chain && w.code === b.code && w.issuer === b.issuer)
    )
    const next = wanted ?? sameFamily.find((b) => b.isNative) ?? sameFamily[0]
    if (next) setSelectedAssetKey(`${next.code}:${next.issuer}`)
  }, [recipientFamily, balances, selectedAssetKey, wantedAssets])
  const pickerBalances = recipientFamily
    ? balances.filter((b) => familyOf(b) === recipientFamily)
    : balances
  const selectedAssetObj = {
    code: selectedBalance?.code ?? 'XLM',
    issuer: selectedBalance?.issuer ?? '',
    icon: selectedBalance?.icon,
    isNative: selectedBalance?.isNative ?? true,
  }
  const selectedPriceAsset = {
    code: selectedAssetObj.code,
    issuer: selectedAssetObj.isNative ? undefined : selectedAssetObj.issuer,
  }

  useEffect(() => {
    let cancelled = false
    setSelectedAssetPrice(null)
    fetchPrices([selectedPriceAsset], activeNetwork.id).then(({ prices }) => {
      if (cancelled) return
      setSelectedAssetPrice(prices[priceKey(selectedPriceAsset)] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [selectedAssetObj.code])

  useEffect(() => {
    const amountNum = parseFloat(amount)
    if (selectedAssetPrice === null) {
      setLiveFiat(null)
      return
    }
    setLiveFiat(
      formatValue(isNaN(amountNum) || amountNum <= 0 ? 0 : amountNum * selectedAssetPrice)
    )
  }, [amount, selectedAssetPrice, formatValue])

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

  const activeFeeStroops = feeTier === 'custom' ? customFee || feeStats.medium : feeStats[feeTier]
  const activeFeeXlm = stroopsToXlm(activeFeeStroops)

  const decimals = selectedBalance?.decimals ?? 7

  async function handleContinue() {
    setError('')
    if (!isValidPublicKey(destination)) {
      setError('Enter a valid recipient address')
      return
    }
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (selectedBalance && amountNum > parseFloat(selectedBalance.balance)) {
      setError('Amount exceeds your balance')
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

    const { prices } = await fetchPrices([{ code: 'XLM' }, selectedPriceAsset], activeNetwork.id)
    const xlmPrice = prices['XLM'] ?? null
    const assetPrice = prices[priceKey(selectedPriceAsset)] ?? null
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
        rememberRecipient(destination)
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
    setDestinationTouched(false)
    setDestinationFocused(true)
    setTimeout(() => destinationInputRef.current?.focus(), 10)
  }

  // Persist the destination of a completed send to offer as a recent chip, most recent first.
  function rememberRecipient(dest: string) {
    if (!isValidPublicKey(dest) || !status.publicKey) return
    const key = recentRecipientsKey(activeNetwork.id, status.publicKey)
    setRecentRecipients((prev) => {
      const next = [dest, ...prev.filter((d) => d !== dest)].slice(0, MAX_RECENT_RECIPIENTS)
      chrome.storage.local.set({ [key]: next })
      return next
    })
  }

  // Reset for a repeat payment but keep the recipient so a follow-up send is one step.
  function handleSendAgain() {
    setAmount('')
    setMemo('')
    setTxHash('')
    setTxPreview(null)
    setSendTxDetails(null)
    setLiveFiat(null)
    setError('')
    setStep('form')
  }

  // Every quick fill uses what can actually leave: the reserve, open-offer
  // liabilities and, for XLM, this send's fee stay behind.
  function spendableNow(): bigint {
    if (!selectedBalance) return 0n
    const fee = selectedAssetObj.isNative ? BigInt(activeFeeStroops) : 0n
    return spendableUnits(selectedBalance.balance, decimals, selectedBalance.locked, fee)
  }

  function fillAmountFraction(fraction: number) {
    if (!selectedBalance) return
    const portion = fractionUnits(spendableNow(), fraction)
    setAmount(portion > 0n ? formatUnits(portion, decimals) : '0')
  }

  function fillAmountMax() {
    if (!selectedBalance) return
    const all = spendableNow()
    setAmount(all > 0n ? formatUnits(all, decimals) : '0')
  }

  // Against what can leave, not the raw balance: an XLM send into the reserve
  // fails on-chain with op_underfunded.
  const amountUnits = toStroops(amount, decimals)
  const exceedsBalance =
    !!selectedBalance && amountUnits !== null && amountUnits > 0n && amountUnits > spendableNow()
  const destinationInvalid =
    destinationTouched && destination !== '' && !isValidPublicKey(destination)

  if (!recipientFamily && step === 'form') {
    const recents: RecipientSuggestion[] = [
      ...chainRecents.map((address) => ({
        address,
        family: detectRecipientFamily(address) ?? ('evm' as const),
        label: ownLabelFor(address),
      })),
      ...recentRecipients.map((address) => ({
        address,
        family: 'stellar' as const,
        label: ownLabelFor(address),
      })),
    ]
    const ownAccounts: RecipientSuggestion[] = accounts
      .filter((a) => a.publicKey !== status.publicKey)
      .flatMap((a) => {
        const label = a.label || `Account ${a.index + 1}`
        const rows: RecipientSuggestion[] = [{ address: a.publicKey, family: 'stellar', label }]
        if (a.addresses?.evm) rows.push({ address: a.addresses.evm, family: 'evm', label })
        const btcAddress = btcChain?.isTestnet ? a.addresses?.bitcoinTestnet : a.addresses?.bitcoin
        if (btcChain && btcAddress) rows.push({ address: btcAddress, family: 'bitcoin', label })
        return rows
      })
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
          <WalletNavbar />
        </div>
        <SendRecipientStep
          recents={recents}
          ownAccounts={ownAccounts}
          evmEnabled={evmChains.length > 0}
          evmName={evmChains.map((c) => c.name).join(', ') || 'Ethereum'}
          stellarIcon={familyIcons.get(stellarChainId)}
          evmIcon={evmChains[0] ? familyIcons.get(evmChains[0].id) : undefined}
          bitcoin={
            btcChain
              ? {
                  name: btcChain.name,
                  icon: familyIcons.get(btcChain.id),
                  testnet: btcChain.isTestnet,
                }
              : undefined
          }
          onBack={() => navigate(-1)}
          onContinue={(address, family) => {
            setRecipientFamily(family)
            if (family === 'stellar') {
              setDestination(address)
              setDestinationTouched(true)
            } else {
              // Bech32 is case-insensitive; the signer and the node expect lowercase.
              setChainRecipient(
                family === 'bitcoin' && /^(bc|tb)1/i.test(address) ? address.toLowerCase() : address
              )
            }
          }}
        />
      </div>
    )
  }

  if (selectedBalance?.chain.startsWith('bip122')) {
    return (
      <>
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
            <WalletNavbar />
          </div>
          <SendBitcoin
            asset={selectedBalance}
            chainName={chainNameOf(selectedBalance.chain)}
            chainIcon={familyIcons.get(selectedBalance.chain)}
            onPickAsset={() => setShowAssetPicker(true)}
            initialDestination={chainRecipient}
            recipientLabel={ownLabelFor(chainRecipient)}
            onSent={rememberChainRecipient}
            onBack={() => setRecipientFamily(null)}
          />
        </div>
        {showAssetPicker && (
          <AssetPickerSheet
            balances={pickerBalances}
            selectedKey={selectedAssetKey}
            chainName={chainNameOf}
            onSelect={setSelectedAssetKey}
            onClose={() => setShowAssetPicker(false)}
          />
        )}
      </>
    )
  }

  // EVM assets get their own send engine (0x validation, gas fees, no memo or
  // trustline concepts) behind the same page shell and asset picker.
  if (selectedBalance?.chain.startsWith('eip155')) {
    return (
      <>
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/40">
            <WalletNavbar />
          </div>
          <SendEvm
            asset={selectedBalance}
            chainName={chainNameOf(selectedBalance.chain)}
            chainIcon={familyIcons.get(selectedBalance.chain)}
            onPickAsset={() => setShowAssetPicker(true)}
            initialDestination={chainRecipient}
            recipientLabel={ownLabelFor(chainRecipient)}
            nativeBalance={
              balances.find((b) => b.chain === selectedBalance.chain && b.isNative)?.balance
            }
            nativePrice={
              balances.find((b) => b.chain === selectedBalance.chain && b.isNative)?.usdPrice ??
              null
            }
            onSent={rememberChainRecipient}
            onBack={() => setRecipientFamily(null)}
          />
        </div>
        {showAssetPicker && (
          <AssetPickerSheet
            balances={pickerBalances}
            selectedKey={selectedAssetKey}
            chainName={chainNameOf}
            onSelect={setSelectedAssetKey}
            onClose={() => setShowAssetPicker(false)}
          />
        )}
      </>
    )
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
                onClick={() => {
                  if (loading) return
                  if (step === 'form') {
                    setRecipientFamily(null)
                  } else {
                    setStep('form')
                    setError('')
                  }
                }}
                className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-bold text-foreground">Send</h2>
            </div>

            {/* Destination */}
            <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
              <p className="pixel-label text-[10px] text-muted-foreground">To</p>
              {isValidPublicKey(destination) && !destinationFocused && recipientFamily ? (
                <RecipientRow
                  address={destination}
                  label={ownLabelFor(destination)}
                  networkName="Stellar"
                  chainIcon={familyIcons.get(stellarChainId)}
                  onChange={() => setRecipientFamily(null)}
                />
              ) : isValidPublicKey(destination) && !destinationFocused ? (
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
                    aria-label="Clear recipient address"
                    className="cursor-pointer shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 ml-2"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <input
                  ref={destinationInputRef}
                  type="text"
                  placeholder="G... Stellar address"
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value.trim())
                    if (error) setError('')
                  }}
                  onFocus={() => setDestinationFocused(true)}
                  onBlur={() => {
                    setDestinationFocused(false)
                    setDestinationTouched(true)
                  }}
                  className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none w-full"
                />
              )}
              <Reveal show={destinationInvalid} gap={8}>
                <p className="text-xs text-destructive">Enter a valid recipient address</p>
              </Reveal>
              {destination === '' && destinationFocused && recentRecipients.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <p className="text-xs text-muted-foreground">Recent</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recentRecipients.map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-label={`Use recent recipient ${r}`}
                        onMouseDown={(e) => {
                          // Fill before the input blur hides the chips, so the click still lands.
                          e.preventDefault()
                          setDestination(r)
                          setDestinationFocused(false)
                          setDestinationTouched(true)
                        }}
                        className="cursor-pointer flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 hover:bg-muted/70 transition-colors"
                      >
                        <StellarAvatar publicKey={r} size={16} />
                        <span className="text-xs font-mono text-foreground">
                          {r.slice(0, 4)}..{r.slice(-4)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <SideCard
              label="You send"
              corner={
                selectedBalance
                  ? formatBalanceText(
                      selectedBalance.balance,
                      selectedAssetObj.code,
                      selectedBalance.decimals
                    )
                  : 'Balance: -'
              }
              chip={{
                code: selectedAssetObj.code,
                issuer: selectedBalance?.issuer,
                icon: selectedAssetObj.icon,
                chainIcon: selectedBalance ? familyIcons.get(selectedBalance.chain) : undefined,
                // "Stellar" like every other chip; the navbar already says which Stellar network.
                subLabel: selectedBalance
                  ? familyOf(selectedBalance) === 'stellar'
                    ? 'Stellar'
                    : chainNameOf(selectedBalance.chain)
                  : undefined,
                onPick: () => setShowAssetPicker(true),
                ariaLabel: 'Select asset',
              }}
              value={<AmountInput value={amount} onChange={setAmount} />}
              footAsset={
                selectedBalance ? (
                  <QuickFillChips
                    onFill={(f) => (f === 1 ? fillAmountMax() : fillAmountFraction(f))}
                  />
                ) : null
              }
              footAmount={liveFiat ?? ''}
              error={exceedsBalance ? 'Exceeds balance' : null}
            />

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
              <Reveal show={memoType === 'text' && !!memo} gap={8}>
                <p className="text-xs text-muted-foreground text-right">{memo.length}/28</p>
              </Reveal>
            </div>
          </div>
        </div>

        {/* Fixed footer: error + Continue button */}
        <div className="shrink-0 px-5 pb-5 pt-3 border-t border-border/40">
          <Reveal show={!!error && step === 'form'}>
            <p className="text-xs text-destructive mb-3">{error}</p>
          </Reveal>
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
            if (loading) return
            if (step === 'confirm') {
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
              {step === 'success' ? 'Payment sent' : 'Confirm send'}
            </p>
            <div className="flex items-center gap-1">
              {step === 'confirm' && (
                <button
                  onClick={() => setShowSettings(true)}
                  aria-label="Open send settings"
                  className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Settings size={16} />
                </button>
              )}
              <button
                onClick={() => {
                  if (loading) return
                  if (step === 'success') {
                    navigate('/')
                  } else {
                    setStep('form')
                    setError('')
                  }
                }}
                disabled={loading}
                aria-label="Close"
                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div
            key={step}
            className="flex flex-1 flex-col min-h-0 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
          >
            {step === 'success' ? (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4 [&>*]:shrink-0">
                  <TxResultHero
                    state="success"
                    amountText={`-${amount}`}
                    code={selectedAssetObj.code}
                    issuer={selectedAssetObj.issuer || undefined}
                    icon={selectedAssetObj.icon}
                    chainIcon={stellarChain.icon}
                    subtitle={`to ${ownLabelFor(lastDestRef.current) ?? shortDest}`}
                  />
                  <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
                    <DetailRow label="Network">
                      <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                    </DetailRow>
                    <DetailRow label="To">
                      <AddressValue address={lastDestRef.current} />
                    </DetailRow>
                    <DetailRow label="Network fee">
                      <span className="tabular-nums">
                        {sendTxDetails?.fee_charged
                          ? `${trimZeros(stroopsToXlm(sendTxDetails.fee_charged))} XLM`
                          : '...'}
                      </span>
                    </DetailRow>
                    {memo && (
                      <DetailRow label="Memo">
                        <span className="break-all">{memo}</span>
                      </DetailRow>
                    )}
                    <DetailRow label="Transaction">
                      <CopyValue value={txHash} />
                    </DetailRow>
                  </div>
                  <AdvancedDetails
                    open={successXdrOpen}
                    onToggle={() => setSuccessXdrOpen((p) => !p)}
                  >
                    {sendTxDetails && (
                      <DetailRow label="Ledger">#{sendTxDetails.ledger.toLocaleString()}</DetailRow>
                    )}
                    {sendTxDetails?.created_at && (
                      <DetailRow label="Confirmed at">
                        {new Date(sendTxDetails.created_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </DetailRow>
                    )}
                    {memo && <DetailRow label="Memo type">{memoType}</DetailRow>}
                    {sendTxDetails?.envelope_xdr && (
                      <DetailRow label="Envelope XDR">
                        <CopyValue value={sendTxDetails.envelope_xdr} />
                      </DetailRow>
                    )}
                  </AdvancedDetails>
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
                  <Button variant="outline" className="flex-1" onClick={handleSendAgain}>
                    Send again
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 [&>*]:shrink-0">
                  <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4">
                    <TokenAssetIcon
                      code={selectedAssetObj.code}
                      icon={selectedAssetObj.icon}
                      chainIcons={[stellarChain.icon]}
                    />
                    <div className="min-w-0">
                      <p className="text-2xl font-bold tabular-nums text-foreground">
                        {amount}{' '}
                        <span className="text-base font-medium text-muted-foreground">
                          {selectedAssetObj.code}
                        </span>
                        <VerifiedMark
                          code={selectedAssetObj.code}
                          issuer={selectedAssetObj.issuer || undefined}
                          className="ml-1 h-4 w-4"
                        />
                      </p>
                      {lastPreviewRef.current?.amountUsd && (
                        <p className="text-xs text-muted-foreground">
                          {lastPreviewRef.current.amountUsd}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
                    <DetailRow label="From">
                      <AddressValue address={status.publicKey ?? undefined} />
                    </DetailRow>
                    <DetailRow label="To">
                      <span className="inline-flex flex-col items-end">
                        {ownLabelFor(destination) && (
                          <span className="font-medium">{ownLabelFor(destination)}</span>
                        )}
                        <AddressValue address={destination} />
                      </span>
                    </DetailRow>
                    {memo && (
                      <DetailRow label="Memo">
                        <span className="break-all">{memo}</span>
                      </DetailRow>
                    )}
                    <DetailRow label="Network">
                      <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                    </DetailRow>
                    <DetailRow label="Max fee">
                      <span className="tabular-nums">
                        {trimZeros(String(lastPreviewRef.current?.fee ?? activeFeeXlm))} XLM
                        {lastPreviewRef.current?.feeUsd && (
                          <span className="ml-1 text-muted-foreground">
                            {lastPreviewRef.current.feeUsd}
                          </span>
                        )}
                      </span>
                    </DetailRow>
                  </div>

                  {lastPreviewRef.current?.xdr && (
                    <AdvancedDetails
                      open={confirmXdrOpen}
                      onToggle={() => setConfirmXdrOpen((p) => !p)}
                    >
                      {memo && <DetailRow label="Memo type">{memoType}</DetailRow>}
                      <DetailRow label="Unsigned XDR">
                        <CopyValue value={lastPreviewRef.current.xdr} />
                      </DetailRow>
                    </AdvancedDetails>
                  )}

                  <Reveal show={!!error} gap={12}>
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                      <p className="text-xs text-destructive">{error}</p>
                    </div>
                  </Reveal>
                  <Reveal show={loading} gap={12}>
                    <p className="text-center text-xs text-muted-foreground">
                      Signing and submitting to {stellarChain.name}...
                    </p>
                  </Reveal>
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
      </div>

      {showAssetPicker && (
        <AssetPickerSheet
          balances={pickerBalances}
          selectedKey={selectedAssetKey}
          chainName={chainNameOf}
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
