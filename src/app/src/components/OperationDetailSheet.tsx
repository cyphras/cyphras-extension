import { useState, useEffect, useRef } from 'react'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { Copy, Check, ChevronDown, ExternalLink } from 'lucide-react'
import {
  AddressValue,
  AdvancedDetails,
  CopyValue,
  DetailRow as Row,
  NetworkValue,
  StatusPill,
} from '@/components/TxDetailParts'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/BottomSheet'
import { Collapse } from '@/components/Collapse'
import { AssetIcon } from '@/components/token/AssetIcon'
import { PhaseBadge } from '@/components/PhaseBadge'
import { DeliveryProgressBar } from '@/components/DeliveryProgressBar'
import type { Operation } from '@/hooks/useHistory'
import {
  getDirection,
  getOpLabel,
  getAmountDisplay,
  parseAsset,
  stroopsToXlm,
  trimZeros,
} from '@/lib/historyUtils'
import { getChainInfo } from '@/lib/chainInfo'
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

// Horizon reports an unlimited trustline as the int64 maximum.
const MAX_TRUST_LIMIT = '922337203685.4775807'

function AssetName({ code, issuer }: { code: string; issuer?: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {code}
      <VerifiedMark code={code} issuer={issuer} />
    </span>
  )
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

function formatNumber(s: string): string {
  const [whole, frac] = trimZeros(s).split('.')
  const grouped = Number(whole).toLocaleString('en-US')
  return frac ? `${grouped}.${frac}` : grouped
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
  const [feeStroops, setFeeStroops] = useState<number | null>(null)
  const feeCache = useRef<Map<string, bigint>>(new Map())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [splitsOpen, setSplitsOpen] = useState(false)
  const [xdrCopied, setXdrCopied] = useState(false)
  const [chain, setChain] = useState<{ name: string; icon?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setActionError(null)
  }, [op?.id])

  // The registry name ("Stellar Testnet") beats the bare network name, which
  // says nothing once EVM chains share the same history.
  useEffect(() => {
    let cancelled = false
    getChainInfo(networkId).then((info) => {
      if (!cancelled) setChain(info ? { name: info.name, icon: info.icon } : null)
    })
    return () => {
      cancelled = true
    }
  }, [networkId])

  useEffect(() => {
    if (!op || !op.transaction_hash) return
    setTxDetails(null)
    setAdvancedOpen(false)
    fetch(`${horizonUrl}/transactions/${op.transaction_hash}`)
      .then((r) => r.json())
      .then((data) => setTxDetails(data))
      .catch(() => {})
  }, [op?.transaction_hash, horizonUrl])

  // Re-derive only on a fee-relevant transition (commit, fail, recover, reclaim), not on reveal progress.
  const sendNotes = op?.cyphras_private?.direction === 'out' ? op.cyphras_private.notes : undefined
  const feeSig = sendNotes
    ? sendNotes
        .map(
          (n) =>
            `${n.txHash ?? ''}|${n.commitFeeStroops ?? ''}|${n.status === 'failed' ? 'F' : ''}|${n.recovered ? 'R' : ''}|${n.revealTxHash ?? ''}`
        )
        .join(',')
    : ''

  // Total sender fee: each committed note's commit gas (its captured commitFeeStroops, else Horizon) plus the relayer fee, or the reveal gas for self-reclaimed notes.
  useEffect(() => {
    if (!op) return
    const priv = op.cyphras_private
    if (priv?.direction !== 'out' || !priv.notes) {
      setFeeStroops(null)
      return
    }
    const notes = priv.notes
    const committed = notes.filter((n) => !!n.txHash)
    const relayerStroops = committed
      .filter((n) => !n.recovered)
      .reduce((sum, n) => sum + BigInt(n.relayerFee || '0'), 0n)
    const localCommitGas = committed.reduce((sum, n) => sum + BigInt(n.commitFeeStroops || '0'), 0n)
    const fetchCommitHashes = [
      ...new Set(committed.filter((n) => !n.commitFeeStroops).map((n) => n.txHash as string)),
    ]
    const reclaimHashes = notes
      .filter((n) => n.recovered && n.revealTxHash)
      .map((n) => n.revealTxHash as string)
    const hashes = [...fetchCommitHashes, ...reclaimHashes]
    const baseStroops = relayerStroops + localCommitGas
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const gasOf = async (h: string): Promise<bigint> => {
      const hit = feeCache.current.get(h)
      if (hit !== undefined) return hit
      const fee = await fetch(`${horizonUrl}/transactions/${h}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.fee_charged ? BigInt(d.fee_charged) : 0n))
        .catch(() => 0n)
      if (fee > 0n) feeCache.current.set(h, fee)
      return fee
    }
    const recompute = async () => {
      const charged = await Promise.all(hashes.map(gasOf))
      if (cancelled) return
      const gas = charged.reduce((a, b) => a + b, 0n)
      setFeeStroops(Number(baseStroops + gas))
      attempts += 1
      if (attempts < 12 && hashes.some((h) => !feeCache.current.has(h))) {
        timer = setTimeout(recompute, 3000)
      }
    }
    void recompute()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [feeSig, horizonUrl])

  if (!cur) return null

  const dir = getDirection(cur, publicKey)
  const amount = getAmountDisplay(cur)
  const label = getOpLabel(cur, publicKey)

  // A private send is many splits: flag any failed split as Partial (some delivered) or Failed, not a false "Confirmed".
  const priv = cur.cyphras_private
  const privFailures = priv
    ? (priv.failedCounters?.length ?? 0) + (priv.unsentCounters?.length ?? 0)
    : 0
  const privSomeDelivered = priv ? parseFloat(priv.deliveredAmount ?? '0') > 0 : false
  const status: { text: string; tone: 'ok' | 'warn' | 'bad' } =
    priv && privFailures > 0
      ? privSomeDelivered
        ? { text: 'Partial', tone: 'warn' }
        : { text: 'Failed', tone: 'bad' }
      : cur.transaction_successful === false
        ? { text: 'Failed', tone: 'bad' }
        : priv?.direction === 'out' && priv.phase && priv.phase.key !== 'delivered'
          ? { text: priv.phase.label, tone: 'warn' }
          : { text: 'Confirmed', tone: 'ok' }
  const chainName = chain?.name ?? `Stellar ${networkName}`

  const heroAsset: { code: string; issuer?: string } = (() => {
    if (priv) return { code: priv.asset }
    if (cur.type === 'create_claimable_balance') return parseAsset(cur.asset)
    if (cur.type === 'manage_sell_offer' || cur.type === 'create_passive_sell_offer')
      return {
        code: cur.selling_asset_type === 'native' ? 'XLM' : (cur.selling_asset_code ?? 'XLM'),
        issuer: cur.selling_asset_issuer,
      }
    if (cur.type === 'manage_buy_offer')
      return {
        code: cur.buying_asset_type === 'native' ? 'XLM' : (cur.buying_asset_code ?? 'XLM'),
        issuer: cur.buying_asset_issuer,
      }
    if (cur.asset_type === 'native' || !cur.asset_code) return { code: amount?.code || 'XLM' }
    return { code: cur.asset_code, issuer: cur.asset_issuer }
  })()
  const heroIcon = heroAsset.issuer
    ? iconMap.get(`${heroAsset.code}:${heroAsset.issuer}`)
    : undefined
  const trustRemoved = cur.limit === '0' || cur.limit === '0.0000000'

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

  const reclaimCounters = [...(priv?.failedCounters ?? []), ...(priv?.reclaimableCounters ?? [])]
  const showFee = txDetails && !(priv?.direction === 'out' && feeStroops)

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      zIndex={zIndex}
      title={
        <div className="flex items-center gap-3">
          <AssetIcon code={heroAsset.code} icon={heroIcon} chainIcons={[chain?.icon]} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs font-normal text-muted-foreground">{chainName}</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-card px-4 py-5 text-center">
          {amount?.amount ? (
            <p
              className={`text-2xl font-bold tabular-nums ${dir === 'in' ? 'text-green-500' : 'text-foreground'}`}
            >
              {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}
              {formatNumber(amount.amount)}{' '}
              <span className="text-base font-medium text-muted-foreground">{amount.code}</span>
              <VerifiedMark code={amount.code} issuer={heroAsset.issuer} className="ml-1 h-4 w-4" />
            </p>
          ) : cur.type === 'change_trust' && amount?.code ? (
            <p className="text-2xl font-bold text-foreground">
              {amount.code}
              <VerifiedMark code={amount.code} issuer={cur.asset_issuer} className="ml-1 h-4 w-4" />
            </p>
          ) : (
            <p className="text-lg font-semibold text-foreground">{label}</p>
          )}
          <StatusPill text={status.text} tone={status.tone} />
        </div>

        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <Row label="Date">
            {new Date(cur.created_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Row>
          <Row label="Network">
            <NetworkValue name={chainName} icon={chain?.icon} />
          </Row>

          {cur.type === 'payment' && !priv && (
            <>
              <Row label="From">
                <AddressValue address={cur.from} isYou={cur.from === publicKey} />
              </Row>
              <Row label="To">
                <AddressValue address={cur.to} isYou={cur.to === publicKey} />
              </Row>
            </>
          )}
          {(cur.type === 'path_payment_strict_send' ||
            cur.type === 'path_payment_strict_receive') && (
            <>
              {cur.source_amount && (
                <Row label="You paid">
                  <span className="tabular-nums">{formatNumber(cur.source_amount)} </span>
                  <AssetName
                    code={
                      cur.source_asset_type === 'native' ? 'XLM' : (cur.source_asset_code ?? '')
                    }
                    issuer={cur.source_asset_issuer}
                  />
                </Row>
              )}
              {cur.amount && (
                <Row label="Received">
                  <span className="tabular-nums">{formatNumber(cur.amount)} </span>
                  <AssetName
                    code={cur.asset_type === 'native' ? 'XLM' : (cur.asset_code ?? '')}
                    issuer={cur.asset_issuer}
                  />
                </Row>
              )}
              <Row label="From">
                <AddressValue address={cur.from} isYou={cur.from === publicKey} />
              </Row>
              <Row label="To">
                <AddressValue address={cur.to} isYou={cur.to === publicKey} />
              </Row>
            </>
          )}
          {cur.type === 'create_account' && (
            <>
              <Row label="Funded by">
                <AddressValue address={cur.funder} isYou={cur.funder === publicKey} />
              </Row>
              <Row label="New account">
                <AddressValue address={cur.account} isYou={cur.account === publicKey} />
              </Row>
            </>
          )}
          {cur.type === 'change_trust' && (
            <>
              <Row label="Asset">
                <AssetName code={cur.asset_code ?? ''} issuer={cur.asset_issuer} />
              </Row>
              {cur.asset_issuer && (
                <Row label="Issuer">
                  <AddressValue address={cur.asset_issuer} isYou={cur.asset_issuer === publicKey} />
                </Row>
              )}
              <Row label="Limit">
                {trustRemoved
                  ? 'Removed'
                  : !cur.limit || cur.limit === MAX_TRUST_LIMIT
                    ? 'Unlimited'
                    : formatNumber(cur.limit)}
              </Row>
            </>
          )}
          {(cur.type === 'manage_sell_offer' ||
            cur.type === 'manage_buy_offer' ||
            cur.type === 'create_passive_sell_offer') && (
            <>
              {cur.selling_asset_type && (
                <Row label="Selling">
                  <AssetName
                    code={
                      cur.selling_asset_type === 'native' ? 'XLM' : (cur.selling_asset_code ?? '')
                    }
                    issuer={cur.selling_asset_issuer}
                  />
                </Row>
              )}
              {cur.buying_asset_type && (
                <Row label="Buying">
                  <AssetName
                    code={
                      cur.buying_asset_type === 'native' ? 'XLM' : (cur.buying_asset_code ?? '')
                    }
                    issuer={cur.buying_asset_issuer}
                  />
                </Row>
              )}
              {cur.price && <Row label="Price">{formatNumber(cur.price)}</Row>}
            </>
          )}
          {cur.type === 'account_merge' && (
            <>
              <Row label="Account">
                <AddressValue
                  address={cur.source_account}
                  isYou={cur.source_account === publicKey}
                />
              </Row>
              <Row label="Merged into">
                <AddressValue address={cur.into} isYou={cur.into === publicKey} />
              </Row>
            </>
          )}
          {cur.type === 'invoke_host_function' && !priv && cur.function && (
            <Row label="Action">{formatHostFunction(cur.function)}</Row>
          )}
          {priv && (
            <>
              {priv.recipient && (
                <Row label="To">
                  <AddressValue address={priv.recipient} isYou={priv.recipient === publicKey} />
                </Row>
              )}
              {priv.phase && (
                <Row label="Delivery">
                  <span className="inline-flex justify-end">
                    <PhaseBadge phase={priv.phase} />
                  </span>
                </Row>
              )}
              {priv.direction === 'out' && feeStroops ? (
                <Row label="Total fee">
                  <span className="tabular-nums">
                    {trimZeros(stroopsToXlm(String(feeStroops)))} XLM
                  </span>
                </Row>
              ) : null}
            </>
          )}
          {cur.type === 'claim_claimable_balance' && (
            <Row label="Claimed by">
              <AddressValue
                address={cur.claimant ?? cur.source_account}
                isYou={(cur.claimant ?? cur.source_account) === publicKey}
              />
            </Row>
          )}
          {cur.type === 'create_claimable_balance' && (
            <>
              <Row label="From">
                <AddressValue
                  address={cur.source_account}
                  isYou={cur.source_account === publicKey}
                />
              </Row>
              {cur.asset && cur.asset !== 'native' && (
                <Row label="Issuer">
                  <AddressValue
                    address={parseAsset(cur.asset).issuer}
                    isYou={parseAsset(cur.asset).issuer === publicKey}
                  />
                </Row>
              )}
            </>
          )}
          {cur.type === 'set_options' && (
            <Row label="Account">
              <AddressValue address={cur.source_account} isYou={cur.source_account === publicKey} />
            </Row>
          )}
          {cur.type === 'manage_data' && cur.name && (
            <Row label="Key">
              <span className="font-mono">{cur.name}</span>
            </Row>
          )}

          {showFee && (
            <Row label="Network fee">
              <span className="tabular-nums">
                {trimZeros(stroopsToXlm(txDetails.fee_charged))} XLM
              </span>
            </Row>
          )}
          {txDetails?.memo && txDetails.memo_type !== 'none' && (
            <Row label="Memo">
              <span className="break-all">{txDetails.memo}</span>
            </Row>
          )}
          {cur.transaction_hash && (
            <Row label="Transaction">
              <CopyValue value={cur.transaction_hash} />
            </Row>
          )}
        </div>

        {priv?.direction === 'out' && priv.notes && priv.deliveredAmount !== priv.amount && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-card px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Delivered</span>
              <span className="tabular-nums text-foreground">
                {priv.deliveredAmount} of {priv.amount} {priv.asset}
              </span>
            </div>
            <DeliveryProgressBar key={cur.id} notes={priv.notes} />
            {priv.committedAmount !== undefined &&
              priv.committedAmount !== priv.deliveredAmount && (
                <span className="text-[11px] text-muted-foreground">
                  {priv.committedAmount} of {priv.amount} {priv.asset} has left your wallet so far
                </span>
              )}
          </div>
        )}

        {priv?.splitsDetail && priv.splitsDetail.length > 0 && (
          <div className="rounded-xl bg-card px-4">
            <button
              onClick={() => setSplitsOpen((p) => !p)}
              aria-expanded={splitsOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-2 py-3 text-xs text-foreground"
            >
              <span>
                Private splits
                <span className="text-muted-foreground">
                  {' '}
                  {priv.splitsDetail.filter((s) => s.status === 'revealed').length} of{' '}
                  {priv.splitsDetail.length} delivered
                </span>
              </span>
              <ChevronDown
                size={14}
                className={`text-muted-foreground transition-transform duration-300 ease-out ${splitsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <Collapse open={splitsOpen}>
              <div className="divide-y divide-border/60 border-t border-border/60">
                {priv.splitsDetail.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-2 text-xs">
                    <span className="tabular-nums text-foreground">
                      {s.amount} {priv.asset}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <PhaseBadge phase={splitPhase(s.status, s.scheduledFor)} size={12} />
                      {s.revealTxHash && (
                        <a
                          href={getExplorerTxUrl(s.revealTxHash, networkId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View delivery transaction"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Collapse>
          </div>
        )}

        {cur.transaction_hash && (
          <AdvancedDetails open={advancedOpen} onToggle={() => setAdvancedOpen((p) => !p)}>
            <Row label="Operation">
              <span className="font-mono">{cur.type}</span>
            </Row>
            {cur.type !== 'private_send' && (
              <Row label="Operation ID">
                <CopyValue value={cur.id} />
              </Row>
            )}
            {txDetails && <Row label="Ledger">#{txDetails.ledger.toLocaleString()}</Row>}
            {txDetails?.memo && txDetails.memo_type !== 'none' && (
              <Row label="Memo type">{txDetails.memo_type}</Row>
            )}
            {cur.type === 'change_trust' && cur.limit && !trustRemoved && (
              <Row label="Raw limit">
                <span className="font-mono">{cur.limit}</span>
              </Row>
            )}
            {cur.offer_id && <Row label="Offer ID">{cur.offer_id}</Row>}
            {cur.balance_id && (
              <Row label="Balance ID">
                <CopyValue value={cur.balance_id} />
              </Row>
            )}
            {priv?.splits !== undefined && <Row label="Private splits">{priv.splits}</Row>}
            <div className="py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Envelope XDR</span>
                {txDetails?.envelope_xdr && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(txDetails.envelope_xdr)
                      setXdrCopied(true)
                      window.setTimeout(() => setXdrCopied(false), 2000)
                    }}
                    aria-label={xdrCopied ? 'Envelope XDR copied' : 'Copy envelope XDR'}
                    className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {xdrCopied ? (
                      <Check size={11} className="text-green-500" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                )}
              </div>
              {txDetails?.envelope_xdr ? (
                <p className="max-h-24 overflow-y-auto break-all rounded-lg bg-muted p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {txDetails.envelope_xdr}
                </p>
              ) : (
                <div className="skeleton-sweep h-12 rounded-lg bg-muted" />
              )}
            </div>
          </AdvancedDetails>
        )}

        {priv?.direction === 'out' && reclaimCounters.length > 0 && (
          <div className="flex gap-3">
            <Button
              className="flex-1"
              disabled={submitting}
              onClick={() =>
                void privateAction(SERVICE_TYPES.PRIVATE_SELF_RECLAIM, reclaimCounters)
              }
            >
              {submitting ? 'Reclaiming' : 'Reclaim to my wallet'}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => void privateAction(SERVICE_TYPES.PRIVATE_REVEAL_NOTE, reclaimCounters)}
            >
              Deliver again
            </Button>
          </div>
        )}
        {priv?.direction === 'out' && (priv.unsentCounters?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            {priv.unsentCounters!.length} part
            {priv.unsentCounters!.length > 1 ? 's' : ''} could not be deposited (for example the
            balance was too low), so those funds never left your wallet. You can send again.
          </p>
        )}
        {actionError && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-foreground">
              {/not yet indexed/i.test(actionError)
                ? 'This part has not been deposited on-chain yet, so there is nothing to reclaim. Your funds are still in your wallet and Cyphras will keep retrying the delivery.'
                : 'Could not complete that just now. Your funds are safe in the pool, try again.'}
            </p>
            <p className="text-xs text-muted-foreground">{actionError}</p>
          </div>
        )}

        {cur.transaction_hash && (
          <Button variant="outline" className="w-full" asChild>
            <a
              href={getExplorerTxUrl(cur.transaction_hash, networkId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on explorer
              <ExternalLink size={13} className="ml-1.5" />
            </a>
          </Button>
        )}
      </div>
    </BottomSheet>
  )
}
