import { useState, useEffect, useRef } from 'react'
import {
  X,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Users,
  Coins,
  AlertTriangle,
  Send,
  QrCode,
  Zap,
  Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import { usePreferences } from '@/context/PreferencesContext'
import { useNavigate } from 'react-router-dom'
import type { AssetBalance } from '@/hooks/useBalances'
import { getIconMap } from '@/hooks/useBalances'
import { useHistory } from '@/hooks/useHistory'
import type { Operation } from '@/hooks/useHistory'
import { useWallet } from '@/context/WalletContext'
import { StellarAvatar } from '@/components/StellarAvatar'
import { useNetwork } from '@/context/NetworkContext'
import { OpIcon } from '@/components/OpIcon'
import OperationDetailSheet from '@/components/OperationDetailSheet'
import {
  getDirection,
  getOpLabel,
  getAmountDisplay,
  formatTime,
  isRelatedToAsset,
} from '@/lib/historyUtils'

interface OnChainData {
  supply: string | null
  numAccounts: number | null
  flags: {
    auth_required: boolean
    auth_revocable: boolean
    auth_clawback_enabled: boolean
  } | null
  homeDomain: string | null
  // XLM-only
  baseFeeStroops: number | null
  baseReserveStroops: number | null
}

function formatBalance(balance: string): string {
  const num = parseFloat(balance)
  if (num === 0) return '0'
  if (num < 0.01) return num.toFixed(7)
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })
}

function formatSupply(supply: string): string {
  const num = parseFloat(supply)
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors ml-1 shrink-0"
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

function XlmIconLarge() {
  return (
    <svg
      width="48"
      height="48"
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

function AssetIconLarge({ icon, code }: { icon?: string; code: string }) {
  const [imgError, setImgError] = useState(false)
  if (code === 'XLM') return <XlmIconLarge />
  if (icon && !imgError) {
    return (
      <img
        src={icon}
        alt={code}
        className="h-12 w-12 rounded-full object-cover shrink-0"
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

interface TokenDetailSheetProps {
  asset: AssetBalance | null
  horizonUrl: string
  onClose: () => void
}

export default function TokenDetailSheet({ asset, horizonUrl, onClose }: TokenDetailSheetProps) {
  const navigate = useNavigate()
  const {
    formatValue,
    formatPrice,
    getExplorerAssetUrl,
    getExplorerAccountUrl,
    getExplorerName,
    getExplorerTxUrl,
  } = usePreferences()
  const { activeNetwork } = useNetwork()
  const { status } = useWallet()
  const publicKey = status.publicKey ?? ''
  const { operations } = useHistory(status.publicKey)
  const [onChain, setOnChain] = useState<OnChainData | null>(null)
  const [fetching, setFetching] = useState(false)
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getIconMap(activeNetwork.id).then(setIconMap)
  }, [activeNetwork.id])

  // Close on account/network switch so the sheet never shows the previous context's asset against
  // freshly-fetched history. The guard skips the first run so it does not close on mount.
  const switchGuard = useRef(true)
  useEffect(() => {
    if (switchGuard.current) {
      switchGuard.current = false
      return
    }
    onClose()
  }, [activeNetwork.id, status.publicKey])

  // Keep the last non-null asset so content stays visible during the close animation
  const lastAssetRef = useRef<AssetBalance | null>(null)
  if (asset) lastAssetRef.current = asset
  const a = asset ?? lastAssetRef.current

  const isOpen = asset !== null

  useEffect(() => {
    if (!asset) return

    setFetching(true)
    setOnChain(null)
    const controller = new AbortController()

    async function load() {
      try {
        if (asset!.isNative) {
          const ledgerRes = await fetch(`${horizonUrl}/fee_stats`, { signal: controller.signal })
          const feeData = (await ledgerRes.json()) as {
            last_ledger_base_fee?: number | string
          }
          const ledgerLatestRes = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1`, {
            signal: controller.signal,
          })
          const ledgerData = (await ledgerLatestRes.json()) as {
            _embedded?: {
              records?: Array<{ base_fee_in_stroops?: number; base_reserve_in_stroops?: number }>
            }
          }
          const ledger = ledgerData._embedded?.records?.[0]
          setOnChain({
            supply: null,
            numAccounts: null,
            flags: null,
            homeDomain: null,
            baseFeeStroops:
              Number(feeData.last_ledger_base_fee ?? ledger?.base_fee_in_stroops ?? null) || null,
            baseReserveStroops: ledger?.base_reserve_in_stroops ?? null,
          })
        } else {
          const [assetRes, issuerRes] = await Promise.allSettled([
            fetch(
              `${horizonUrl}/assets?asset_code=${encodeURIComponent(asset!.code)}&asset_issuer=${encodeURIComponent(asset!.issuer)}&limit=1`,
              { signal: controller.signal }
            ),
            fetch(`${horizonUrl}/accounts/${encodeURIComponent(asset!.issuer)}`, {
              signal: controller.signal,
            }),
          ])

          let supply: string | null = null
          let numAccounts: number | null = null
          let flags: OnChainData['flags'] = null
          let homeDomain: string | null = null

          if (assetRes.status === 'fulfilled' && assetRes.value.ok) {
            const data = (await assetRes.value.json()) as {
              _embedded: {
                records: Array<{
                  amount?: string
                  num_accounts?: number
                  accounts?: { authorized?: number }
                  flags?: OnChainData['flags']
                }>
              }
            }
            const record = data._embedded?.records?.[0]
            if (record) {
              supply = record.amount ?? null
              numAccounts = record.num_accounts ?? record.accounts?.authorized ?? null
              flags = record.flags ?? null
            }
          }

          if (issuerRes.status === 'fulfilled' && issuerRes.value.ok) {
            const data = (await issuerRes.value.json()) as { home_domain?: string }
            homeDomain = data.home_domain ?? null
          }

          setOnChain({
            supply,
            numAccounts,
            flags,
            homeDomain,
            baseFeeStroops: null,
            baseReserveStroops: null,
          })
        }
      } catch {
        setOnChain({
          supply: null,
          numAccounts: null,
          flags: null,
          homeDomain: null,
          baseFeeStroops: null,
          baseReserveStroops: null,
        })
      } finally {
        setFetching(false)
      }
    }

    load()
    return () => controller.abort()
  }, [asset?.code, asset?.issuer, horizonUrl])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, onClose])

  const assetExplorerUrl = a
    ? getExplorerAssetUrl(a.code, a.isNative ? '' : a.issuer, activeNetwork.id)
    : ''
  const issuerExplorerUrl =
    a && !a.isNative ? getExplorerAccountUrl(a.issuer, activeNetwork.id) : ''

  const relatedOps = a
    ? operations.filter((op) => isRelatedToAsset(op, a.code, a.issuer, a.isNative))
    : []

  const activeFlags =
    a && !a.isNative && onChain?.flags
      ? ([
          onChain.flags.auth_required && 'Auth Required',
          onChain.flags.auth_revocable && 'Revocable',
          onChain.flags.auth_clawback_enabled && 'Clawback',
        ].filter(Boolean) as string[])
      : []

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {a && (
          <>
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>

            {/* header */}
            <div className="flex items-center justify-between px-5 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <AssetIconLarge icon={a.icon} code={a.code} />
                <div className="flex flex-col">
                  <p className="text-lg font-bold text-foreground leading-tight">{a.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.isNative
                      ? 'Stellar Lumens'
                      : onChain?.homeDomain
                        ? onChain.homeDomain
                        : fetching
                          ? 'Loading...'
                          : `${a.issuer.slice(0, 4)}...${a.issuer.slice(-4)}`}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 pb-5">
              {/* balance hero */}
              <div className="rounded-xl bg-card px-4 py-4 mb-4 text-center">
                <p className="text-3xl font-bold text-foreground tabular-nums">
                  {formatBalance(a.balance)}{' '}
                  <span className="text-xl text-muted-foreground">{a.code}</span>
                </p>
                {a.usdValue !== null && (
                  <p className="mt-1 text-sm text-muted-foreground">{formatValue(a.usdValue)}</p>
                )}
              </div>

              {/* stats card */}
              <div className="rounded-xl bg-card divide-y divide-border mb-4">
                {a.usdPrice !== null && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-muted-foreground">Price</span>
                    <span className="text-sm font-medium text-foreground tabular-nums">
                      {formatPrice(a.usdPrice)}
                    </span>
                  </div>
                )}

                <AutoSkeleton loading={fetching}>
                  {fetching ? (
                    // Placeholder rows that AutoSkeleton will mirror as skeletons
                    <>
                      {!a.isNative ? (
                        <>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Supply</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Holders</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Domain</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Issuer</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Base fee</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                          <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-muted-foreground">Base reserve</span>
                            <span className="text-sm font-medium">-</span>
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-muted-foreground">Explorer</span>
                        <span className="text-sm font-medium">-</span>
                      </div>
                    </>
                  ) : onChain ? (
                    <>
                      {/* non-native fields */}
                      {!a.isNative && (
                        <>
                          {onChain.supply != null && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Coins size={13} />
                                Supply
                              </div>
                              <span className="text-sm font-medium text-foreground tabular-nums">
                                {formatSupply(onChain.supply)} {a.code}
                              </span>
                            </div>
                          )}
                          {onChain.numAccounts != null && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Users size={13} />
                                Holders
                              </div>
                              <span className="text-sm font-medium text-foreground tabular-nums">
                                {onChain.numAccounts.toLocaleString('en-US')}
                              </span>
                            </div>
                          )}
                          {onChain.homeDomain && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Globe size={13} />
                                Domain
                              </div>
                              <a
                                href={`https://${onChain.homeDomain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                              >
                                {onChain.homeDomain}
                                <ExternalLink size={10} />
                              </a>
                            </div>
                          )}
                          <div className="flex items-start justify-between px-4 py-3 gap-4">
                            <span className="text-sm text-muted-foreground shrink-0">Issuer</span>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <StellarAvatar publicKey={a.issuer} size={14} />
                              <a
                                href={issuerExplorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-primary hover:underline truncate"
                              >
                                {a.issuer.slice(0, 4)}...{a.issuer.slice(-4)}
                              </a>
                              <CopyButton text={a.issuer} />
                            </div>
                          </div>
                        </>
                      )}

                      {/* XLM-only fields */}
                      {a.isNative && (
                        <>
                          {onChain.baseFeeStroops != null && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Zap size={13} />
                                Base fee
                              </div>
                              <span className="text-sm font-medium text-foreground tabular-nums">
                                {onChain.baseFeeStroops.toLocaleString('en-US')} stroops
                              </span>
                            </div>
                          )}
                          {onChain.baseReserveStroops != null && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Lock size={13} />
                                Base reserve
                              </div>
                              <span className="text-sm font-medium text-foreground tabular-nums">
                                {(onChain.baseReserveStroops / 10_000_000).toFixed(1)} XLM
                              </span>
                            </div>
                          )}
                        </>
                      )}

                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-muted-foreground">Explorer</span>
                        <a
                          href={assetExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          {getExplorerName()}
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </>
                  ) : null}
                </AutoSkeleton>
              </div>

              {/* flags */}
              {activeFlags.length > 0 && (
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 flex gap-2 mb-4">
                  <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-foreground">Asset flags</p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {activeFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-md bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-400"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* activity */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 px-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    Activity
                  </p>
                  {relatedOps.length > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {relatedOps.length}
                    </span>
                  )}
                  <div className="flex-1 h-px bg-border" />
                </div>

                {relatedOps.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No transactions yet
                  </p>
                ) : (
                  relatedOps.map((op) => {
                    const dir = getDirection(op, publicKey)
                    const amount = getAmountDisplay(op)
                    return (
                      <button
                        key={op.id}
                        className="cursor-pointer flex items-center gap-3 w-full rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors text-left"
                        onClick={() => setSelectedOp(op)}
                      >
                        <OpIcon op={op} publicKey={publicKey} iconMap={iconMap} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {getOpLabel(op, publicKey)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(op.created_at)}
                          </p>
                        </div>
                        {amount && (
                          <div className="text-right shrink-0">
                            {amount.amount && (
                              <p
                                className={`text-sm font-medium tabular-nums ${dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-foreground' : 'text-muted-foreground'}`}
                              >
                                {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}
                                {amount.amount}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground font-mono">{amount.code}</p>
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* sticky footer */}
            <div className="shrink-0 flex gap-3 border-t border-border px-5 py-4">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  onClose()
                  navigate('/send')
                }}
              >
                <Send size={14} />
                Send
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => {
                  onClose()
                  navigate('/receive')
                }}
              >
                <QrCode size={14} />
                Receive
              </Button>
            </div>
          </>
        )}
      </div>
      <OperationDetailSheet
        op={selectedOp}
        publicKey={publicKey}
        horizonUrl={horizonUrl}
        iconMap={iconMap}
        onClose={() => setSelectedOp(null)}
        getExplorerTxUrl={getExplorerTxUrl}
        networkId={activeNetwork.id}
        networkName={activeNetwork.name}
        zIndex="z-[80]"
      />
    </>
  )
}
