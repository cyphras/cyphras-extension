import type { CctpJobInfo } from '@ext-types/index'

export type CctpStatusIcon = 'spin' | 'clock' | 'done' | 'error'

export function shortAddr(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr
}

// A spinner means active work; a clock means an intentional wait.
export function statusMeta(status: CctpJobInfo['status']): {
  label: string
  icon: CctpStatusIcon
  note?: string
} {
  switch (status) {
    case 'created':
    case 'approving':
      return { label: 'Approving', icon: 'spin' }
    case 'burn_submitted':
      return { label: 'Burning', icon: 'spin' }
    case 'burned':
      return { label: 'Waiting for Circle', icon: 'clock' }
    case 'attested':
      return { label: 'Ready to mint', icon: 'spin' }
    case 'mint_submitted':
      return { label: 'Minting', icon: 'spin' }
    case 'approved':
      return {
        label: 'Paused',
        icon: 'clock',
        note: 'Approved, but the burn was not sent. Your USDC is still in your wallet.',
      }
    case 'blocked_trustline':
      return {
        label: 'Paused',
        icon: 'clock',
        note: 'Add a USDC trustline to receive your bridged funds',
      }
    case 'blocked_gas':
      return {
        label: 'Paused',
        icon: 'clock',
        note: 'Destination needs a bit more native balance to complete the mint',
      }
    case 'done':
      return { label: 'Done', icon: 'done' }
    case 'failed':
      return { label: 'Failed', icon: 'error' }
  }
}

export function isCctpInFlight(status: CctpJobInfo['status']): boolean {
  return status !== 'done' && status !== 'failed'
}

export type BridgeStepState = 'done' | 'active' | 'wait' | 'todo' | 'error' | 'paused'

// The bridge as the user thinks of it: one step per hop, with the job's
// status mapped onto whichever step is currently doing the work. The EVM
// source leg needs an ERC-20 approve first; Stellar burns directly.
export function bridgeSteps(job: CctpJobInfo): { label: string; state: BridgeStepState }[] {
  const labels =
    job.direction === 'evm-to-stellar'
      ? ['Approve', 'Burn on source', 'Circle attestation', 'Mint on destination']
      : ['Burn on source', 'Circle attestation', 'Mint on destination']
  const burnIdx = labels.indexOf('Burn on source')
  const attestIdx = labels.indexOf('Circle attestation')
  const mintIdx = labels.indexOf('Mint on destination')
  const activeIdx = (() => {
    switch (job.status) {
      case 'created':
      case 'approving':
        return job.direction === 'evm-to-stellar' ? 0 : burnIdx
      case 'approved':
      case 'burn_submitted':
        return burnIdx
      case 'burned':
        return attestIdx
      case 'attested':
      case 'mint_submitted':
      case 'blocked_trustline':
      case 'blocked_gas':
        return mintIdx
      case 'done':
        return labels.length
      case 'failed':
        return job.mintTxHash
          ? mintIdx
          : job.burnTxHash
            ? attestIdx
            : job.approveTxHash
              ? burnIdx
              : 0
    }
  })()
  return labels.map((label, i) => {
    let state: BridgeStepState = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo'
    if (i === activeIdx) {
      if (job.status === 'failed') state = 'error'
      else if (
        job.status === 'approved' ||
        job.status === 'blocked_trustline' ||
        job.status === 'blocked_gas'
      )
        state = 'paused'
      else if (job.status === 'burned') state = 'wait'
    }
    return { label, state }
  })
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'Under a minute'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// A Stellar burn finalizes in seconds at either speed; the Ethereum leg is what
// Standard waits on, roughly 15-20 minutes of block confirmations.
export function bridgeEta(
  direction: CctpJobInfo['direction'],
  speed?: 'standard' | 'fast'
): string {
  if (direction === 'stellar-to-evm') return '~1 min'
  return speed === 'fast' ? '~1-5 min' : '~15-20 min'
}
