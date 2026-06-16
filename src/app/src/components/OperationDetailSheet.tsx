import { useState, useEffect, useRef } from 'react'
import {
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoSkeleton } from '@/components/AutoSkeleton'
import { StellarAvatar } from '@/components/StellarAvatar'
import { OpIcon } from '@/components/OpIcon'
import { PhaseBadge } from '@/components/PhaseBadge'
import type { Operation } from '@/hooks/useHistory'
import { getDirection, getOpLabel, getAmountDisplay, stroopsToXlm } from '@/lib/historyUtils'
import { splitPhase } from '@/lib/phase'
import { SERVICE_TYPES } from '@constants/services'

interface TxDetails {
  ledger: number
  created_at: string
  fee_charged: string
  envelope_xdr: string
  memo_type?: string
  memo?: string
  successful: boolean
}

function AddrVal({ addr }: { addr?: string }) {
  if (!addr) return <span className="text-xs font-mono text-foreground">-</span>
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <StellarAvatar publicKey={addr} size={14} />
      <span className="text-xs font-mono text-foreground">
        {addr.slice(0, 4)}...{addr.slice(-4)}
      </span>
    </div>
  )
}

function parseAssetLocal(assetStr?: string): { code: string; issuer?: string } {
  if (!assetStr || assetStr === 'native') return { code: 'XLM' }
  const [code, issuer] = assetStr.split(':')
  return { code: code ?? 'XLM', issuer }
}

interface Props {
  op: Operation | null
  publicKey: string
  horizonUrl: string
  iconMap: Map<string, string>
  onClose: () => void
  getExplorerTxUrl: (hash: string, networkId: string) => string
  networkId: string
  networkName: string
  onAction?: () => void
  zIndex?: string
}

export default function OperationDetailSheet({
  op,
  publicKey,
  horizonUrl,
  iconMap,
  onClose,
  getExplorerTxUrl,
  networkId,
  networkName,
  onAction,
  zIndex = 'z-[70]',
}: Props) {
  const isOpen = op !== null
  const lastOpRef = useRef<Operation | null>(null)
  if (op) lastOpRef.current = op
  const cur = lastOpRef.current

  const [txDetails, setTxDetails] = useState<TxDetails | null>(null)
  const [xdrOpen, setXdrOpen] = useState(false)
  const [hashCopied, setHashCopied] = useState(false)
  const [xdrCopied, setXdrCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setActionError(null)
  }, [op?.id])

  useEffect(() => {
    if (!op || !op.transaction_hash) return
    setTxDetails(null)
    setXdrOpen(false)
    fetch(`${horizonUrl}/transactions/${op.transaction_hash}`)
      .then((r) => r.json())
      .then((data) => setTxDetails(data))
      .catch(() => {})
  }, [op?.transaction_hash, horizonUrl])

  if (!cur) return null

  const dir = getDirection(cur, publicKey)
  const amount = getAmountDisplay(cur)
  const label = getOpLabel(cur, publicKey)

  function Row({
    label,
    value,
    mono = false,
  }: {
    label: string
    value: React.ReactNode
    mono?: boolean
  }) {
    return (
      <div className="flex justify-between gap-2 items-center">
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
        <div
          className={`text-xs text-foreground text-right min-w-0 truncate ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </div>
      </div>
    )
  }

  // Recovering reveals each failed split back to the sender; retrying re-delivers it to the recipient.
  async function privateAction(type: string, counters: number[]): Promise<void> {
    if (counters.length === 0 || submitting) {
      return
    }
    setSubmitting(true)
    setActionError(null)
    let failure = ''
    for (const counter of counters) {
      const res = await new Promise<{ error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type, counter }, (r) => resolve(r ?? {}))
      })
      if (res?.error) {
        failure = res.error
        break
      }
    }
    setSubmitting(false)
    if (failure) {
      // Keep the sheet open and show the reason so the action can be retried.
      setActionError(failure)
      onAction?.()
      return
    }
    onAction?.()
    onClose()
  }

  function formatHostFunction(fn: string): string {
    if (fn === 'HostFunctionTypeHostFunctionTypeInvokeContract') return 'Invoke contract'
    if (fn === 'HostFunctionTypeHostFunctionTypeCreateContract') return 'Create contract'
    if (fn === 'HostFunctionTypeHostFunctionTypeUploadContractWasm') return 'Upload WASM'
    return fn
      .replace(/HostFunctionType/g, '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
  }

  return (
    <div
      className={`fixed inset-0 ${zIndex} transition-all duration-300 ${isOpen ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col max-h-[92vh] transition-transform duration-300 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div className="rounded-xl bg-card p-4 flex items-center gap-4">
            <OpIcon op={cur} publicKey={publicKey} iconMap={iconMap} />
            <div className="flex flex-col gap-0.5 min-w-0">
              {amount?.amount ? (
                <p
                  className={`text-xl font-bold ${dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-red-500' : 'text-foreground'}`}
                >
                  {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}
                  {amount.amount}
                  {amount.code && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      {amount.code}
                    </span>
                  )}
                </p>
              ) : amount?.code ? (
                <p className="text-sm text-muted-foreground font-mono">{amount.code}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{label}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 flex-1">
              <p className="text-xs text-muted-foreground">Status</p>
              {cur.transaction_successful !== false ? (
                <div className="flex items-center gap-1.5 text-green-500">
                  <CheckCircle2 size={13} />
                  <span className="text-xs font-medium">Confirmed</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-destructive">
                  <XCircle size={13} />
                  <span className="text-xs font-medium">Failed</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="text-sm text-foreground">
              {new Date(cur.created_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>

          <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
            <p className="text-xs font-medium text-foreground">Operation details</p>
            <div className="h-px bg-border" />
            {cur.type === 'payment' && (
              <>
                <Row label="Type" value="payment" mono />
                <Row
                  label="Asset"
                  value={
                    cur.asset_type === 'native' ? (
                      'XLM (native)'
                    ) : (
                      <span className="font-mono font-medium">{cur.asset_code}</span>
                    )
                  }
                />
                {cur.asset_issuer && (
                  <Row label="Issuer" value={<AddrVal addr={cur.asset_issuer} />} />
                )}
                <Row label="From" value={<AddrVal addr={cur.from} />} />
                <Row label="To" value={<AddrVal addr={cur.to} />} />
                {cur.amount && <Row label="Amount" value={cur.amount} mono />}
              </>
            )}
            {(cur.type === 'path_payment_strict_send' ||
              cur.type === 'path_payment_strict_receive') && (
              <>
                <Row label="Type" value={cur.type} mono />
                <Row label="From" value={<AddrVal addr={cur.from} />} />
                <Row label="To" value={<AddrVal addr={cur.to} />} />
                {cur.source_amount && (
                  <Row
                    label="Sent"
                    value={`${cur.source_amount} ${cur.source_asset_type === 'native' ? 'XLM' : (cur.source_asset_code ?? '')}`}
                    mono
                  />
                )}
                {cur.amount && (
                  <Row
                    label="Received"
                    value={`${cur.amount} ${cur.asset_type === 'native' ? 'XLM' : (cur.asset_code ?? '')}`}
                    mono
                  />
                )}
                {cur.source_asset_issuer && (
                  <Row label="Source issuer" value={<AddrVal addr={cur.source_asset_issuer} />} />
                )}
                {cur.asset_issuer && (
                  <Row label="Dest issuer" value={<AddrVal addr={cur.asset_issuer} />} />
                )}
              </>
            )}
            {cur.type === 'create_account' && (
              <>
                <Row label="Type" value="create_account" mono />
                <Row label="Funder" value={<AddrVal addr={cur.funder} />} />
                <Row label="New account" value={<AddrVal addr={cur.account} />} />
                {cur.starting_balance && (
                  <Row label="Starting balance" value={`${cur.starting_balance} XLM`} mono />
                )}
              </>
            )}
            {cur.type === 'change_trust' && (
              <>
                <Row label="Type" value="change_trust" mono />
                <Row
                  label="Asset"
                  value={<span className="font-mono font-medium">{cur.asset_code}</span>}
                />
                {cur.asset_issuer && (
                  <Row label="Issuer" value={<AddrVal addr={cur.asset_issuer} />} />
                )}
                <Row label="Trustor" value={<AddrVal addr={cur.trustor} />} />
                <Row
                  label="Trust limit"
                  value={
                    cur.limit === '0' || cur.limit === '0.0000000'
                      ? '0 (removed)'
                      : (cur.limit ?? '-')
                  }
                  mono
                />
              </>
            )}
            {(cur.type === 'manage_sell_offer' ||
              cur.type === 'manage_buy_offer' ||
              cur.type === 'create_passive_sell_offer') && (
              <>
                <Row label="Type" value={cur.type} mono />
                {cur.selling_asset_code && (
                  <Row
                    label="Selling"
                    value={cur.selling_asset_type === 'native' ? 'XLM' : cur.selling_asset_code}
                    mono
                  />
                )}
                {cur.buying_asset_code && (
                  <Row
                    label="Buying"
                    value={cur.buying_asset_type === 'native' ? 'XLM' : cur.buying_asset_code}
                    mono
                  />
                )}
                {cur.amount && <Row label="Amount" value={cur.amount} mono />}
                {cur.price && <Row label="Price" value={cur.price} mono />}
                {cur.offer_id && <Row label="Offer ID" value={cur.offer_id} mono />}
              </>
            )}
            {cur.type === 'account_merge' && (
              <>
                <Row label="Type" value="account_merge" mono />
                <Row label="Account" value={<AddrVal addr={cur.source_account} />} />
                <Row label="Merged into" value={<AddrVal addr={cur.into} />} />
              </>
            )}
            {cur.type === 'invoke_host_function' && !cur.cyphras_private && (
              <>
                <Row label="Type" value="Contract call" />
                {cur.function && <Row label="Function" value={formatHostFunction(cur.function)} />}
              </>
            )}
            {cur.cyphras_private && (
              <>
                <Row
                  label="Type"
                  value={cur.cyphras_private.direction === 'out' ? 'Private send' : 'Received'}
                />
                <Row
                  label="Asset"
                  value={<span className="font-mono font-medium">{cur.cyphras_private.asset}</span>}
                />
                {cur.cyphras_private.recipient && (
                  <Row label="To" value={<AddrVal addr={cur.cyphras_private.recipient} />} />
                )}
                {cur.cyphras_private.splits !== undefined && (
                  <Row label="Private splits" value={String(cur.cyphras_private.splits)} mono />
                )}
                {cur.cyphras_private.phase && (
                  <Row label="Delivery" value={<PhaseBadge phase={cur.cyphras_private.phase} />} />
                )}
              </>
            )}
            {cur.type === 'claim_claimable_balance' && (
              <>
                <Row label="Type" value="claim_claimable_balance" mono />
                <Row
                  label="Claimant"
                  value={<AddrVal addr={cur.claimant ?? cur.source_account} />}
                />
                {cur.balance_id && (
                  <Row label="Balance ID" value={`${cur.balance_id.slice(0, 12)}...`} mono />
                )}
              </>
            )}
            {cur.type === 'create_claimable_balance' && (
              <>
                <Row label="Type" value="create_claimable_balance" mono />
                <Row
                  label="Asset"
                  value={(() => {
                    const p = parseAssetLocal(cur.asset)
                    return p.code === 'XLM' ? (
                      'XLM (native)'
                    ) : (
                      <span className="font-mono font-medium">{p.code}</span>
                    )
                  })()}
                />
                {cur.asset && cur.asset !== 'native' && (
                  <Row
                    label="Issuer"
                    value={<AddrVal addr={parseAssetLocal(cur.asset).issuer} />}
                  />
                )}
                <Row label="Sender" value={<AddrVal addr={cur.source_account} />} />
                {cur.amount && <Row label="Amount" value={cur.amount} mono />}
                {cur.balance_id && (
                  <Row label="Balance ID" value={`${cur.balance_id.slice(0, 12)}...`} mono />
                )}
              </>
            )}
            {cur.type === 'set_options' && (
              <>
                <Row label="Type" value="set_options" mono />
                <Row label="Account" value={<AddrVal addr={cur.source_account} />} />
              </>
            )}
            {cur.type === 'manage_data' && (
              <>
                <Row label="Type" value="manage_data" mono />
                {cur.name && <Row label="Key" value={cur.name} mono />}
              </>
            )}
            {cur.type !== 'private_send' && (
              <Row label="Operation ID" value={`${cur.id.slice(0, 10)}...`} mono />
            )}
          </div>

          {cur.cyphras_private?.splitsDetail && cur.cyphras_private.splitsDetail.length > 0 && (
            <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-foreground">
                Private splits ({cur.cyphras_private.splitsDetail.length})
              </p>
              <div className="h-px bg-border" />
              {cur.cyphras_private.splitsDetail.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-foreground">
                    {s.amount} {cur.cyphras_private!.asset}
                  </span>
                  <PhaseBadge phase={splitPhase(s.status, s.scheduledFor)} size={12} />
                </div>
              ))}
            </div>
          )}

          {cur.transaction_hash && (
            <>
              <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-2">
                <p className="text-xs font-medium text-foreground">Transaction</p>
                <div className="h-px bg-border" />
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Hash</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-mono text-foreground">
                      {cur.transaction_hash.slice(0, 6)}...{cur.transaction_hash.slice(-4)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(cur.transaction_hash)
                        setHashCopied(true)
                        window.setTimeout(() => setHashCopied(false), 2000)
                      }}
                      aria-label={hashCopied ? 'Transaction hash copied' : 'Copy transaction hash'}
                      className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      {hashCopied ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
                <AutoSkeleton loading={!txDetails}>
                  <Row
                    label="Ledger"
                    value={txDetails ? `#${txDetails.ledger.toLocaleString()}` : '-'}
                    mono
                  />
                  <Row
                    label="Fee charged"
                    value={txDetails ? `${stroopsToXlm(txDetails.fee_charged)} XLM` : '-'}
                    mono
                  />
                  <Row label="Network" value={networkName} />
                  {txDetails?.memo && txDetails.memo_type !== 'none' && (
                    <Row label={`Memo (${txDetails.memo_type})`} value={txDetails.memo} />
                  )}
                </AutoSkeleton>
              </div>

              <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-0">
                <button
                  onClick={() => setXdrOpen((p) => !p)}
                  aria-expanded={xdrOpen}
                  className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground hover:text-foreground w-full py-0.5"
                >
                  <span>Envelope XDR</span>
                  {xdrOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {xdrOpen &&
                  (txDetails?.envelope_xdr ? (
                    <div className="relative rounded-lg bg-muted p-3 mt-2">
                      <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-6">
                        {txDetails.envelope_xdr}
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(txDetails.envelope_xdr)
                          setXdrCopied(true)
                          window.setTimeout(() => setXdrCopied(false), 2000)
                        }}
                        aria-label={xdrCopied ? 'Envelope XDR copied' : 'Copy envelope XDR'}
                        className="cursor-pointer absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {xdrCopied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-muted p-3 mt-2 animate-pulse h-12" />
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 shrink-0">
          {cur.cyphras_private?.direction === 'out' &&
            (cur.cyphras_private.failedCounters?.length ?? 0) > 0 && (
              <div className="flex gap-3">
                <Button
                  className="flex-1"
                  disabled={submitting}
                  onClick={() =>
                    void privateAction(
                      SERVICE_TYPES.PRIVATE_RECOVER_NOTE,
                      cur.cyphras_private?.failedCounters ?? []
                    )
                  }
                >
                  {submitting ? 'Recovering' : 'Recover to my wallet'}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() =>
                    void privateAction(
                      SERVICE_TYPES.PRIVATE_REVEAL_NOTE,
                      cur.cyphras_private?.failedCounters ?? []
                    )
                  }
                >
                  Deliver again
                </Button>
              </div>
            )}
          {cur.cyphras_private?.direction === 'out' &&
            (cur.cyphras_private.reclaimableCounters?.length ?? 0) > 0 && (
              <Button
                variant="outline"
                className="w-full"
                disabled={submitting}
                onClick={() =>
                  void privateAction(
                    SERVICE_TYPES.PRIVATE_SELF_RECLAIM,
                    cur.cyphras_private?.reclaimableCounters ?? []
                  )
                }
              >
                {submitting ? 'Reclaiming' : 'Reclaim to my wallet'}
              </Button>
            )}
          {actionError && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-foreground">
                Could not complete that just now. Your funds are safe in the pool, try again.
              </p>
              <p className="text-xs text-muted-foreground">{actionError}</p>
            </div>
          )}
          <div className="flex gap-3">
            {cur.transaction_hash && (
              <Button variant="outline" className="flex-1" asChild>
                <a
                  href={getExplorerTxUrl(cur.transaction_hash, networkId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5"
                >
                  View on explorer <ExternalLink size={14} />
                </a>
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
