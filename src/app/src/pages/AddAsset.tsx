import { useState, useEffect, useRef } from 'react'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { useNavigate, useLocation } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useBalances } from '@/hooks/useBalances'
import { useAssetList } from '@/hooks/useAssetList'
import { useCustomAssets } from '@/hooks/useCustomAssets'
import { AddEvmToken } from '@/components/AddEvmToken'
import { evmChainsForEnv } from '@constants/chains'
import { useNetwork } from '@/context/NetworkContext'
import { Button } from '@/components/ui/button'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import WalletNavbar from '@/components/WalletNavbar'
import { AddTrustlineSheet, type PendingAsset } from '@/components/AddTrustlineSheet'
import { Search, ChevronLeft, CheckCircle2, X, Copy, Check, ExternalLink } from 'lucide-react'
import type { AssetListItem } from '@/lib/assetList'

function AssetInfoSheet({
  asset,
  added,
  onAdd,
  onClose,
}: {
  asset: AssetListItem | null
  added: boolean
  onAdd: (asset: AssetListItem) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const label = asset?.name && asset.name !== asset.code ? asset.name : undefined
  const sublabel = asset?.domain || (asset?.org && asset.org !== 'unknown' ? asset.org : undefined)

  return (
    <div
      className={`fixed inset-0 z-[80] transition-all duration-300 ${asset ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${asset ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col transition-transform duration-300 ease-out ${asset ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">Asset Info</p>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {asset && (
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {asset.icon ? (
                <img
                  src={asset.icon}
                  alt={asset.code}
                  className="h-12 w-12 rounded-full object-cover flex-shrink-0"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-muted-foreground">
                    {asset.code.slice(0, 2)}
                  </span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <p className="flex items-center gap-1 text-lg font-bold text-foreground leading-tight">
                  {asset.code}
                  <VerifiedMark code={asset.code} issuer={asset.issuer} className="h-4 w-4" />
                </p>
                {label && <p className="text-sm text-muted-foreground leading-tight">{label}</p>}
                {sublabel && (
                  <p className="text-xs text-muted-foreground leading-tight">{sublabel}</p>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-card px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground shrink-0">Issuer</p>
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-xs font-mono text-foreground truncate">
                  {asset.issuer.slice(0, 8)}...{asset.issuer.slice(-8)}
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(asset.issuer)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {copied ? (
                    <Check size={12} className="pop-enter text-green-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            </div>
            <a
              href={`https://stellar.expert/explorer/public/asset/${asset.code}-${asset.issuer}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View on stellar.expert <ExternalLink size={11} />
            </a>
            {added ? (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-emerald-500 font-medium">
                <CheckCircle2 size={16} />
                Already in your wallet
              </div>
            ) : (
              <Button className="w-full" onClick={() => onAdd(asset)}>
                Add {asset.code}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ManualEntrySheet({
  open,
  onAdd,
  onClose,
  horizonUrl,
}: {
  open: boolean
  onAdd: (code: string, issuer: string) => void
  onClose: () => void
  horizonUrl: string
}) {
  const [code, setCode] = useState('')
  const [issuer, setIssuer] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [notFoundWarning, setNotFoundWarning] = useState(false)

  async function handleAdd() {
    const trimCode = code.trim().toUpperCase()
    const trimIssuer = issuer.trim()
    if (!trimCode) {
      setError('Asset code is required')
      return
    }
    if (!trimIssuer || !/^G[A-Z2-7]{55}$/.test(trimIssuer)) {
      setError('Invalid issuer address')
      return
    }
    setError('')

    // If warning already shown, user is confirming - proceed directly
    if (notFoundWarning) {
      onAdd(trimCode, trimIssuer)
      return
    }

    setChecking(true)
    try {
      const res = await fetch(
        `${horizonUrl}/assets?asset_code=${trimCode}&asset_issuer=${trimIssuer}&limit=1`
      )
      const data = (await res.json()) as { _embedded?: { records?: unknown[] } }
      const exists = (data._embedded?.records?.length ?? 0) > 0
      if (!exists) {
        setNotFoundWarning(true)
        setChecking(false)
        return
      }
    } catch {
      // Network error - still let user proceed, don't block
    }
    setChecking(false)
    onAdd(trimCode, trimIssuer)
  }

  function handleClose() {
    setCode('')
    setIssuer('')
    setError('')
    setNotFoundWarning(false)
    onClose()
  }

  function handleInputChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value)
      setError('')
      setNotFoundWarning(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[80] transition-all duration-300 ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">Manual Entry</p>
          <button
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Enter the asset code and issuer address to add a custom trustline.
          </p>
          <input
            type="text"
            placeholder="Asset code (e.g. USDC)"
            value={code}
            onChange={handleInputChange(setCode)}
            className="w-full rounded-xl bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="text"
            placeholder="Issuer address (G...)"
            value={issuer}
            onChange={handleInputChange(setIssuer)}
            className="w-full rounded-xl bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          {notFoundWarning && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Asset not found on network
              </p>
              <p className="text-xs text-muted-foreground">
                No asset with this code exists for that issuer. The trustline will be created but
                your balance will stay 0 unless the issuer distributes this asset.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tap <span className="font-medium text-foreground">Add anyway</span> to proceed.
              </p>
            </div>
          )}

          <Button className="w-full mt-1" onClick={handleAdd} disabled={checking}>
            {checking ? 'Checking...' : notFoundWarning ? 'Add anyway' : 'Add asset'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AddAsset() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { balances } = useBalances(status.publicKey)
  const { assets: customAssets, addAsset } = useCustomAssets(
    activeNetwork.id,
    activeNetwork.horizonUrl,
    activeNetwork.passphrase,
    status.publicKey ?? ''
  )
  const { assets: assetList, loading: listLoading } = useAssetList()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetListItem | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [pendingAsset, setPendingAsset] = useState<PendingAsset | null>(null)
  const [chainTab, setChainTab] = useState<'stellar' | 'evm'>('stellar')

  // Other pages send the user here to add one specific token (Swap's
  // "Add to receive"); open its detail as soon as the list has it.
  const location = useLocation()
  const wanted = location.state as { code?: string; issuer?: string } | null
  const openedWanted = useRef(false)
  useEffect(() => {
    if (openedWanted.current || !wanted?.code || assetList.length === 0) return
    const match = assetList.find((a) => a.code === wanted.code && a.issuer === wanted.issuer)
    if (match) {
      openedWanted.current = true
      setSelectedAsset(match)
    }
  }, [assetList, wanted])
  const evmAvailable = evmChainsForEnv(activeNetwork.id).length > 0

  function isAlreadyAdded(code: string, issuer: string) {
    return (
      balances.some((b) => b.code === code && b.issuer === issuer) ||
      customAssets.some((ca) => ca.code === code && ca.issuer === issuer)
    )
  }

  const searchResults =
    searchQuery.trim().length > 0
      ? assetList
          .filter((a) => {
            const q = searchQuery.toLowerCase()
            return (
              (a.code ?? '').toLowerCase().includes(q) ||
              (a.name ?? '').toLowerCase().includes(q) ||
              (a.domain ?? '').toLowerCase().includes(q) ||
              (a.org ?? '').toLowerCase().includes(q)
            )
          })
          .slice(0, 20)
      : assetList.slice(0, 20)

  function openConfirm(asset: PendingAsset) {
    setSelectedAsset(null)
    setManualOpen(false)
    setPendingAsset(asset)
  }

  async function handleConfirm(asset: PendingAsset) {
    return addAsset({ code: asset.code, issuer: asset.issuer, domain: asset.domain })
  }

  return (
    <>
      {/* Fixed-layout page: header never scrolls */}
      <div className="flex flex-col h-screen bg-background overflow-hidden">
        <div className="shrink-0 bg-background border-b border-border/40">
          <div className="px-5 pt-5 pb-3">
            <WalletNavbar />
          </div>
          <div className="px-5 pb-3">
            {/* Page title row - matches all other pages exactly */}
            <div className="relative flex items-center justify-center mb-4">
              <button
                onClick={() => navigate(-1)}
                className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-bold text-foreground">Add Asset</h2>
            </div>
            {evmAvailable && (
              <div className="flex rounded-xl bg-muted p-1 mb-3">
                {(['stellar', 'evm'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setChainTab(tab)}
                    className={`cursor-pointer flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                      chainTab === tab
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab === 'stellar' ? 'Stellar' : 'EVM'}
                  </button>
                ))}
              </div>
            )}
            {/* Search input */}
            <div className={chainTab === 'evm' ? 'hidden' : 'relative'}>
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                autoFocus
                placeholder="Search by name, code, or domain..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="h-px bg-border/40" />
        </div>

        {/* Scrollable results */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {chainTab === 'evm' ? (
            <AddEvmToken />
          ) : (
            <>
              {listLoading && (
                <AutoSkeleton loading className="flex flex-col gap-1">
                  {[...Array(7)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5">
                      <img className="h-8 w-8 rounded-full" alt="" />
                      <div className="flex flex-1 flex-col gap-1.5">
                        <p className="text-sm leading-tight">placeholder</p>
                        <p className="text-xs">placeholder</p>
                      </div>
                    </div>
                  ))}
                </AutoSkeleton>
              )}
              {!listLoading && searchQuery && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No results for "{searchQuery}".
                </p>
              )}
              {!listLoading && searchResults.length > 0 && (
                <div className="flex flex-col gap-1">
                  {searchResults.map((asset) => {
                    const added = isAlreadyAdded(asset.code, asset.issuer)
                    return (
                      <button
                        key={`${asset.code}:${asset.issuer}`}
                        onClick={() => setSelectedAsset(asset)}
                        className={`cursor-pointer flex items-center justify-between w-full rounded-xl px-3 py-2.5 text-left transition-colors ${added ? 'bg-muted/40' : 'bg-card hover:bg-muted/60'}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {asset.icon ? (
                            <img
                              src={asset.icon}
                              alt={asset.code}
                              className="h-8 w-8 rounded-full flex-shrink-0 object-cover"
                              onError={(e) => {
                                ;(e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-muted-foreground">
                                {asset.code.slice(0, 2)}
                              </span>
                            </div>
                          )}
                          <div className="flex flex-col min-w-0">
                            <p
                              className={`flex items-center gap-1 text-sm font-medium leading-tight ${added ? 'text-muted-foreground' : 'text-foreground'}`}
                            >
                              {asset.code}
                              <VerifiedMark code={asset.code} issuer={asset.issuer} />
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-tight truncate">
                              {asset.domain ||
                                (asset.org && asset.org !== 'unknown'
                                  ? asset.org
                                  : `${asset.issuer.slice(0, 4)}...${asset.issuer.slice(-4)}`)}
                            </p>
                          </div>
                        </div>
                        {added && (
                          <div className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium flex-shrink-0 pl-2">
                            <CheckCircle2 size={13} />
                            <span>Added</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Fixed bottom bar */}
        {chainTab === 'stellar' && (
          <div className="shrink-0 bg-background border-t border-border/40 px-5 py-4">
            <button
              onClick={() => setManualOpen(true)}
              className="cursor-pointer w-full text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              Can't find it? Enter manually
            </button>
          </div>
        )}
      </div>

      {/* Asset info sheet */}
      <AssetInfoSheet
        asset={selectedAsset}
        added={selectedAsset ? isAlreadyAdded(selectedAsset.code, selectedAsset.issuer) : false}
        onAdd={(a) =>
          openConfirm({ code: a.code, issuer: a.issuer, icon: a.icon, domain: a.domain })
        }
        onClose={() => setSelectedAsset(null)}
      />

      {/* Manual entry sheet */}
      <ManualEntrySheet
        open={manualOpen}
        onAdd={(code, issuer) => openConfirm({ code, issuer })}
        onClose={() => setManualOpen(false)}
        horizonUrl={activeNetwork.horizonUrl}
      />

      {/* Add trustline confirm + success sheet */}
      <AddTrustlineSheet
        asset={pendingAsset}
        onConfirm={handleConfirm}
        onClose={() => setPendingAsset(null)}
        onDone={() => navigate(-1)}
      />
    </>
  )
}
