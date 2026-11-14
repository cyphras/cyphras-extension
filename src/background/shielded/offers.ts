import type { ShieldedErrorView } from '@ext-types/index'
import { issueGrant, type FeeCall } from './approvals'
import { errorView } from './errors'
import { DEFAULT_FEE_BUDGET, grantBudget, grantCaps } from './fees'

// What a self-paid transaction may need from the user: a fee above the default caps opens an offer
// for that call alone, with caps from the fee and the most the call may pay; a relayer that did not
// send a withdrawal opens an offer to submit it from the account at the default fee. Each offer is
// bound to the call, its target, the account and the network the request named, and the sheet that
// shows it states that paying from the account links it to the withdrawal.
const LINKS_ACCOUNT = 'self_relay_links_account'

// What else an offer is bound to: the pool, a shield's deposit mode, and the kind of payment, as
// only a withdrawal can be paid from the account.
export interface OfferBinding {
  readonly pool: unknown
  readonly whileSubmitting?: boolean
  readonly kind?: unknown
  // Warning codes the user confirmed earlier in the payment's flow.
  readonly confirmed?: readonly string[]
}

export function shieldedOffer(
  err: unknown,
  call: FeeCall,
  target: string | undefined,
  message: { publicKey?: unknown; networkId?: unknown },
  bound: OfferBinding
): { error: string; shieldedError: ShieldedErrorView } {
  const view = errorView(err)
  const response = { error: view.message, shieldedError: view }
  const scope = {
    account: String(message.publicKey),
    network: String(message.networkId),
    pool: typeof bound.pool === 'string' ? bound.pool : undefined,
    ...(call === 'shield' ? { whileSubmitting: bound.whileSubmitting === true } : {}),
  }
  const retry = call === 'retry'
  // A retry the offer approves may skip a review that warns of nothing the user did not already
  // confirm in this flow, or the sheet stated: that paying from the account links it.
  const stated = [...new Set([LINKS_ACCOUNT, ...(bound.confirmed ?? [])])]
  const on = retry ? view?.planId : target
  if (view?.fee && on !== undefined) {
    const ceiling = BigInt(view.fee.ceiling)
    const most = grantBudget(view.fee.reason, ceiling, call === 'restore')
    view.fee = {
      ...view.fee,
      most: most.toString(),
      approval: issueGrant({
        call,
        target: on,
        ...scope,
        caps: grantCaps(view.fee.reason, BigInt(view.fee.inclusionCap), ceiling),
        budget: most,
        warnings: retry ? stated : [],
        spent:
          view.fee.paid === undefined
            ? undefined
            : {
                signed: BigInt(view.fee.paid),
                restored: view.fee.restored === true,
                attempted: view.fee.attempted === true,
              },
      }),
    }
  }
  if (view?.refusal && view.planId && bound.kind === 'unshield') {
    view.selfPay = issueGrant({
      call: 'retry',
      target: view.planId,
      ...scope,
      caps: undefined,
      budget: DEFAULT_FEE_BUDGET,
      warnings: stated,
    })
  }
  return response
}
