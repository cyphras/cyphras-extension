import { CyphrasError } from '@cyphras/private'
import type { ShieldedErrorView, ShieldedFeeEntry, ShieldedFeeView } from '@ext-types/index'
import { FeeBudgetStop, feeCeiling } from './fees'

// A failure after the transaction was sent: the deposit or payment it carries may still land.
export class MayStillLand extends Error {
  constructor(cause: unknown) {
    super('the transaction may still land', { cause })
  }
}

// Errors the background raises itself before the SDK runs; their text is written for the user.
export class ShieldedRefusal extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type Details = CyphrasError['details']

// XLM pools only, so every amount the SDK reports is in stroops of a 7-decimal asset.
function xlm(stroops: string | number | boolean | undefined): string {
  if (typeof stroops !== 'string' || !/^-?\d+$/.test(stroops)) return 'the limit'
  const units = BigInt(stroops)
  const whole = units / 10_000_000n
  const frac = (units % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')
  return `${frac ? `${whole}.${frac}` : whole} XLM`
}

// A limit shown to two decimals, rounded down, as no fee that large is paid.
function xlmLimit(stroops: string | number | boolean | undefined): string | null {
  if (typeof stroops !== 'string' || !/^\d+$/.test(stroops)) return null
  const hundredths = BigInt(stroops) / 100_000n
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`
}

function feeTotal(d: Details): string | null {
  const { inclusion, resource } = d
  if (typeof inclusion !== 'string' || !/^\d+$/.test(inclusion)) return null
  if (typeof resource !== 'string' || !/^\d+$/.test(resource)) return null
  return (BigInt(inclusion) + BigInt(resource)).toString()
}

const FEE_REASONS = ['network', 'rent', 'restore'] as const
const FEE_ENTRIES: readonly ShieldedFeeEntry[] = [
  'code',
  'instance',
  'tree',
  'balance',
  'asset',
  'record',
  'other',
]

// The fee a fee_above_cap names, with the caps an approval of it gives, or undefined when it is not
// the wallet's own network fee or no transaction could carry its ceiling. Entries are the SDK's
// kinds, one each, so no ledger name or key reaches the popup.
function feeView(d: Details): ShieldedFeeView | undefined {
  const reason = FEE_REASONS.find((r) => r === d.reason)
  const total = feeTotal(d)
  const caps = feeCeiling(d.inclusion, d.resource)
  if (!reason || total === null || !caps) return undefined
  const kinds = typeof d.entryKinds === 'string' ? d.entryKinds.split(',') : []
  const entries = [
    ...new Set(kinds.map((k) => FEE_ENTRIES.find((e) => e === k) ?? ('other' as const))),
  ]
  return {
    reason,
    total,
    inclusionCap: caps.inclusionCap.toString(),
    ceiling: caps.ceiling.toString(),
    most: caps.ceiling.toString(),
    ...(typeof d.paid === 'string' && /^\d+$/.test(d.paid) ? { paid: d.paid } : {}),
    entries,
  }
}

function historyMessage(d: Details): string {
  switch (d.reason) {
    case 'archive_unreachable':
      return "The pool history is older than the RPC keeps, no indexer is available, and the pool's archive copies could not be reached. Try again shortly."
    case 'archive_gap':
      return "The pool's archive copies end before the history the RPC keeps begins, so the private balance cannot be brought up to date yet. Try again later."
    case 'rpc_behind':
    case 'rpc_tail_short':
      return "The RPC is behind the pool's archive, so the private balance cannot be brought up to date yet. Try again shortly."
    default:
      return 'The pool history is older than the RPC keeps, and no indexer is available.'
  }
}

function refusalMessage(d: Details): string {
  switch (d.code) {
    case 'network_fee_high':
      return "The network fee is high right now, more than the relayer's fee covers. The relayer did not send your payment."
    case 'restore_needed':
      return 'The pool needs a restore that relayers do not pay for, so the relayer did not send your payment.'
    case 'fee_too_low':
      return "The relayer's fee changed while this was prepared. Try again."
    default:
      return 'The relayer refused the payment. Try again later.'
  }
}

function feeAboveCapMessage(d: Details): string {
  if (d.reason !== undefined) {
    return 'The network fee is above what this wallet pays without asking.'
  }
  if (d.queued === true) {
    return `The pool has a queue today, so the relayer asks ${xlm(d.fee)}, more than the ${xlm(d.cap)} this wallet allows.${typeof d.planId === 'string' ? '' : ' Nothing was sent.'}`
  }
  if (d.fee !== undefined) {
    return `The relayer asks ${xlm(d.fee)}, above the ${xlm(d.cap)} this wallet allows.`
  }
  return 'The network fee is above the cap this wallet allows.'
}

function feeAboveLimitMessage(d: Details): string {
  const total = feeTotal(d)
  const limit = xlmLimit(d.limit)
  const asking =
    total === null ? 'The network is asking for a fee' : `The network is asking about ${xlm(total)}`
  const carries = limit === null ? '' : ` (${limit} XLM)`
  return `${asking}, more than one transaction can carry${carries}. It cannot be sent from your account right now. Nothing was sent and your funds are unchanged.`
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

function limitMessage(d: Details, fallback: string): string {
  if (d.minDeposit !== undefined)
    return `The smallest deposit the pool takes is ${xlm(d.minDeposit)}.`
  if (d.maxDeposit !== undefined)
    return `The largest deposit the pool takes is ${xlm(d.maxDeposit)}.`
  if (d.room !== undefined) return `This goes over a limit; ${xlm(d.room)} is left for now.`
  if (d.maxPerTransaction !== undefined) {
    return `One withdrawal can move at most ${xlm(d.maxPerTransaction)}, fee included.`
  }
  return sentence(fallback)
}

function transactionFailedMessage(d: Details, fallback: string): string {
  // The RPC's report, which a deposit or payment saved before the send outlives: the popup decides
  // what may still land.
  if (d.refused === true) return 'The RPC reports that the network refused the transaction.'
  if (d.vaultError !== undefined) return `The pool refused the transaction (${d.vaultError}).`
  if (d.conflict === true) {
    return 'Other deposits kept landing first, so this one did not go through. Try again.'
  }
  if (d.archived === true) {
    return "The pool's data moved into storage while this was sent, so the network refused it."
  }
  if (d.secondProvider === 'no_diagnostics') {
    return 'The second RPC gave no diagnostics, so the outcome is unknown. Try another provider.'
  }
  // The SDK's own words say how it ended: failed on chain, or expired unconfirmed.
  return sentence(fallback)
}

function sdkMessage(err: CyphrasError): string {
  const d = err.details
  switch (err.code) {
    case 'invalid_address':
      return 'That is not a valid private address.'
    case 'deployment_not_pinned':
    case 'deployment_mismatch':
      return 'A private pool service does not match this wallet, so private payments are paused.'
    case 'artifact_mismatch':
      return 'The bundled circuit files failed their integrity check.'
    case 'prover_failed':
      return 'Proving failed on this device. Try again.'
    case 'proof_invalid':
      return 'The proof did not verify, so nothing was sent. Try again.'
    case 'storage_unreadable':
      return 'The saved private balance could not be read.'
    case 'state_unassigned':
      return 'The private records stored for this account cannot be told apart from those of another pool, so this pool cannot open them.'
    case 'state_conflict':
      return 'The private balance changed while this ran. Try again.'
    case 'service_unavailable':
      if (d.paused === true) {
        return 'The relayer has paused. You can still unshield without a relayer.'
      }
      return d.service === undefined
        ? 'A private pool service is unavailable. Try again shortly.'
        : `The private pool's ${d.service} is unavailable. Try again shortly.`
    case 'service_rejected':
      return refusalMessage(d)
    case 'indexer_fault':
      return 'The indexer sent data that contradicts the chain, so none of it was kept.'
    case 'archive_fault':
      return "A copy of the pool's archive contradicts the chain, so none of it was kept."
    case 'archive_conflict':
      return "The pool's archive copies do not confirm one another, or one could not be reached, so none of their history was used. Try again later."
    case 'rpc_error':
      return 'The Stellar RPC returned an error. Try again shortly.'
    case 'tree_unverified':
      return 'The private balance is not verified against the pool yet. Try again shortly.'
    case 'history_unavailable':
      return historyMessage(d)
    case 'vault_unavailable':
      return `The pool cannot take this right now: ${err.message}.`
    case 'limit_exceeded':
      return limitMessage(d, err.message)
    case 'insufficient_funds':
      return 'Your private balance does not cover the amount and its fee.'
    case 'needs_consolidation':
      return 'No two of your private notes cover this amount. Try a smaller amount.'
    case 'notes_refused':
      return 'Earlier payments with the notes this one needs were refused as already spent elsewhere, so nothing was sent. The next sync may clear this; until then try a smaller amount, or send it through a relayer.'
    case 'fee_above_cap':
      return feeAboveCapMessage(d)
    case 'fee_above_limit':
      return feeAboveLimitMessage(d)
    case 'restore_failed':
      return "The network did not accept the restore, so the pool's data is still in storage. A failed transaction can still cost its fee. Your private balance is unchanged and nothing was withdrawn."
    case 'operation_open':
      return typeof d.planId === 'string'
        ? 'A payment to this address has not finished yet. Finish it first so the same payment is not made twice.'
        : 'A payment to this address is still open. Check Private activity.'
    case 'quote_invalid':
      return 'The relayer quote failed a check, so nothing was sent.'
    case 'not_confirmed':
      // Only a review that comes after the payment was saved, one with a raised fee, names it.
      return typeof d.planId === 'string'
        ? 'The raised fee was not approved, so the payment was not proved again.'
        : 'Cancelled.'
    case 'destination_invalid':
      return sentence(err.message)
    case 'destination_is_issuer':
      return "That address is the asset's issuer, which would burn the payout."
    case 'signer_mismatch':
      return d.feeBudget === true
        ? 'The network fees of this would go past the most you were shown, so nothing more was sent.'
        : 'The transaction could not be signed.'
    case 'signer_rejected':
      return 'Signing was declined, so nothing was sent.'
    case 'transaction_failed':
      return transactionFailedMessage(d, err.message)
    case 'deposit_submitting':
      return 'An earlier deposit is still being submitted and may yet land.'
    case 'not_found':
      return 'That payment is no longer known to this wallet.'
    // Raised only once the payment is saved, so the error names its plan and it may still land.
    case 'unexpected_error':
      return 'An unexpected error stopped its submission after the payment was saved.'
    default:
      return sentence(err.message)
  }
}

// Errors that stop a saved payment before anything of it was sent, or that the relayer refused, so
// it cannot land unless its plan is retried: the user acts, and the payment goes on only through
// that retry, with the same notes.
function waitsForUser(err: CyphrasError): boolean {
  switch (err.code) {
    case 'fee_above_limit':
    case 'restore_failed':
      return true
    case 'signer_mismatch':
      return err.details.feeBudget === true
    case 'fee_above_cap':
      return err.details.reason !== undefined
    case 'service_rejected':
      return err.details.code === 'network_fee_high' || err.details.code === 'restore_needed'
    default:
      return false
  }
}

function cyphrasView(err: CyphrasError): ShieldedErrorView {
  const d = err.details
  const view: ShieldedErrorView = { code: err.code, message: sdkMessage(err) }
  // Raised before anything is proved: planId names the payment already open, not one of this call.
  if (err.code === 'operation_open') {
    return typeof d.planId === 'string' ? { ...view, openPlanId: d.planId } : view
  }
  if (typeof d.planId === 'string') {
    view.planId = d.planId
    if (!waitsForUser(err)) view.mayLand = true
  }
  const stop = err.cause instanceof FeeBudgetStop ? err.cause : undefined
  if (err.code === 'fee_above_cap' || (err.code === 'signer_mismatch' && stop)) {
    const fee = feeView(
      stop
        ? {
            reason: 'network',
            inclusion: stop.inclusion.toString(),
            resource: stop.resource.toString(),
            paid: stop.paid.toString(),
          }
        : d
    )
    if (fee) view.fee = fee
    if (d.queued === true) view.queued = true
  }
  if (err.code === 'service_rejected' && waitsForUser(err)) {
    view.refusal = d.code as 'network_fee_high' | 'restore_needed'
  }
  if (
    err.code === 'restore_failed' &&
    typeof d.hash === 'string' &&
    /^[0-9a-f]{64}$/.test(d.hash)
  ) {
    view.hash = d.hash
  }
  return view
}

export function errorView(err: unknown): ShieldedErrorView {
  if (err instanceof MayStillLand) {
    // A saved payment that waits on the user cannot land; a deposit that was sent still may.
    if (
      err.cause instanceof CyphrasError &&
      typeof err.cause.details.planId === 'string' &&
      waitsForUser(err.cause)
    ) {
      return cyphrasView(err.cause)
    }
    const view = errorView(err.cause)
    const message =
      view.code === 'unexpected' ? 'An unexpected error came after it was saved.' : view.message
    return { ...view, message, mayLand: true }
  }
  if (err instanceof CyphrasError) return cyphrasView(err)
  if (err instanceof ShieldedRefusal) return { code: err.code, message: err.message }
  return {
    code: 'unexpected',
    message: 'Private mode is temporarily unavailable. Try again shortly.',
  }
}
