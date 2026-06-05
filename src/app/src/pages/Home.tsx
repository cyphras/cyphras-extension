import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useBalances } from '@/hooks/useBalances'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { Skeleton } from '@/components/ui/skeleton'
import WalletNavbar from '@/components/WalletNavbar'
import TokenDetailSheet from '@/components/TokenDetailSheet'
import type { AssetBalance } from '@/hooks/useBalances'
import {
  RefreshCw,
  Send,
  QrCode,
  History,
  Layers,
  ArrowUpDown,
  MoreHorizontal,
  EyeOff,
  Eye,
  Plus,
} from 'lucide-react'

function XlmIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="76 34 238 238"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      <circle cx="195.1" cy="153.1" r="118.9" fill="black" />
      <path
        fill="white"
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6
 c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8
 l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8
 s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9
 l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}
function AssetIcon({ icon, code }: { icon?: string; code: string }) {
  const [imgError, setImgError] = useState(false)

  if (code === 'XLM') {
    return <XlmIcon />
  }

  if (icon && !imgError) {
    return (
      <img
        src={icon}
        alt={code}
        className="h-8 w-8 rounded-full object-cover flex-shrink-0"
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-muted-foreground">
        {code.slice(0, 2).toUpperCase()}
      </span>
    </div>
  )
}

function BalanceSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="mt-2 h-7 w-32 rounded" />
        <Skeleton className="mt-1.5 h-3 w-24 rounded" />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2 rounded-xl bg-card py-3">
            <Skeleton className="h-4.5 w-4.5 rounded" />
            <Skeleton className="h-3 w-8 rounded" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3.5 w-12 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Skeleton className="h-3.5 w-16 rounded" />
              <Skeleton className="h-3 w-12 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { balances, totalUsd, dailyChangeUsd, dailyChangePct, loading, error, isFunded, refresh } =
    useBalances(status.publicKey)
  const { formatValue, formatPrice, hiddenAssets, hideBalance, setHideBalance } = usePreferences()
  const displayBalances = balances.filter((b) => !hiddenAssets.includes(`${b.code}:${b.issuer}`))
  const [fundingLoading, setFundingLoading] = useState(false)
  const [fundingError, setFundingError] = useState('')
  const [selectedToken, setSelectedToken] = useState<AssetBalance | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

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

  return (
    <>
      <Layout navbar={<WalletNavbar />}>
        <div className="flex flex-col gap-4">
          {loading ? (
            <BalanceSkeleton />
          ) : (
            <>
              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Total balance</p>
                  <button
                    onClick={() => setHideBalance(!hideBalance)}
                    className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {hideBalance ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
                <p className="mt-1 text-2xl font-bold text-foreground tracking-wider">
                  {hideBalance
                    ? '******'
                    : totalUsd !== null
                      ? formatSmall(totalUsd)
                      : formatValue(0)}
                </p>
                {!hideBalance && dailyChangeUsd !== null && dailyChangePct !== null && (
                  <p
                    className={`mt-0.5 text-xs font-medium ${dailyChangeUsd >= 0 ? 'text-green-500' : 'text-destructive'}`}
                  >
                    {dailyChangeUsd >= 0 ? '+' : ''}
                    {formatSmall(dailyChangeUsd)} ({dailyChangePct >= 0 ? '+' : ''}
                    {dailyChangePct.toFixed(2)}%)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { icon: Send, label: 'Send', onClick: () => navigate('/send') },
                  { icon: ArrowUpDown, label: 'Swap', onClick: () => navigate('/swap') },
                  { icon: QrCode, label: 'Receive', onClick: () => navigate('/receive') },
                  { icon: History, label: 'History', onClick: () => navigate('/history') },
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className="flex flex-col items-center gap-1.5 rounded-xl bg-card py-3 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Icon size={18} />
                    <span className="text-xs">{label}</span>
                  </button>
                ))}
              </div>

              {!isFunded && (
                <div className="rounded-xl bg-muted p-4 text-center flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-muted-foreground">Account not funded yet</p>
                    <p className="text-xs text-muted-foreground">
                      Send XLM to activate your account
                    </p>
                  </div>
                  {activeNetwork.friendbotUrl && status.publicKey && (
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={fundingLoading}
                      onClick={handleFundWithFriendbot}
                    >
                      {fundingLoading ? 'Funding...' : 'Fund with Friendbot'}
                    </Button>
                  )}
                </div>
              )}

              {isFunded && displayBalances.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Tokens
                    </p>
                    <div className="relative" ref={menuRef}>
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-30 w-48 rounded-xl border border-border bg-background shadow-lg py-1 overflow-hidden">
                          <button
                            className="cursor-pointer flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                            onClick={() => {
                              navigate('/assets/add')
                              setMenuOpen(false)
                            }}
                          >
                            <Plus size={14} className="text-muted-foreground" />
                            Add assets
                          </button>
                          <button
                            className="cursor-pointer flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                            onClick={() => {
                              navigate('/assets')
                              setMenuOpen(false)
                            }}
                          >
                            <Layers size={14} className="text-muted-foreground" />
                            Manage tokens
                          </button>
                          <button
                            className="cursor-pointer flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                            onClick={() => {
                              refresh()
                              setMenuOpen(false)
                            }}
                          >
                            <RefreshCw size={14} className="text-muted-foreground" />
                            Refresh
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {displayBalances.map((asset) => (
                    <button
                      key={`${asset.code}:${asset.issuer}`}
                      className="cursor-pointer flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors text-left"
                      onClick={() => setSelectedToken(asset)}
                    >
                      <div className="flex items-center gap-3">
                        <AssetIcon icon={asset.icon} code={asset.code} />
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-foreground">{asset.code}</p>
                          <p className="text-xs text-muted-foreground tracking-wider">
                            {hideBalance ? '****' : formatBalance(asset.balance)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {hideBalance ? (
                          <p className="text-sm font-medium text-foreground tracking-wider">****</p>
                        ) : asset.usdValue !== null ? (
                          <p className="text-sm text-foreground">{formatSmall(asset.usdValue)}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">-</p>
                        )}
                        {asset.usdPrice !== null && (
                          <p className="text-xs text-muted-foreground">
                            {formatPrice(asset.usdPrice)}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {fundingError && <p className="text-xs text-destructive text-center">{fundingError}</p>}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </Layout>

      <TokenDetailSheet
        asset={selectedToken}
        horizonUrl={activeNetwork.horizonUrl}
        onClose={() => setSelectedToken(null)}
      />
    </>
  )
}
