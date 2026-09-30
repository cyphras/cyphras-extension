import { ExternalLink, CheckCircle2, AlertCircle, Loader2, Clock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chainById, explorerUrl, type ChainEntry } from '@constants/chains'
import type { CctpJobInfo } from '@ext-types/index'
import { PixelProgress } from '@/components/Pixel'
import {
  statusMeta,
  shortAddr,
  isCctpInFlight,
  bridgeSteps,
  type CctpStatusIcon,
  type BridgeStepState,
} from '@/lib/cctp'

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
  onDone,
  doneLabel,
}: {
  job: CctpJobInfo
  fromChainId: string
  toChainId: string
  // Registry-first chain lookup so panel-added chains still get names and
  // explorer links; falls back to the shipped builtins.
  chains?: ChainEntry[]
  onDone?: () => void
  doneLabel?: string
}) {
  const meta = statusMeta(job.status)
  const lookup = (id: string) => chains?.find((c) => c.id === id) ?? chainById(id)
  const fromName = lookup(fromChainId)?.name ?? fromChainId
  const toName = lookup(toChainId)?.name ?? toChainId

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-6 text-center">
        <CctpStatusIconView icon={meta.icon} />
        <p className="text-sm font-semibold text-foreground">{meta.label}</p>
        <PixelProgress steps={bridgeSteps(job).map((st) => st.state)} />
        <p className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {job.amount} USDC {fromName}
            <ArrowRight size={12} />
            {toName}
          </span>
          {job.speed === 'fast' && ' - Fast'}
        </p>
        {meta.note && <p className="text-xs text-muted-foreground">{meta.note}</p>}
        {job.status === 'failed' && job.lastError && (
          <p className="text-xs text-destructive">{job.lastError}</p>
        )}
      </div>

      <BridgeSteps job={job} />

      {isCctpInFlight(job.status) && (
        <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          Safe to close this window. Cyphras keeps the bridge moving in the background, and picks it
          up again after you unlock if the wallet locks.
        </p>
      )}

      <BridgeTxLinks job={job} fromChainId={fromChainId} toChainId={toChainId} chains={chains} />

      {onDone && (job.status === 'done' || job.status === 'failed') && (
        <Button className="w-full" onClick={onDone}>
          {doneLabel ?? (job.status === 'done' ? 'Bridge Again' : 'Start Over')}
        </Button>
      )}
    </div>
  )
}

export function BridgeSteps({ job }: { job: CctpJobInfo }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3">
      {bridgeSteps(job).map((s, i, all) => (
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
        const url = chain ? explorerUrl(chain.explorer.tx, l.hash) : null
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
