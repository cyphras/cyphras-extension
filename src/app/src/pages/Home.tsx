import { useState, useRef, useEffect, type ComponentType } from 'react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { NumberTicker } from '@/components/NumberTicker'
import { PixelMask, PixelProgress } from '@/components/Pixel'
import { statusMeta, bridgeSteps } from '@/lib/cctp'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useBalances, groupBalances } from '@/hooks/useBalances'
import { useHiddenAssets } from '@/hooks/useHiddenAssets'
import { usePullToPrivate } from '@/hooks/usePullToPrivate'
import { useShieldedAvailable } from '@/hooks/useShieldedAvailable'
import { useShieldedStatus } from '@/hooks/useShieldedStatus'
import { SectionMenu } from '@/components/SectionMenu'
import { AssetIcon } from '@/components/token/AssetIcon'
import { TokenRow } from '@/components/token/TokenRow'
import { SuggestedAssets } from '@/components/SuggestedAssets'
import { useCctpJobs } from '@/hooks/useCctpJobs'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { Skeleton } from '@/components/ui/skeleton'
import WalletNavbar from '@/components/WalletNavbar'
import TokenDetailSheet from '@/components/TokenDetailSheet'
import ShieldedReceive from '@/components/ShieldedReceive'
import ShieldedSend, { type ShieldedAction } from '@/components/ShieldedSend'
import ShieldedTokenPicker, { type ShieldedTokenRow } from '@/components/ShieldedTokenPicker'
import ShieldedTokenSheet from '@/components/ShieldedTokenSheet'
import ShieldedActivity from '@/components/ShieldedActivity'
import { PrivateModeHint } from '@/components/PrivateModeHint'
import { WhatsNewSheet } from '@/components/WhatsNewSheet'
import { AnnouncementCarousel } from '@/components/AnnouncementCarousel'
import {
  getAnnouncements,
  fetchAnnouncements,
  dismissAnnouncement,
  type Announcement,
} from '@/lib/announcements'
import { getIconMap } from '@/hooks/useBalances'
import { getChainIcons, getChainNames } from '@/lib/chainInfo'
import { LEGACY_NETWORK_TO_CHAIN, chainById } from '@constants/chains'
import {
  NetworkFilterButton,
  NetworkFilterSheet,
  ALL_NETWORKS,
  type NetworkFilterOption,
} from '@/components/NetworkFilterSheet'
import { Alert } from '@/components/Alert'
import type { AssetBalance } from '@/hooks/useBalances'
import type { ShieldedBalanceView, ShieldedPlanView } from '@ext-types/index'
import { formatUnits } from '@/lib/amount'
import {
  RefreshCw,
  Send,
  QrCode,
  Layers,
  ArrowUpDown,
  MoreHorizontal,
  Copy,
  EyeOff,
  Eye,
  Plus,
  Check,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
} from 'lucide-react'

// One-time flag: the private-mode coach-mark is shown until dismissed or discovered.
const PRIVATE_HINT_KEY = 'cyphras_private_hint_seen'
const WHATS_NEW_KEY = 'cyphras_whats_new_seen'
const WHATS_NEW_VERSION = '0.4.0'

function BalanceSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="mt-2.5 h-7 w-36 rounded-md" />
        <Skeleton className="mt-2 h-3 w-24 rounded" />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2 rounded-xl bg-card py-3">
            <Skeleton className="h-[18px] w-[18px] rounded" />
            <Skeleton className="h-2.5 w-10 rounded" />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32 rounded-full" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>

      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Skeleton className="h-10 w-10 rounded-full" />
                <span className="absolute -bottom-1 -right-0.5 h-[21px] w-[21px] rounded-full border-[1.5px] border-card bg-muted" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-14 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-3.5 w-16 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const HIDE_ZERO_KEY = 'cyphras_hide_zero_balances'

// The part of a private balance that is not spendable yet, as short phrases for its token row.
function pendingParts(b: ShieldedBalanceView, decimals: number, code: string): string[] {
  const parts: [string, string][] = [
    [b.pendingDeposits, 'pending'],
    [b.locked, 'locked in payments'],
    [b.awaitingPayout, 'awaiting payout'],
  ]
  return parts
    .filter(([units]) => units !== '0')
    .map(([units, label]) => `${formatUnits(units, decimals)} ${code} ${label}`)
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl bg-card py-3 text-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-muted active:scale-[0.97]"
    >
      <Icon size={18} />
      <span className="text-[11px]">{label}</span>
    </button>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { status, activePublicKey } = useWallet()
  // Active account and network only; bridge jobs of other accounts do not show here.
  const { jobs: cctpJobs, hasInFlight: cctpInFlight } = useCctpJobs(status.publicKey ?? '')
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const {
    balances,
    subentryCount,
    totalUsd,
    dailyChangeUsd,
    dailyChangePct,
    loading,
    error,
    isFunded,
    refresh,
  } = useBalances(status.publicKey)
  const { formatValue, formatPrice, hideBalance, setHideBalance } = usePreferences()
  const { hiddenAssets } = useHiddenAssets(activeNetwork.id, status.publicKey ?? '')

  // Chain badges on token icons, resolved per row from the curated chain
  // metadata so multichain rows stay distinguishable at a glance.
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  const [chainNames, setChainNames] = useState<Map<string, string>>(new Map())
  // Keyed by the portfolio's chain set: an id the cached chain map does not
  // know (a chain enabled in the admin panel minutes ago) forces a registry refresh.
  const chainIdsKey = [...new Set(balances.map((b) => b.chain))].sort().join(',')
  useEffect(() => {
    let cancelled = false
    const ids = chainIdsKey ? chainIdsKey.split(',') : []
    getChainIcons(ids).then((icons) => {
      if (!cancelled) setChainIcons(icons)
    })
    getChainNames(ids).then((names) => {
      if (!cancelled) setChainNames(names)
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id, chainIdsKey])
  const stellarChainId = LEGACY_NETWORK_TO_CHAIN[activeNetwork.id] ?? activeNetwork.id
  const { active, showPrivate, exit, handlers, peek, swipe } = usePullToPrivate()

  // Token list filter over the chains present in the portfolio, Stellar first.
  // Only the list narrows; the total balance card always shows the whole portfolio.
  const [tokenFilter, setTokenFilter] = useState<string>(ALL_NETWORKS)
  const [filterOpen, setFilterOpen] = useState(false)
  // Same order as the token list: Stellar, then Bitcoin, then EVM chains.
  const familyRank = (id: string) =>
    id === stellarChainId ? 0 : id.startsWith('bip122') ? 1 : id.startsWith('eip155') ? 2 : 3
  const networkOptions: NetworkFilterOption[] = (chainIdsKey ? chainIdsKey.split(',') : [])
    .sort((a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b))
    .map((id) => ({
      id,
      name:
        chainNames.get(id) ??
        chainById(id)?.name ??
        (id === stellarChainId ? activeNetwork.name : id),
    }))
  useEffect(() => {
    if (tokenFilter !== ALL_NETWORKS && !networkOptions.some((o) => o.id === tokenFilter)) {
      setTokenFilter(ALL_NETWORKS)
    }
  }, [tokenFilter, networkOptions])
  const {
    available: shieldedAvailable,
    pools: shieldedPools,
    onTestnet: shieldedOnTestnet,
  } = useShieldedAvailable()
  const [switchingNet, setSwitchingNet] = useState(false)
  // Pool the private surfaces act on; clamped to the active network's pool set.
  const [selectedPoolId, setSelectedPoolId] = useState<string>(shieldedPools[0]?.poolId ?? 'xlm')
  const selectedPool =
    shieldedPools.find((p) => p.poolId === selectedPoolId) ?? shieldedPools[0] ?? null
  const poolId = selectedPool?.poolId ?? 'xlm'
  // Sync up front while private mode is merely available so entering it is instant.
  const {
    byPool: shieldedByPool,
    privateTotalUsd,
    privateChangeUsd,
    privateChangePct,
    syncing: shieldedSyncing,
    error: shieldedRequestError,
    refresh: refreshShielded,
  } = useShieldedStatus(shieldedAvailable, active, activePublicKey, activeNetwork.id, shieldedPools)
  const shieldedStatus = shieldedByPool[poolId]?.status ?? null
  const [shieldedReceiveOpen, setShieldedReceiveOpen] = useState(false)
  const [shieldedAction, setShieldedAction] = useState<ShieldedAction | null>(null)
  const [retryPlan, setRetryPlan] = useState<ShieldedPlanView | null>(null)
  // Picker drives send/shield/unshield; tappedPoolId opens the per-token sheet.
  const [pickerAction, setPickerAction] = useState<ShieldedAction | null>(null)
  const [tappedPoolId, setTappedPoolId] = useState<string | null>(null)
  const [shieldedIcons, setShieldedIcons] = useState<Map<string, string>>(new Map())
  // Home news from the admin panel; refetched per network, cached a few minutes.
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  useEffect(() => {
    let cancelled = false
    getAnnouncements(activeNetwork.id)
      .then((list) => {
        if (!cancelled) setAnnouncements(list)
      })
      .catch(() => {})
    // Then the server's current list; null (offline, outage) keeps the cached one.
    fetchAnnouncements(activeNetwork.id)
      .then((list) => {
        if (!cancelled && list) setAnnouncements(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])
  // Default seen=true so the coach-mark never flashes before the stored flag loads.
  const [hintSeen, setHintSeen] = useState(true)
  const [whatsNewSeen, setWhatsNewSeen] = useState(true)
  useEffect(() => {
    chrome.storage.local.get([PRIVATE_HINT_KEY, WHATS_NEW_KEY], (res) => {
      setHintSeen(!!res[PRIVATE_HINT_KEY])
      setWhatsNewSeen(res[WHATS_NEW_KEY] === WHATS_NEW_VERSION)
    })
  }, [])
  function dismissWhatsNew() {
    chrome.storage.local.set({ [WHATS_NEW_KEY]: WHATS_NEW_VERSION })
    setWhatsNewSeen(true)
  }
  // Opening private mode counts as discovering it, so stop hinting afterward.
  useEffect(() => {
    if (active && !hintSeen) {
      chrome.storage.local.set({ [PRIVATE_HINT_KEY]: true })
      setHintSeen(true)
    }
  }, [active, hintSeen])
  function dismissHint() {
    chrome.storage.local.set({ [PRIVATE_HINT_KEY]: true })
    setHintSeen(true)
  }
  const masked = hideBalance || showPrivate
  const [exitHover, setExitHover] = useState(false)
  const [swiping, setSwiping] = useState(false)
  useEffect(() => {
    if (!active) {
      setExitHover(false)
      setSwiping(false)
      // Reset to the first pool on private-mode exit so re-entering always starts on XLM.
      setSelectedPoolId(shieldedPools[0]?.poolId ?? 'xlm')
      setPickerAction(null)
      setTappedPoolId(null)
    }
  }, [active, shieldedPools])

  useEffect(() => {
    // Keep the selection valid when a network switch changes the pool set.
    if (shieldedPools.length > 0 && !shieldedPools.some((p) => p.poolId === selectedPoolId)) {
      setSelectedPoolId(shieldedPools[0].poolId)
    }
  }, [shieldedPools, selectedPoolId])
  const displayBalances = balances.filter((b) => !hiddenAssets.includes(`${b.code}:${b.issuer}`))
  const [hideZero, setHideZero] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_ZERO_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleHideZero = () => {
    setHideZero((v) => {
      try {
        localStorage.setItem(HIDE_ZERO_KEY, v ? '0' : '1')
      } catch {
        // storage blocked; the toggle still applies for this session
      }
      return !v
    })
  }
  // One row per logical token: curated multichain tokens (e.g. USDC on
  // Stellar and Ethereum) merge with their per-chain parts kept for the sheet.
  const filteredGroups = groupBalances(
    tokenFilter === ALL_NETWORKS
      ? displayBalances
      : displayBalances.filter((b) => b.chain === tokenFilter)
  )
  // The unactivated XLM row stays: it carries the activation step, not a balance.
  const groupedBalances = filteredGroups.filter(
    (asset) => !hideZero || asset.inactive || parseFloat(asset.balance) > 0
  )
  const hiddenZeroCount = filteredGroups.length - groupedBalances.length
  const filterName = networkOptions.find((o) => o.id === tokenFilter)?.name
  const inFlightBridges = cctpJobs.filter((j) => j.status !== 'done' && j.status !== 'failed')
  const [fundingLoading, setFundingLoading] = useState(false)
  const [fundingError, setFundingError] = useState('')
  const [selectedToken, setSelectedToken] = useState<AssetBalance | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const shieldedMenuRef = useRef<HTMLDivElement>(null)
  const [shieldedMenuOpen, setShieldedMenuOpen] = useState(false)
  const [copiedCy1, setCopiedCy1] = useState(false)
  const shieldedAddr = shieldedStatus?.address ?? null

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (shieldedMenuRef.current && !shieldedMenuRef.current.contains(e.target as Node)) {
        setShieldedMenuOpen(false)
      }
    }
    if (shieldedMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [shieldedMenuOpen])

  useEffect(() => {
    // Same issuer-icon source as the public list so private surfaces show the real logo.
    if (!shieldedAvailable) return
    getIconMap(activeNetwork.id).then(setShieldedIcons)
  }, [shieldedAvailable, activeNetwork.id])

  // Force-exit private mode on network or account change so scoped shielded surfaces cannot leak.
  const shieldedScopeGuard = useRef<{ net: string; pk: string } | null>(null)
  useEffect(() => {
    const scope = { net: activeNetwork.id, pk: activePublicKey }
    if (shieldedScopeGuard.current === null) {
      shieldedScopeGuard.current = scope
      return
    }
    if (
      shieldedScopeGuard.current.net === scope.net &&
      shieldedScopeGuard.current.pk === scope.pk
    ) {
      return
    }
    shieldedScopeGuard.current = scope
    setShieldedReceiveOpen(false)
    setShieldedAction(null)
    setRetryPlan(null)
    setPickerAction(null)
    setTappedPoolId(null)
    setSelectedPoolId(shieldedPools[0]?.poolId ?? 'xlm')
    exit()
  }, [activeNetwork.id, activePublicKey, shieldedPools, exit])

  async function handleFundWithFriendbot() {
    if (!status.publicKey || !activeNetwork.friendbotUrl) return
    setFundingLoading(true)
    setFundingError('')
    try {
      const url = `${activeNetwork.friendbotUrl}?addr=${status.publicKey}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = (await res.json()) as { detail?: string }
        if (
          data.detail?.includes('already funded') ||
          data.detail?.includes('createAccountAlreadyExist')
        ) {
          setFundingError('Account already funded')
        } else {
          setFundingError('Funding failed, try again')
        }
      } else {
        await refresh()
      }
    } catch {
      setFundingError('Funding failed, try again')
    } finally {
      setFundingLoading(false)
    }
  }

  function formatBalance(balance: string): string {
    const num = parseFloat(balance)
    if (num === 0) return '0'
    if (num < 0.01) return num.toFixed(7)
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })
  }

  function formatSmall(value: number): string {
    return formatValue(value)
  }

  const shieldedDecimals = selectedPool?.decimals ?? 7
  const shieldedLabel = selectedPool?.label ?? 'XLM'

  // Native pools use the inline XLM glyph; others reuse the public list's issuer icon.
  function poolIcon(pool: (typeof shieldedPools)[number]): string | undefined {
    if (pool.native) return undefined
    return pool.icon ?? shieldedIcons.get(`${pool.assetCode}:${pool.assetIssuer}`)
  }

  // Per-pool rows for the list and send/unshield pickers: the spendable balance, with what
  // waits in deposits, unconfirmed payments and the exit queue beside it.
  const shieldedTokenRows: ShieldedTokenRow[] = shieldedPools.map((pool) => {
    const pb = shieldedByPool[pool.poolId]
    const code = pool.native ? 'XLM' : (pool.assetCode ?? pool.label)
    return {
      poolId: pool.poolId,
      code,
      label: pool.label,
      balance: pb?.status ? formatUnits(pb.status.balance.spendable, pool.decimals) : '0',
      pending: pb?.status ? pendingParts(pb.status.balance, pool.decimals, code) : [],
      usdValue: pb?.usdValue ?? null,
      usdPrice: pb?.usdPrice ?? null,
      icon: poolIcon(pool),
    }
  })

  // Shield moves public funds in, so its picker shows each pool's public balance.
  // Pools are Stellar-only while `balances` spans every chain; match on the
  // Stellar chain so a native pool never picks up an EVM native such as ETH.
  const shieldPickerRows: ShieldedTokenRow[] = shieldedPools.map((pool) => {
    const code = pool.native ? 'XLM' : (pool.assetCode ?? pool.label)
    const match = balances.find(
      (b) =>
        b.chain === stellarChainId &&
        (pool.native ? b.isNative : b.code === pool.assetCode && b.issuer === pool.assetIssuer)
    )
    return {
      poolId: pool.poolId,
      code,
      label: pool.label,
      balance: match ? formatBalance(match.balance) : '0',
      usdValue: match?.usdValue ?? null,
      icon: poolIcon(pool),
    }
  })

  const pickerRows = pickerAction === 'shield' ? shieldPickerRows : shieldedTokenRows
  const tappedToken = shieldedTokenRows.find((r) => r.poolId === tappedPoolId) ?? null

  function copyPrivateAddress() {
    if (!shieldedAddr) return
    navigator.clipboard.writeText(shieldedAddr)
    setCopiedCy1(true)
    setTimeout(() => setCopiedCy1(false), 2000)
  }

  // Select the pool, then open the shielded send form for the chosen action.
  function openShieldedForPool(targetPoolId: string, nextAction: ShieldedAction) {
    setSelectedPoolId(targetPoolId)
    // Close the picker/tap-sheet as the form opens so the chip's change-asset reopen is clean.
    setPickerAction(null)
    setTappedPoolId(null)
    setShieldedAction(nextAction)
  }

  // With a network picked in the token list, the card shows that network's value
  // and 24h change, weighted like the useBalances portfolio figure (sum of value x change%).
  const networkFiltered = tokenFilter !== ALL_NETWORKS
  const filteredStats = (() => {
    if (!networkFiltered) return null
    const onChain = balances.filter((b) => b.chain === tokenFilter)
    const priced = onChain.filter((b) => b.usdValue !== null)
    const total =
      priced.length > 0 || onChain.length === 0
        ? priced.reduce((sum, b) => sum + b.usdValue!, 0)
        : null
    const changeable = priced.filter((b) => b.change24h !== null)
    const changeUsd =
      changeable.length > 0
        ? changeable.reduce((sum, b) => sum + (b.usdValue! * b.change24h!) / 100, 0)
        : null
    return {
      total,
      changeUsd,
      changePct: changeUsd !== null && total ? (changeUsd / total) * 100 : null,
      name: networkOptions.find((o) => o.id === tokenFilter)?.name ?? 'Network',
    }
  })()
  const cardTotalUsd = filteredStats ? filteredStats.total : totalUsd

  // The balance card shows the private 24h change in private mode, else the public one.
  const inPrivateCard = showPrivate && shieldedAvailable
  const cardChangeUsd = inPrivateCard
    ? privateChangeUsd
    : filteredStats
      ? filteredStats.changeUsd
      : dailyChangeUsd
  const cardChangePct = inPrivateCard
    ? privateChangePct
    : filteredStats
      ? filteredStats.changePct
      : dailyChangePct
  const cardChangeMasked = inPrivateCard ? hideBalance : masked

  // Why the private balance may be stale or blocked, most serious first.
  const shieldedNotice =
    shieldedStatus?.services === 'mismatch'
      ? 'A private pool service does not match this wallet, so shields and payments are paused.'
      : (shieldedStatus?.stateReset ?? shieldedStatus?.syncError?.message ?? shieldedRequestError)

  return (
    <>
      <Layout
        navbar={<WalletNavbar />}
        bottomBlur={active}
        bottomBlurVisible={exitHover || swiping}
      >
        {/* iOS-style push parallax: while the token page slides in over this,
            the home content drifts a quarter of the way left on the same curve */}
        <div
          className={`flex flex-col gap-4 transition-[translate,opacity] duration-300 ease-out ${selectedToken ? '-translate-x-1/4 opacity-80' : ''}`}
        >
          {loading ? (
            <BalanceSkeleton />
          ) : (
            <>
              <div className="peel-wrap">
                <div className="peel-under">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Private balance
                      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        Testnet preview
                      </span>
                    </p>
                    <span className="rounded-md p-1 text-muted-foreground">
                      {hideBalance ? <Eye size={14} /> : <EyeOff size={14} />}
                    </span>
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-foreground tracking-wider">
                    {hideBalance ? (
                      <PixelMask />
                    ) : privateTotalUsd !== null ? (
                      formatSmall(privateTotalUsd)
                    ) : (
                      <span className="inline-block h-7 w-28 animate-pulse rounded bg-muted align-middle" />
                    )}
                  </p>
                  <p
                    className={`mt-0.5 text-xs font-medium ${privateChangeUsd !== null && privateChangeUsd >= 0 ? 'text-green-500' : 'text-destructive'}`}
                  >
                    {!hideBalance && privateChangeUsd !== null && privateChangePct !== null ? (
                      <>
                        {privateChangeUsd >= 0 ? '+' : ''}
                        {formatSmall(privateChangeUsd)} ({privateChangePct >= 0 ? '+' : ''}
                        {privateChangePct.toFixed(2)}%)
                      </>
                    ) : (
                      <span className="invisible">0</span>
                    )}
                  </p>
                </div>
                <div ref={cardRef} className="peel-card rounded-xl bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {showPrivate ? (
                        <>
                          Private balance
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Testnet preview
                          </span>
                        </>
                      ) : filteredStats ? (
                        `${filteredStats.name} balance`
                      ) : (
                        'Total balance'
                      )}
                    </p>
                    <button
                      onClick={() => setHideBalance(!hideBalance)}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
                      aria-pressed={hideBalance}
                      className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {hideBalance ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-foreground tracking-wider">
                    {showPrivate && shieldedAvailable ? (
                      hideBalance ? (
                        <PixelMask />
                      ) : privateTotalUsd !== null ? (
                        <NumberTicker value={privateTotalUsd} format={formatSmall} />
                      ) : (
                        <span className="inline-block h-7 w-28 animate-pulse rounded bg-muted align-middle" />
                      )
                    ) : masked ? (
                      <PixelMask />
                    ) : cardTotalUsd !== null ? (
                      <NumberTicker value={cardTotalUsd} format={formatSmall} />
                    ) : (
                      <span className="inline-block h-7 w-28 animate-pulse rounded bg-muted align-middle" />
                    )}
                  </p>
                  <p
                    className={`mt-0.5 text-xs font-medium ${cardChangeUsd !== null && cardChangeUsd >= 0 ? 'text-green-500' : 'text-destructive'}`}
                  >
                    {!cardChangeMasked && cardChangeUsd !== null && cardChangePct !== null ? (
                      <>
                        {cardChangeUsd >= 0 ? '+' : ''}
                        {formatSmall(cardChangeUsd)} ({cardChangePct >= 0 ? '+' : ''}
                        {cardChangePct.toFixed(2)}%)
                      </>
                    ) : (
                      <span className="invisible">0</span>
                    )}
                  </p>
                </div>
                {createPortal(<div className="peel-flap" />, document.body)}
                <div
                  className="peel-grab"
                  onPointerDown={handlers.onPointerDown}
                  onPointerMove={handlers.onPointerMove}
                  onPointerUp={handlers.onPointerUp}
                  onPointerCancel={handlers.onPointerUp}
                  onLostPointerCapture={handlers.onPointerUp}
                  onMouseEnter={peek.onMouseEnter}
                  onMouseLeave={peek.onMouseLeave}
                />
              </div>

              {active && shieldedAvailable && (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <ActionButton
                      icon={QrCode}
                      label="Receive"
                      onClick={() => setShieldedReceiveOpen(true)}
                    />
                    <ActionButton
                      icon={Send}
                      label="Send"
                      onClick={() => setPickerAction('send')}
                    />
                    <ActionButton
                      icon={ArrowDownToLine}
                      label="Shield"
                      onClick={() => setPickerAction('shield')}
                    />
                    <ActionButton
                      icon={ArrowUpFromLine}
                      label="Unshield"
                      onClick={() => setPickerAction('unshield')}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1">
                      <p className="pixel-label text-[10px] text-muted-foreground">
                        Shielded tokens
                      </p>
                      <div className="relative" ref={shieldedMenuRef}>
                        <button
                          onClick={() => setShieldedMenuOpen((o) => !o)}
                          aria-label="Shielded options"
                          aria-expanded={shieldedMenuOpen}
                          className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {shieldedMenuOpen && (
                          <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl border border-border bg-background shadow-lg py-1 overflow-hidden">
                            <button
                              className="cursor-pointer flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                              onClick={() => {
                                refreshShielded()
                                setShieldedMenuOpen(false)
                              }}
                            >
                              <RefreshCw size={14} className="text-muted-foreground" />
                              Refresh
                            </button>
                            <button
                              disabled={!shieldedAddr}
                              className="cursor-pointer flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors disabled:cursor-default disabled:opacity-50"
                              onClick={copyPrivateAddress}
                            >
                              {copiedCy1 ? (
                                <Check size={14} className="text-muted-foreground" />
                              ) : (
                                <Copy size={14} className="text-muted-foreground" />
                              )}
                              {copiedCy1 ? 'Copied!' : 'Copy private address'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {shieldedTokenRows.map((t) => (
                      <button
                        key={t.poolId}
                        onClick={() => setTappedPoolId(t.poolId)}
                        className="group cursor-pointer flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <AssetIcon
                            icon={t.icon}
                            code={t.code}
                            chainIcons={[chainIcons.get(stellarChainId)]}
                          />
                          <div className="flex flex-col">
                            <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                              {t.code}
                              <VerifiedBadge />
                            </p>
                            <p className="text-xs text-muted-foreground tracking-wider">
                              {hideBalance ? <PixelMask count={4} size="sm" /> : t.balance}
                            </p>
                            {!hideBalance && t.pending && t.pending.length > 0 && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                {t.pending.join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {hideBalance ? (
                            <p className="text-sm text-foreground">
                              <PixelMask count={4} size="sm" />
                            </p>
                          ) : t.usdValue !== null ? (
                            <p className="text-sm text-foreground">{formatSmall(t.usdValue)}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">-</p>
                          )}
                          {!hideBalance && t.usdPrice != null && (
                            <p className="text-xs text-muted-foreground">
                              {formatPrice(t.usdPrice)}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {shieldedNotice && (
                    <Alert
                      message={shieldedNotice}
                      onRetry={refreshShielded}
                      retrying={shieldedSyncing}
                    />
                  )}

                  {shieldedStatus && (
                    <ShieldedActivity
                      status={shieldedStatus}
                      poolId={poolId}
                      onChanged={refreshShielded}
                      code={
                        selectedPool?.native ? 'XLM' : (selectedPool?.assetCode ?? shieldedLabel)
                      }
                      decimals={shieldedDecimals}
                      onRetry={(plan) => setRetryPlan(plan)}
                    />
                  )}
                </>
              )}

              {active && !shieldedAvailable && (
                <div className="flex flex-col gap-3 rounded-xl bg-card p-5 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15">
                    <EyeOff size={20} className="text-primary" />
                  </div>
                  {!shieldedOnTestnet ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Private mode runs on testnet
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Switch to the testnet network to shield, send, and receive privately.
                      </p>
                      <Button
                        className="w-full"
                        disabled={switchingNet}
                        onClick={async () => {
                          setSwitchingNet(true)
                          await setActiveNetwork('testnet')
                          setSwitchingNet(false)
                        }}
                      >
                        {switchingNet ? 'Switching...' : 'Switch to testnet'}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Private mode needs an account created from a recovery phrase.
                    </p>
                  )}
                </div>
              )}

              {!active && (
                <div className="grid grid-cols-4 gap-2">
                  <ActionButton
                    icon={QrCode}
                    label="Receive"
                    onClick={() => navigate('/receive')}
                  />
                  <ActionButton icon={Send} label="Send" onClick={() => navigate('/send')} />
                  <ActionButton icon={ArrowUpDown} label="Swap" onClick={() => navigate('/swap')} />
                  <ActionButton
                    icon={ArrowLeftRight}
                    label="Bridge"
                    onClick={() => navigate('/bridge')}
                  />
                </div>
              )}

              {!active && announcements.length > 0 && (
                <div className="row-enter">
                  <AnnouncementCarousel
                    cards={announcements}
                    onOpenPage={(route) => navigate(route)}
                    onDismiss={(card) => {
                      void dismissAnnouncement(card)
                      setAnnouncements((list) => list.filter((a) => a.id !== card.id))
                    }}
                  />
                </div>
              )}

              {cctpInFlight && inFlightBridges.length > 0 && (
                <button
                  onClick={() =>
                    navigate('/bridge', { state: { direction: inFlightBridges[0].direction } })
                  }
                  className="cursor-pointer flex flex-col gap-2 rounded-xl bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex w-full items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <ArrowLeftRight size={16} className="text-primary" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {inFlightBridges.length > 1
                          ? `${inFlightBridges.length} bridges in progress`
                          : `Bridging ${inFlightBridges[0].amount} USDC to ${
                              inFlightBridges[0].direction === 'stellar-to-evm'
                                ? (chainById(
                                    activeNetwork.id === 'testnet' ? 'eip155:11155111' : 'eip155:1'
                                  )?.name ?? 'Ethereum')
                                : 'Stellar'
                            }`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {statusMeta(inFlightBridges[0].status).label}
                      </p>
                    </div>
                  </div>
                  <PixelProgress steps={bridgeSteps(inFlightBridges[0]).map((st) => st.state)} />
                </button>
              )}

              {!active && displayBalances.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    {networkOptions.length > 1 ? (
                      <NetworkFilterButton
                        value={tokenFilter}
                        options={networkOptions}
                        chainIcons={chainIcons}
                        onClick={() => setFilterOpen(true)}
                      />
                    ) : (
                      <p className="pixel-label text-[10px] text-muted-foreground">Tokens</p>
                    )}
                    <SectionMenu
                      label="Token options"
                      actions={[
                        {
                          icon: <Plus size={14} className="text-muted-foreground" />,
                          label: 'Add assets',
                          onClick: () => navigate('/assets/add'),
                        },
                        {
                          icon: <Layers size={14} className="text-muted-foreground" />,
                          label: 'Manage tokens',
                          onClick: () => navigate('/assets'),
                        },
                        {
                          icon: hideZero ? (
                            <Eye size={14} className="text-muted-foreground" />
                          ) : (
                            <EyeOff size={14} className="text-muted-foreground" />
                          ),
                          label: hideZero ? 'Show zero balances' : 'Hide zero balances',
                          onClick: toggleHideZero,
                        },
                        {
                          icon: <RefreshCw size={14} className="text-muted-foreground" />,
                          label: 'Refresh',
                          onClick: () => refresh(),
                        },
                      ]}
                    />
                  </div>
                  {groupedBalances.map((asset, i) => (
                    // Keyed by the filter too, so switching network or hiding
                    // zero balances replays the rise; a price refresh does not.
                    <div
                      key={`${tokenFilter}:${hideZero}:${asset.code}:${asset.issuer}`}
                      className={`row-enter ${asset.inactive ? 'overflow-hidden rounded-xl bg-card' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                    >
                      <TokenRow
                        code={asset.code}
                        verified={asset.verified}
                        icon={asset.icon}
                        chainIcons={asset.parts.map((p) => chainIcons.get(p.chain))}
                        masked={masked}
                        balanceText={formatBalance(asset.balance)}
                        valueText={asset.usdValue !== null ? formatSmall(asset.usdValue) : null}
                        priceText={asset.usdPrice !== null ? formatPrice(asset.usdPrice) : null}
                        changePct={asset.change24h}
                        note={asset.inactive ? 'Not activated' : undefined}
                        className={asset.inactive ? 'rounded-none' : undefined}
                        onClick={() =>
                          asset.inactive ? navigate('/receive') : setSelectedToken(asset)
                        }
                      />
                      {/* the activation step lives in the XLM card it belongs to */}
                      {asset.inactive && (
                        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            Receive at least 1 XLM to activate your Stellar account.
                          </p>
                          {activeNetwork.friendbotUrl ? (
                            <button
                              onClick={handleFundWithFriendbot}
                              disabled={fundingLoading}
                              className="shrink-0 cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:opacity-60"
                            >
                              {fundingLoading ? 'Funding...' : 'Use Friendbot'}
                            </button>
                          ) : (
                            <button
                              onClick={() => navigate('/receive', { state: { chain: 'stellar' } })}
                              className="shrink-0 cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                            >
                              Receive XLM
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* A network with nothing to list still says where to start, so the
                    space under the filter never reads as broken. */}
                  {groupedBalances.length === 0 && (
                    <div className="row-enter flex flex-col items-center gap-3 rounded-xl bg-card px-5 py-6 text-center">
                      {tokenFilter !== ALL_NETWORKS && chainIcons.get(tokenFilter) && (
                        <img
                          src={chainIcons.get(tokenFilter)}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {filterName ? `No ${filterName} assets yet` : 'No assets yet'}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {filterName
                            ? `Your ${filterName} address is ready to receive.`
                            : 'Your addresses are ready to receive.'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate('/receive', {
                            state: {
                              chain: tokenFilter.startsWith('eip155')
                                ? 'evm'
                                : tokenFilter.startsWith('bip122')
                                  ? 'bitcoin'
                                  : 'stellar',
                            },
                          })
                        }
                      >
                        <QrCode size={14} /> Receive
                      </Button>
                      {hiddenZeroCount > 0 && (
                        <button
                          onClick={toggleHideZero}
                          className="cursor-pointer text-xs font-medium text-primary hover:underline"
                        >
                          Show zero balances
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!active && status.publicKey && (
                <SuggestedAssets
                  networkId={activeNetwork.id}
                  publicKey={status.publicKey}
                  balances={balances}
                  isFunded={isFunded}
                  chainFilter={tokenFilter === ALL_NETWORKS ? null : tokenFilter}
                  chainIcons={chainIcons}
                  chainNames={chainNames}
                  onAdded={() => refresh()}
                />
              )}
            </>
          )}

          {fundingError && <p className="text-xs text-destructive text-center">{fundingError}</p>}

          {error && <Alert message={error} onRetry={() => refresh()} retrying={loading} />}
        </div>
        {active && (
          <div
            className="exit-handle"
            onPointerDown={(e) => {
              setSwiping(true)
              swipe.onPointerDown(e)
            }}
            onPointerMove={swipe.onPointerMove}
            onPointerUp={() => {
              setSwiping(false)
              swipe.onPointerUp()
            }}
            onPointerCancel={() => {
              setSwiping(false)
              swipe.onPointerUp()
            }}
            onMouseEnter={() => setExitHover(true)}
            onMouseLeave={() => setExitHover(false)}
          >
            <span className="exit-hint">Swipe up to exit</span>
            <span className="exit-grip" />
          </div>
        )}
      </Layout>

      <TokenDetailSheet
        asset={selectedToken}
        balances={balances}
        isFunded={isFunded}
        chainIcons={chainIcons}
        chainNames={chainNames}
        horizonUrl={activeNetwork.horizonUrl}
        onClose={() => setSelectedToken(null)}
      />

      <NetworkFilterSheet
        open={filterOpen}
        value={tokenFilter}
        options={networkOptions}
        chainIcons={chainIcons}
        onSelect={setTokenFilter}
        onClose={() => setFilterOpen(false)}
      />

      <ShieldedReceive open={shieldedReceiveOpen} onClose={() => setShieldedReceiveOpen(false)} />

      {pickerAction && (
        <ShieldedTokenPicker
          action={pickerAction}
          tokens={pickerRows}
          onSelect={(picked) => openShieldedForPool(picked, pickerAction)}
          onClose={() => setPickerAction(null)}
        />
      )}

      <ShieldedTokenSheet
        token={tappedToken}
        onSend={(picked) => openShieldedForPool(picked, 'send')}
        onReceive={() => setShieldedReceiveOpen(true)}
        onClose={() => setTappedPoolId(null)}
      />

      <ShieldedSend
        action={retryPlan ? retryPlan.kind : shieldedAction}
        retryPlan={retryPlan}
        status={shieldedStatus}
        poolId={poolId}
        assetLabel={shieldedLabel}
        decimals={shieldedDecimals}
        assetCode={selectedPool?.assetCode}
        assetIcon={selectedPool ? poolIcon(selectedPool) : undefined}
        native={!!selectedPool?.native}
        accountPk={activePublicKey}
        publicBalance={
          // Pools are Stellar-only while `balances` spans every chain; match on the
          // Stellar chain so the native pool reads XLM, not an EVM native such as ETH.
          (selectedPool?.native
            ? balances.find((b) => b.isNative && b.chain === stellarChainId)
            : balances.find(
                (b) =>
                  b.chain === stellarChainId &&
                  b.code === selectedPool?.assetCode &&
                  b.issuer === selectedPool?.assetIssuer
              )
          )?.balance ?? null
        }
        subentryCount={subentryCount}
        onChangeAsset={() => {
          // Reopen the picker for the current action so the chip switches pools.
          if (shieldedAction) setPickerAction(shieldedAction)
          setShieldedAction(null)
        }}
        onClose={() => {
          setShieldedAction(null)
          setRetryPlan(null)
        }}
        onDone={refreshShielded}
      />

      {!active && shieldedAvailable && !hintSeen && !loading && (
        <PrivateModeHint targetRef={cardRef} onDismiss={dismissHint} />
      )}

      {/* after the private-mode coach mark, never on top of it */}
      <WhatsNewSheet
        open={!whatsNewSeen && !loading && !active && (hintSeen || !shieldedAvailable)}
        version={WHATS_NEW_VERSION}
        onClose={dismissWhatsNew}
        onShowAddress={() => {
          dismissWhatsNew()
          navigate('/receive')
        }}
      />
    </>
  )
}
