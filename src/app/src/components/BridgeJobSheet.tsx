import { useState } from 'react'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { CctpCredit } from '@/components/BrandMarks'
import { BottomSheet } from '@/components/BottomSheet'
import { BridgeSteps, BridgeTxLinks } from '@/components/BridgeProgress'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import {
  AddressValue,
  AdvancedDetails,
  DetailRow,
  NetworkValue,
  StatusPill,
} from '@/components/TxDetailParts'
import { Button } from '@/components/ui/button'
import type { ChainEntry } from '@constants/chains'
import type { CctpJobInfo } from '@ext-types/index'
import { formatDuration, formatWhen, isCctpInFlight, statusMeta } from '@/lib/cctp'
import { bridgeReceived, circleFeeText, formatAmount } from '@/lib/activity'

export function BridgeJobSheet({
  job,
  title,
  leg,
  fromChainId,
  toChainId,
  fromChainName,
  toChainName,
  fromIcon,
  toIcon,
  chains,
  icon,
  price,
  onClose,
  onOpenBridge,
}: {
  job: CctpJobInfo | null
  title: string
  leg: 'out' | 'in'
  fromChainId: string
  toChainId: string
  fromChainName: string
  toChainName: string
  fromIcon?: string
  toIcon?: string
  chains: ChainEntry[]
  icon?: string
  price: number | null
  onClose: () => void
  onOpenBridge: () => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  if (!job) return null
  const inFlight = isCctpInFlight(job.status)
  const meta = statusMeta(job.status)
  const received = bridgeReceived(job)
  const fiat = (v: string) =>
    price !== null
      ? (parseFloat(v) * price).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : null
  const circleFee = circleFeeText(job)

  const sideRow = (
    sign: '-' | '+',
    amount: string,
    chainName: string,
    chainIcon?: string,
    estimate = false
  ) => (
    <div className="flex items-center gap-3 px-4 py-3">
      <AssetIcon code="USDC" icon={icon} chainIcons={[chainIcon]} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {sign === '-'
            ? 'Sent from'
            : job.status === 'approved'
              ? 'Not sent yet to'
              : inFlight
                ? 'Arriving on'
                : 'Received on'}{' '}
          {chainName}
        </p>
        <p
          className={`text-lg font-bold tabular-nums ${sign === '+' && !inFlight ? 'text-green-500' : 'text-foreground'}`}
        >
          {sign}
          {estimate ? '~' : ''}
          {formatAmount(amount)}{' '}
          <span className="text-sm font-medium text-muted-foreground">USDC</span>
          <VerifiedBadge className="ml-1 inline-block h-3.5 w-3.5 align-[-2px]" />
        </p>
      </div>
      {fiat(amount) && (
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{fiat(amount)}</p>
      )}
    </div>
  )

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <AssetIcon code="USDC" icon={icon} chainIcons={[leg === 'out' ? fromIcon : toIcon]} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs font-normal text-muted-foreground">
              {leg === 'out' ? fromChainName : toChainName}
            </p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-card">
          {sideRow('-', job.amount, fromChainName, fromIcon)}
          <div className="relative">
            <div className="mx-4 h-px bg-border" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-card px-1.5">
                <ArrowDown size={12} className="text-muted-foreground/60" />
              </span>
            </div>
          </div>
          {job.status !== 'failed' &&
            sideRow('+', received ?? job.amount, toChainName, toIcon, received === null)}
          <div className="flex justify-center pb-4">
            <StatusPill
              text={job.status === 'done' ? 'Completed' : meta.label}
              tone={job.status === 'failed' ? 'bad' : inFlight ? 'warn' : 'ok'}
            />
          </div>
          {meta.note && (
            <p className="-mt-2 px-4 pb-4 text-center text-xs text-muted-foreground">{meta.note}</p>
          )}
        </div>

        {job.status === 'failed' && job.lastError && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">
            {job.lastError}
          </p>
        )}

        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <DetailRow label="Started">{formatWhen(job.createdAt)}</DetailRow>
          {job.status === 'done' && job.mintBroadcastAt && (
            <DetailRow label="Took">
              {formatDuration(job.mintBroadcastAt - job.createdAt)}
            </DetailRow>
          )}
          <DetailRow label="Route">
            <span className="inline-flex items-center gap-1.5">
              <NetworkValue name={fromChainName} icon={fromIcon} />
              <ArrowRight size={12} className="text-muted-foreground" />
              <NetworkValue name={toChainName} icon={toIcon} />
            </span>
          </DetailRow>
          <DetailRow label="From">
            <AddressValue address={job.sourceAddress} />
          </DetailRow>
          <DetailRow label="To">
            <AddressValue address={job.destAddress} />
          </DetailRow>
          <DetailRow label="Circle fee">{circleFee}</DetailRow>
          <DetailRow label="Speed">{job.speed === 'fast' ? 'Fast' : 'Standard'}</DetailRow>
        </div>

        {(inFlight || job.status === 'failed') && <BridgeSteps job={job} />}

        <BridgeTxLinks job={job} fromChainId={fromChainId} toChainId={toChainId} chains={chains} />

        <AdvancedDetails open={advancedOpen} onToggle={() => setAdvancedOpen((p) => !p)}>
          <DetailRow label="Protocol">
            <CctpCredit label="Circle CCTP v2" />
          </DetailRow>
          <DetailRow label="Amount burned">
            <span className="font-mono">{job.amount} USDC</span>
          </DetailRow>
          {job.feeExecuted === undefined && (
            <DetailRow label="Max fee">
              <span className="font-mono">{job.maxFee} USDC</span>
            </DetailRow>
          )}
          {job.attestedAt && <DetailRow label="Attested">{formatWhen(job.attestedAt)}</DetailRow>}
          <DetailRow label="Job ID">
            <span className="font-mono">{job.id.slice(0, 12)}</span>
          </DetailRow>
        </AdvancedDetails>

        {inFlight && (
          <Button variant="outline" className="w-full" onClick={onOpenBridge}>
            {job.status === 'approved' ? 'Continue on Bridge page' : 'Track on Bridge page'}
          </Button>
        )}
      </div>
    </BottomSheet>
  )
}
