import { CyphrasError } from '@cyphras/private'
import type { ShieldedErrorView } from '@ext-types/index'

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
      return 'That is not a valid testnet private address (cyt1...).'
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
      return `The relayer refused the payment (${d.code ?? 'no reason given'}).`
    case 'indexer_fault':
      return 'The indexer sent data that contradicts the chain, so none of it was kept.'
    case 'rpc_error':
      return 'The Stellar RPC returned an error. Try again shortly.'
    case 'tree_unverified':
      return 'The private balance is not verified against the pool yet. Try again shortly.'
    case 'history_unavailable':
      return 'The pool history is older than the RPC keeps, and no indexer is available.'
    case 'vault_unavailable':
      return `The pool cannot take this right now: ${err.message}.`
    case 'limit_exceeded':
      return limitMessage(d, err.message)
    case 'insufficient_funds':
      return 'Your private balance does not cover the amount and its fee.'
    case 'needs_consolidation':
      return 'No two of your private notes cover this amount. Try a smaller amount.'
    case 'fee_above_cap':
      if (d.fee !== undefined) {
        return `The relayer asks ${xlm(d.fee)}, above the ${xlm(d.cap)} this wallet allows.`
      }
      return 'The network fee is above the cap this wallet allows.'
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
      return 'The transaction could not be signed.'
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

export function errorView(err: unknown): ShieldedErrorView {
  if (err instanceof MayStillLand) {
    const view = errorView(err.cause)
    const message =
      view.code === 'unexpected' ? 'An unexpected error came after it was saved.' : view.message
    return { ...view, message, mayLand: true }
  }
  if (err instanceof CyphrasError) {
    const { planId } = err.details
    return {
      code: err.code,
      message: sdkMessage(err),
      ...(typeof planId === 'string' ? { planId, mayLand: true } : {}),
    }
  }
  if (err instanceof ShieldedRefusal) return { code: err.code, message: err.message }
  return {
    code: 'unexpected',
    message: 'Private mode is temporarily unavailable. Try again shortly.',
  }
}
