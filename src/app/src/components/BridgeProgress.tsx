import { useState } from 'react'
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, Clock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chainById, explorerUrl, type ChainEntry } from '@constants/chains'
import type { CctpJobInfo } from '@ext-types/index'
import { PixelProgress } from '@/components/Pixel'
import { usePreferences } from '@/context/PreferencesContext'
import {
  statusMeta,
  shortAddr,
  isCctpInFlight,
  bridgeSteps,
  bridgeEta,
  formatDuration,
  formatWhen,
  type CctpStatusIcon,
  type BridgeStepState,
} from '@/lib/cctp'
import { bridgeReceived, circleFeeText, usdcMinus } from '@/lib/activity'
import { CctpCredit } from '@/components/BrandMarks'
import { TradeLegs } from '@/components/TradeParts'
import { AddressValue, CopyValue, DetailRow, NetworkValue } from '@/components/TxDetailParts'

export function CctpStatusIconView({ icon, size = 16 }: { icon: CctpStatusIcon; size?: number }) {
  if (icon === 'spin') return <Loader2 size={size} className="animate-spin text-primary" />
  if (icon === 'clock') return <Clock size={size} className="animate-pulse text-primary" />
  if (icon === 'done') return <CheckCircle2 size={size} className="text-green-500" />
  return <AlertCircle size={size} className="text-destructive" />
}

function StepDot({ state }: { state: BridgeStepState }) {
  if (state === 'done') return <CheckCircle2 size={16} className="text-green-500" />
  if (state === 'active') return <Loader2 size={16} className="animate-spin text-primary" />
  if (state === 'wait' || state === 'paused')
    return <Clock size={16} className="animate-pulse text-primary" />
  if (state === 'error') return <AlertCircle size={16} className="text-destructive" />
  return <span className="block h-4 w-4 rounded-full border-2 border-border" />
}

export function BridgeProgress({
  job,
  fromChainId,
  toChainId,
  chains,
  usdcIcon,
  fromIcon,
  toIcon,
  price,
  onDone,
  doneLabel,
  onResume,
  onCancel,
}: {
  job: CctpJobInfo
  fromChainId: string
  toChainId: string
  // Registry-first chain lookup so panel-added chains still get names and
  // explorer links; falls back to the shipped builtins.
  chains?: ChainEntry[]
  usdcIcon?: string
  fromIcon?: string
  toIcon?: string
  price: number | null
  onDone?: () => void
  doneLabel?: string
  onResume?: () => Promise<string | null>
  onCancel?: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState<'resume' | 'cancel' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const act = async (kind: 'resume' | 'cancel', run: () => Promise<string | null>) => {
    setBusy(kind)
    setActionError(null)
    const error = await run()
    setBusy(null)
    if (error) setActionError(error)
  }
  const meta = statusMeta(job.status)
  const lookup = (id: string) => chains?.find((c) => c.id === id) ?? chainById(id)
  const fromName = lookup(fromChainId)?.name ?? fromChainId
  const toName = lookup(toChainId)?.name ?? toChainId
  const inFlight = isCctpInFlight(job.status)
  const received = bridgeReceived(job)
  // Until Circle's actual fee is known, the floor is the amount minus its cap.
  const receiveAmount = received ?? usdcMinus(job.amount, job.maxFee)
  const usd = (v: string) => (price !== null ? parseFloat(v) * price : null)

  const headline =
    job.status === 'done'
      ? { text: 'Completed', tone: 'text-green-500' }
      : job.status === 'failed'
        ? { text: 'Failed', tone: 'text-destructive' }
        : meta.label === 'Paused'
          ? { text: 'Paused', tone: 'text-amber-600 dark:text-amber-400' }
          : { text: 'In progress', tone: 'text-primary' }
  const timing =
    headline.text === 'In progress'
      ? `Est. time: ${bridgeEta(job.direction, job.speed)}`
      : job.status === 'done' && job.mintBroadcastAt
        ? `Took ${formatDuration(job.mintBroadcastAt - job.createdAt)}`
        : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl bg-card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-lg font-bold ${headline.tone}`}>{headline.text}</p>
            <p className="text-xs text-muted-foreground">
              {inFlight && headline.text === 'In progress' ? `${meta.label}. ` : ''}
              {timing}
            </p>
          </div>
          <CctpStatusIconView icon={meta.icon} size={20} />
        </div>
        <PixelProgress steps={bridgeSteps(job).map((st) => st.state)} />
        {meta.note && <p className="text-xs text-muted-foreground">{meta.note}</p>}
        {job.status === 'failed' && job.lastError && (
          <p className="text-xs text-destructive">{job.lastError}</p>
        )}
      </div>

      <TradeLegs
        pay={{
          label: `From ${fromName}`,
          code: 'USDC',
          icon: usdcIcon,
          chainIcon: fromIcon,
          amount: job.amount,
          usd: usd(job.amount),
        }}
        receive={{
          label:
            job.status === 'done'
              ? `Received on ${toName}`
              : job.status === 'failed'
                ? `Not delivered to ${toName}`
                : job.status === 'approved'
                  ? `Not sent yet to ${toName}`
                  : `Arriving on ${toName}${received === null ? ', at least' : ''}`,
          code: 'USDC',
          icon: usdcIcon,
          chainIcon: toIcon,
          amount: receiveAmount,
          usd: usd(receiveAmount),
          muted: job.status !== 'done',
        }}
      />

      {job.status === 'approved' && onResume && onCancel && (
        <div className="flex flex-col gap-2">
          {job.lastError && !actionError && (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              Last attempt: {job.lastError}
            </p>
          )}
          {actionError && <p className="px-1 text-xs text-destructive">{actionError}</p>}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void act('cancel', onCancel)}
            >
              {busy === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </Button>
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void act('resume', onResume)}
            >
              {busy === 'resume' ? 'Sending burn...' : 'Continue bridge'}
            </Button>
          </div>
        </div>
      )}

      <BridgeSteps job={job} />

      <div className="flex flex-col gap-1.5">
        <p className="pixel-label px-1 text-[10px] text-muted-foreground">Transaction details</p>
        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <DetailRow label="Network">
            <span className="inline-flex items-center gap-1.5">
              <NetworkValue name={fromName} icon={fromIcon} />
              <ArrowRight size={12} className="text-muted-foreground" />
              <NetworkValue name={toName} icon={toIcon} />
            </span>
          </DetailRow>
          <DetailRow label="Provider">
            <CctpCredit />
          </DetailRow>
          <DetailRow label="Receiving address">
            <AddressValue address={job.destAddress} />
          </DetailRow>
          <DetailRow label="Circle fee">{circleFeeText(job)}</DetailRow>
          {job.direction === 'evm-to-stellar' && (
            <DetailRow label="Speed">{job.speed === 'fast' ? 'Fast' : 'Standard'}</DetailRow>
          )}
        </div>
      </div>

      <BridgeTxLinks job={job} fromChainId={fromChainId} toChainId={toChainId} chains={chains} />

      <div className="flex flex-col gap-1.5">
        <p className="pixel-label px-1 text-[10px] text-muted-foreground">Order details</p>
        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <DetailRow label="Created at">{formatWhen(job.createdAt)}</DetailRow>
          <DetailRow label="Order no.">
            <CopyValue value={job.id} display={job.id.slice(0, 12)} />
          </DetailRow>
        </div>
      </div>

      {inFlight && job.status !== 'approved' && (
        <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          Safe to close this window. Cyphras keeps the bridge moving in the background, and picks it
          up again after you unlock if the wallet locks.
        </p>
      )}

      {onDone && (job.status === 'done' || job.status === 'failed') && (
        <Button className="w-full" onClick={onDone}>
          {doneLabel ?? (job.status === 'done' ? 'Bridge again' : 'Start over')}
        </Button>
      )}
    </div>
  )
}

// A process step by step, each with its state, as a bridge's or a private payment's.
export function StepList({ steps }: { steps: { label: string; state: BridgeStepState }[] }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3">
      {steps.map((s, i, all) => (
        <div key={s.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StepDot state={s.state} />
            {i < all.length - 1 && (
              <span
                className={`my-1 w-px flex-1 ${s.state === 'done' ? 'bg-green-500/50' : 'bg-border'}`}
              />
            )}
          </div>
          <p
            className={`pb-3 text-sm ${
              s.state === 'todo'
                ? 'text-muted-foreground'
                : s.state === 'error'
                  ? 'text-destructive'
                  : 'text-foreground'
            } ${i === all.length - 1 ? 'pb-0' : ''}`}
          >
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}

export function BridgeSteps({ job }: { job: CctpJobInfo }) {
  return <StepList steps={bridgeSteps(job)} />
}

export function BridgeTxLinks({
  job,
  fromChainId,
  toChainId,
  chains,
}: {
  job: CctpJobInfo
  fromChainId: string
  toChainId: string
  chains?: ChainEntry[]
}) {
  const lookup = (id: string) => chains?.find((c) => c.id === id) ?? chainById(id)
  const { getExplorerTxUrl, chainExplorer } = usePreferences()
  // Every leg follows the explorer chosen in Settings for its chain.
  const txUrl = (chainId: string, hash: string) => {
    if (chainId.startsWith('stellar:'))
      return getExplorerTxUrl(hash, chainId === 'stellar:pubnet' ? 'mainnet' : 'testnet')
    const chain = lookup(chainId)
    return chain ? explorerUrl(chainExplorer(chain).tx, hash) : null
  }
  const links: { label: string; hash: string; chainId: string }[] = []
  if (job.approveTxHash)
    links.push({ label: 'Approval', hash: job.approveTxHash, chainId: fromChainId })
  if (job.burnTxHash) links.push({ label: 'Burn', hash: job.burnTxHash, chainId: fromChainId })
  if (job.mintTxHash) links.push({ label: 'Mint', hash: job.mintTxHash, chainId: toChainId })
  if (links.length === 0) return null
  return (
    <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
      {links.map((l) => {
        const chain = lookup(l.chainId)
        const url = txUrl(l.chainId, l.hash)
        return (
          <a
            key={l.label}
            href={url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-4 py-2.5 text-xs"
          >
            <span className="min-w-0">
              <span className="block text-foreground">{l.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                on {chain?.name ?? l.chainId}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-foreground transition-colors group-hover:text-primary">
              {shortAddr(l.hash)}
              <ExternalLink size={11} className="text-muted-foreground" />
            </span>
          </a>
        )
      })}
    </div>
  )
}
