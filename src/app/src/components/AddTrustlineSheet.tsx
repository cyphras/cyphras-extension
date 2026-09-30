import { useState, useEffect } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import { StellarAvatar } from '@/components/StellarAvatar'
import { CheckCircle2, X, Copy, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { NetworkValue } from '@/components/TxDetailParts'
import { useStellarChain } from '@/hooks/useStellarChain'

export interface PendingAsset {
  code: string
  issuer: string
  icon?: string
  domain?: string
}

interface TxDetails {
  ledger: number
  created_at: string
  fee_charged: string
  envelope_xdr: string
}

export function AddTrustlineSheet({
  asset,
  onConfirm,
  onClose,
  onDone,
}: {
  asset: PendingAsset | null
  onConfirm: (asset: PendingAsset) => Promise<{ txHash?: string; error?: string }>
  onClose: () => void
  onDone: () => void
}) {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const stellarChain = useStellarChain()
  const { getExplorerTxUrl } = usePreferences()

  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txDetails, setTxDetails] = useState<TxDetails | null>(null)
  const [txDetailsOpen, setTxDetailsOpen] = useState(false)
  const [hashCopied, setHashCopied] = useState(false)
  const [xdrCopied, setXdrCopied] = useState(false)

  useEffect(() => {
    if (!txHash) return
    setTxDetails(null)
    fetch(`${activeNetwork.horizonUrl}/transactions/${txHash}`)
      .then((r) => r.json())
      .then((data) => setTxDetails(data))
      .catch(() => {})
  }, [txHash, activeNetwork.horizonUrl])

  useEffect(() => {
    if (asset) {
      setConfirming(false)
      setError(null)
      setTxHash(null)
      setTxDetails(null)
      setTxDetailsOpen(false)
      setHashCopied(false)
      setXdrCopied(false)
    }
  }, [asset?.code, asset?.issuer])

  async function handleConfirm() {
    if (!asset) return
    setConfirming(true)
    setError(null)
    const result = await onConfirm(asset)
    setConfirming(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setTxHash(result.txHash ?? '')
  }

  const open = !!asset

  return (
    <div
      className={`fixed inset-0 z-[90] transition-all duration-300 ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => {
          if (!confirming) {
            if (txHash) onDone()
            else onClose()
          }
        }}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">
            {txHash ? 'Transaction Sent' : 'Confirm Transaction'}
          </p>
          <button
            onClick={() => {
              if (!confirming) {
                if (txHash) onDone()
                else onClose()
              }
            }}
            disabled={confirming}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {txHash ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4 [&>*]:shrink-0">
              <div className="flex flex-col items-center gap-3 text-center pt-1">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15">
                  <CheckCircle2 size={28} className="text-green-500" />
                </div>
                <div>
                  <p className="text-base font-bold text-foreground">Transaction Sent</p>
                  <p className="text-sm text-muted-foreground">{asset?.code} trustline added</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Transaction hash</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(txHash)
                        setHashCopied(true)
                        setTimeout(() => setHashCopied(false), 2000)
                      }}
                      className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {hashCopied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <p className="font-mono text-xs text-foreground break-all leading-relaxed">
                    {txHash}
                  </p>
                </div>

                <AutoSkeleton loading={!txDetails}>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Ledger</p>
                    <p className="text-sm font-mono text-foreground">
                      #{txDetails?.ledger.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Timestamp</p>
                    <p className="text-sm text-foreground">
                      {txDetails?.created_at
                        ? new Date(txDetails.created_at).toLocaleString('en-US', {
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
                      {txDetails?.fee_charged
                        ? (parseInt(txDetails.fee_charged) / 10_000_000).toFixed(7) + ' XLM'
                        : '-'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Network</p>
                    <p className="text-sm text-foreground">
                      <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                    </p>
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
                        {asset?.code}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-muted-foreground shrink-0">Issuer</span>
                      <div className="flex items-center gap-1.5">
                        {asset?.issuer && <StellarAvatar publicKey={asset.issuer} size={14} />}
                        <span className="text-xs font-mono text-foreground">
                          {asset?.issuer
                            ? `${asset.issuer.slice(0, 4)}...${asset.issuer.slice(-4)}`
                            : '-'}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Trust limit</span>
                      <span className="text-xs font-mono text-foreground">Max</span>
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
                    {txDetailsOpen && txDetails?.envelope_xdr && (
                      <div className="relative rounded-lg bg-muted p-3 mt-2">
                        <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                          {txDetails.envelope_xdr}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(txDetails.envelope_xdr)
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
                  href={getExplorerTxUrl(txHash, activeNetwork.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5"
                >
                  View on explorer <ExternalLink size={14} />
                </a>
              </Button>
              <Button className="flex-1" onClick={onDone}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 [&>*]:shrink-0">
              <div className="rounded-xl bg-card p-4 flex items-center gap-3">
                {asset?.icon ? (
                  <img
                    src={asset.icon}
                    alt={asset.code}
                    className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-muted-foreground">
                      {asset?.code.slice(0, 2)}
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  {asset?.domain && <p className="text-xs text-muted-foreground">{asset.domain}</p>}
                  <p className="text-base font-bold text-foreground">{asset?.code}</p>
                  <p className="text-xs text-muted-foreground">Add Trustline</p>
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
                <p className="text-sm text-foreground">
                  <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
                </p>
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
                    {asset?.code}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-muted-foreground shrink-0">Issuer</span>
                  <div className="flex items-center gap-1.5">
                    {asset?.issuer && <StellarAvatar publicKey={asset.issuer} size={14} />}
                    <span className="text-xs font-mono text-foreground">
                      {asset?.issuer
                        ? `${asset.issuer.slice(0, 4)}...${asset.issuer.slice(-4)}`
                        : '-'}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-muted-foreground">Trust limit</span>
                  <span className="text-xs font-mono text-foreground">Max</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-xs text-muted-foreground shrink-0">Network passphrase</span>
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

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t border-border px-5 py-4 shrink-0">
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={confirming}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleConfirm} disabled={confirming}>
                {confirming ? 'Adding...' : 'Confirm'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
