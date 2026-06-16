import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useBalances } from '@/hooks/useBalances'
import { useCustomAssets } from '@/hooks/useCustomAssets'
import { useHiddenAssets } from '@/hooks/useHiddenAssets'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import TokenDetailSheet from '@/components/TokenDetailSheet'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import {
  Plus,
  Trash2,
  MoreHorizontal,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ExternalLink,
  SlidersHorizontal,
  ChevronLeft,
  Layers,
} from 'lucide-react'
import { Toggle } from '@/components/ui/toggle'
import WalletNavbar from '@/components/WalletNavbar'
import { StellarAvatar } from '@/components/StellarAvatar'
import { usePreferences } from '@/context/PreferencesContext'
import { useNetwork } from '@/context/NetworkContext'
import type { AssetBalance } from '@/hooks/useBalances'

function formatBalance(balance: string): string {
  const num = parseFloat(balance)
  if (num === 0) return '0'
  if (num < 0.01) return num.toFixed(7)
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })
}

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
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}

function AssetIcon({ icon, code }: { icon?: string; code: string }) {
  const [imgError, setImgError] = useState(false)
  if (code === 'XLM') return <XlmIcon />
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
      <span className="text-xs font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

export default function Assets() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { balances, loading, refresh: refreshBalances } = useBalances(status.publicKey)
  const { getExplorerTxUrl } = usePreferences()
  const { hiddenAssets, toggleHiddenAsset } = useHiddenAssets(
    activeNetwork.id,
    status.publicKey ?? ''
  )
  const { assets: customAssets, removeAsset } = useCustomAssets(
    activeNetwork.id,
    activeNetwork.horizonUrl,
    activeNetwork.passphrase,
    status.publicKey ?? ''
  )
  const [manageMode, setManageMode] = useState(false)
  const [selectedToken, setSelectedToken] = useState<AssetBalance | null>(null)
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AssetBalance | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeResult, setRemoveResult] = useState<{ txHash: string } | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [txHashCopied, setTxHashCopied] = useState(false)
  const [removeTxDetails, setRemoveTxDetails] = useState<{
    ledger: number
    created_at: string
    fee_charged: string
    envelope_xdr: string
  } | null>(null)
  const [xdrCopied, setXdrCopied] = useState(false)
  const lastRemoveRef = useRef<AssetBalance | null>(null)
  if (removeTarget) lastRemoveRef.current = removeTarget

  const [removeDomain, setRemoveDomain] = useState<string | null>(null)
  const [txDetailsOpen, setTxDetailsOpen] = useState(false)

  useEffect(() => {
    if (!removeTarget) return
    setRemoveDomain(null)
    setTxDetailsOpen(false)
    fetch(
      `${activeNetwork.horizonUrl}/assets?asset_code=${removeTarget.code}&asset_issuer=${removeTarget.issuer}&limit=1`
    )
      .then((r) => r.json())
      .then((data) => {
        const record = data._embedded?.records?.[0]
        if (record?.home_domain) setRemoveDomain(record.home_domain)
      })
      .catch(() => {})
  }, [removeTarget, activeNetwork.horizonUrl])

  async function handleConfirmRemove() {
    const asset = lastRemoveRef.current
    if (!asset) return
    setRemoving(true)
    setRemoveError(null)
    const result = await removeAsset(asset.code, asset.issuer)
    setRemoving(false)
    if (result.error) {
      setRemoveError(result.error)
      return
    }
    setRemoveResult({ txHash: result.txHash ?? '' })
    refreshBalances()
  }

  function handleRemoveDone() {
    setRemoveTarget(null)
    setRemoveResult(null)
    setRemoveError(null)
    setTxHashCopied(false)
    setRemoveTxDetails(null)
    setXdrCopied(false)
    setTxDetailsOpen(false)
  }

  useEffect(() => {
    if (!removeResult?.txHash) return
    setRemoveTxDetails(null)
    fetch(`${activeNetwork.horizonUrl}/transactions/${removeResult.txHash}`)
      .then((r) => r.json())
      .then((data) => setRemoveTxDetails(data))
      .catch(() => {})
  }, [removeResult?.txHash, activeNetwork.horizonUrl])

  const allAssets: Array<AssetBalance & { isCustomOnly: boolean }> = [
    ...balances.map((b) => ({ ...b, isCustomOnly: false })),
    ...customAssets
      .filter((ca) => !balances.find((b) => b.code === ca.code && b.issuer === ca.issuer))
      .map((ca) => ({
        code: ca.code,
        issuer: ca.issuer,
        balance: '0',
        isNative: false,
        usdPrice: null,
        usdValue: null,
        change24h: null,
        icon: undefined,
        isCustomOnly: true,
      })),
  ]

  const displayedAssets = manageMode
    ? allAssets
    : allAssets.filter((a) => !hiddenAssets.includes(`${a.code}:${a.issuer}`))

  const menuAsset = displayedAssets.find((a) => `${a.code}:${a.issuer}` === menuOpenKey) ?? null

  return (
    <>
      <Layout navbar={<WalletNavbar />}>
        <div className="flex flex-col gap-4 pb-20">
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Assets</h2>
            <button
              onClick={() => setManageMode((p) => !p)}
              aria-label="Manage tokens"
              aria-pressed={manageMode}
              className={`cursor-pointer absolute right-0 rounded-lg p-2 transition-colors ${manageMode ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {loading &&
              allAssets.length === 0 &&
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3"
                >
                  <div className="h-8 w-8 rounded-full bg-muted animate-pulse flex-shrink-0" />
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="h-3.5 w-16 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-10 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}

            {displayedAssets.map((asset) => {
              const key = `${asset.code}:${asset.issuer}`
              const isHidden = hiddenAssets.includes(key)
              return (
                <div
                  key={key}
                  className={`flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors ${isHidden && manageMode ? 'opacity-40' : ''}`}
                >
                  <button
                    type="button"
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0 text-left"
                    onClick={() => !manageMode && setSelectedToken(asset)}
                  >
                    <AssetIcon icon={asset.icon} code={asset.code} />
                    <div className="flex flex-col min-w-0">
                      <p className="text-sm font-medium text-foreground">{asset.code}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBalance(asset.balance)}
                      </p>
                    </div>
                  </button>
                  <div className="relative flex-shrink-0">
                    {manageMode ? (
                      <Toggle
                        checked={!isHidden}
                        onChange={() => toggleHiddenAsset(key)}
                        disabled={asset.isNative}
                      />
                    ) : (
                      <>
                        <button
                          onClick={
                            asset.isNative
                              ? undefined
                              : (e) => {
                                  e.stopPropagation()
                                  setMenuOpenKey(key)
                                }
                          }
                          disabled={asset.isNative}
                          aria-label={`${asset.code} token options`}
                          className={`rounded-lg p-1.5 transition-colors ${
                            asset.isNative
                              ? 'text-muted-foreground/30 cursor-not-allowed'
                              : 'cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {!loading && displayedAssets.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Layers size={24} className="text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-muted-foreground">No assets yet</p>
                  <p className="text-xs text-muted-foreground">Add assets to track them here</p>
                </div>
                <Button variant="outline" onClick={() => navigate('/assets/add')}>
                  <Plus size={14} />
                  Add asset
                </Button>
              </div>
            )}
          </div>
        </div>
      </Layout>

      {menuAsset && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpenKey(null)} />
          <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-background p-2 shadow-2xl">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium text-foreground">{menuAsset.code}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{menuAsset.issuer}</p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(menuAsset.issuer)
                setCopiedKey(menuOpenKey)
                setTimeout(() => setCopiedKey(null), 2000)
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-muted transition-colors"
            >
              {copiedKey === menuOpenKey ? <Check size={14} /> : <Copy size={14} />}
              {copiedKey === menuOpenKey ? 'Copied!' : 'Copy address'}
            </button>
            <button
              disabled={parseFloat(menuAsset.balance) > 0}
              title={parseFloat(menuAsset.balance) > 0 ? 'Clear your balance first' : undefined}
              onClick={() => {
                const target = menuAsset
                setMenuOpenKey(null)
                setRemoveTarget(target)
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                parseFloat(menuAsset.balance) > 0
                  ? 'text-muted-foreground/40 cursor-not-allowed'
                  : 'cursor-pointer text-destructive hover:bg-destructive/10'
              }`}
            >
              <Trash2 size={14} />
              Remove trustline
            </button>
          </div>
        </div>
      )}

      {!manageMode && (
        <div className="fixed bottom-0 left-0 right-0 z-10 bg-background border-t border-border px-5 pb-5 pt-3">
          <Button variant="outline" className="w-full" onClick={() => navigate('/assets/add')}>
            <Plus size={14} />
            Add an asset
          </Button>
        </div>
      )}

      <TokenDetailSheet
        asset={selectedToken}
        horizonUrl={activeNetwork.horizonUrl}
        onClose={() => setSelectedToken(null)}
      />

      {/* Remove trustline bottom sheet */}
      <div
        className={`fixed inset-0 z-[70] transition-all duration-300 ${removeTarget ? '' : 'pointer-events-none'}`}
      >
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${removeTarget ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => {
            if (!removing) {
              if (removeResult) handleRemoveDone()
              else {
                setRemoveTarget(null)
                setRemoveError(null)
              }
            }
          }}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] transition-transform duration-300 ease-out ${removeTarget ? 'translate-y-0' : 'translate-y-full'}`}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <p className="text-sm font-semibold text-foreground">
              {removeResult ? 'Transaction Sent' : 'Confirm Transaction'}
            </p>
            <button
              onClick={() => {
                if (!removing) {
                  if (removeResult) handleRemoveDone()
                  else {
                    setRemoveTarget(null)
                    setRemoveError(null)
                  }
                }
              }}
              disabled={removing}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {removeResult ? (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 text-center pt-1">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15">
                    <CheckCircle2 size={28} className="text-green-500" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-foreground">Transaction Sent</p>
                    <p className="text-sm text-muted-foreground">
                      {lastRemoveRef.current?.code} trustline removed
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Transaction hash</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(removeResult.txHash)
                          setTxHashCopied(true)
                          setTimeout(() => setTxHashCopied(false), 2000)
                        }}
                        className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {txHashCopied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                    <p className="font-mono text-xs text-foreground break-all leading-relaxed">
                      {removeResult.txHash}
                    </p>
                  </div>

                  <AutoSkeleton loading={!removeTxDetails}>
                    <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">Ledger</p>
                      <p className="text-sm font-mono text-foreground">
                        #{removeTxDetails?.ledger.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">Timestamp</p>
                      <p className="text-sm text-foreground">
                        {removeTxDetails?.created_at
                          ? new Date(removeTxDetails.created_at).toLocaleString('en-US', {
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
                        {removeTxDetails?.fee_charged
                          ? (parseInt(removeTxDetails.fee_charged) / 10_000_000).toFixed(7) + ' XLM'
                          : '-'}
                      </p>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">Network</p>
                      <p className="text-sm text-foreground">{activeNetwork.name}</p>
                    </div>
                    <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
                      <p className="text-xs font-medium text-foreground">Operations (1)</p>
                      <div className="h-px bg-border" />
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Type</span>
                        <span className="text-xs font-mono text-foreground">change_trust</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Asset</span>
                        <span className="text-xs font-mono font-medium text-foreground">
                          {lastRemoveRef.current?.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs text-muted-foreground shrink-0">Issuer</span>
                        <div className="flex items-center gap-1.5">
                          {lastRemoveRef.current?.issuer && (
                            <StellarAvatar publicKey={lastRemoveRef.current.issuer} size={14} />
                          )}
                          <span className="text-xs font-mono text-foreground">
                            {lastRemoveRef.current?.issuer
                              ? `${lastRemoveRef.current.issuer.slice(0, 4)}...${lastRemoveRef.current.issuer.slice(-4)}`
                              : '-'}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Trust limit</span>
                        <span className="text-xs font-mono text-foreground">0 (removed)</span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-0">
                      <button
                        onClick={() => setTxDetailsOpen((p) => !p)}
                        className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground hover:text-foreground w-full py-0.5"
                      >
                        <span>Envelope XDR</span>
                        {txDetailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {txDetailsOpen && removeTxDetails?.envelope_xdr && (
                        <div className="relative rounded-lg bg-muted p-3 mt-2">
                          <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                            {removeTxDetails.envelope_xdr}
                          </p>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(removeTxDetails.envelope_xdr)
                              setXdrCopied(true)
                              setTimeout(() => setXdrCopied(false), 2000)
                            }}
                            className="cursor-pointer absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {xdrCopied ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      )}
                    </div>
                  </AutoSkeleton>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
                <Button variant="outline" className="flex-1" asChild>
                  <a
                    href={getExplorerTxUrl(removeResult.txHash, activeNetwork.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5"
                  >
                    View on explorer <ExternalLink size={14} />
                  </a>
                </Button>
                <Button className="flex-1" onClick={handleRemoveDone}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                <div className="rounded-xl bg-card p-4 flex items-center gap-3">
                  <AssetIcon
                    icon={lastRemoveRef.current?.icon}
                    code={lastRemoveRef.current?.code ?? ''}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {removeDomain && (
                      <p className="text-xs text-muted-foreground">{removeDomain}</p>
                    )}
                    <p className="text-base font-bold text-foreground">
                      {lastRemoveRef.current?.code}
                    </p>
                    <p className="text-xs text-muted-foreground">Remove Trustline</p>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">Source account</p>
                  <div className="flex items-center gap-2">
                    {status.publicKey && <StellarAvatar publicKey={status.publicKey} size={18} />}
                    <p className="text-xs font-mono text-foreground">
                      {status.publicKey
                        ? `${status.publicKey.slice(0, 4)}...${status.publicKey.slice(-4)}`
                        : '-'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">Network</p>
                  <p className="text-sm text-foreground">{activeNetwork.name}</p>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">Fee (max)</p>
                  <p className="text-sm font-medium text-foreground">0.00001 XLM</p>
                </div>

                <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
                  <p className="text-xs font-medium text-foreground">Operations (1)</p>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <span className="text-xs font-mono text-foreground">change_trust</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Asset</span>
                    <span className="text-xs font-mono font-medium text-foreground">
                      {lastRemoveRef.current?.code}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-muted-foreground shrink-0">Issuer</span>
                    <div className="flex items-center gap-1.5">
                      {lastRemoveRef.current?.issuer && (
                        <StellarAvatar publicKey={lastRemoveRef.current.issuer} size={14} />
                      )}
                      <span className="text-xs font-mono text-foreground">
                        {lastRemoveRef.current?.issuer
                          ? `${lastRemoveRef.current.issuer.slice(0, 4)}...${lastRemoveRef.current.issuer.slice(-4)}`
                          : '-'}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Trust limit</span>
                    <span className="text-xs font-mono text-foreground">0 (remove)</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-xs text-muted-foreground shrink-0">
                      Network passphrase
                    </span>
                    <span
                      className="text-xs font-mono text-foreground truncate max-w-[130px]"
                      title={activeNetwork.passphrase}
                    >
                      {activeNetwork.passphrase.length > 22
                        ? activeNetwork.passphrase.slice(0, 22) + '...'
                        : activeNetwork.passphrase}
                    </span>
                  </div>
                </div>

                {removeError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                    <p className="text-xs text-destructive">{removeError}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setRemoveTarget(null)
                    setRemoveError(null)
                  }}
                  disabled={removing}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleConfirmRemove}
                  disabled={removing}
                >
                  {removing ? 'Removing...' : 'Confirm'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
