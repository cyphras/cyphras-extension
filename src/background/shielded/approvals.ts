import type { NetworkFeeCaps } from '@cyphras/private'
import { ShieldedRefusal } from './errors'
import type { FeeSpent } from './fees'

// How long an offer to pay a fee from the account stays open, as long as a payment review.
const APPROVAL_TTL_MS = 3 * 60_000

// The call an offer is for: the shield of an amount, the self-relayed retry of a plan, an account
// action on a deposit or exit, or a pool restore.
export type FeeCall = 'shield' | 'retry' | 'cancel' | 'refund' | 'claim' | 'restore'

export interface FeeGrant {
  readonly call: FeeCall
  // The amount of a shield, the planId of a retry, the deposit or exit ID of an action, the pool of
  // a restore.
  readonly target: string
  readonly account: string
  readonly network: string
  readonly pool?: string
  // A shield that goes while an earlier deposit is still submitting.
  readonly whileSubmitting?: boolean
  // Caps for that call alone; undefined keeps the default caps.
  readonly caps: NetworkFeeCaps | undefined
  // The most every transaction of the call may pay together, as the user was shown.
  readonly budget: bigint
  // The SDK warning codes whose meaning the sheet stated, which a review of the retry may carry
  // without being shown again.
  readonly warnings: readonly string[]
  // What earlier calls of the same payment, deposit or action signed for, which a later stop adds to.
  readonly spent?: FeeSpent
}

// Offers the background made, by a random ID the popup returns with the user's yes. They live in
// memory only, so a worker restart, a lock or an account switch ends them all.
const grants = new Map<string, FeeGrant & { readonly expires: number }>()

export function issueGrant(grant: FeeGrant): string {
  const now = Date.now()
  for (const [id, open] of grants) if (open.expires < now) grants.delete(id)
  const id = crypto.randomUUID()
  grants.set(id, { ...grant, expires: Date.now() + APPROVAL_TTL_MS })
  return id
}

// The grant `id` names, used up at once; refused unless it is still open and for exactly this
// call, target, account, network, pool and, for a shield, deposit mode.
export function takeGrant(
  id: unknown,
  call: FeeCall,
  target: string,
  account: unknown,
  network: unknown,
  pool?: unknown,
  whileSubmitting?: boolean
): FeeGrant {
  const grant = typeof id === 'string' ? grants.get(id) : undefined
  if (typeof id === 'string') grants.delete(id)
  if (
    !grant ||
    grant.expires < Date.now() ||
    grant.call !== call ||
    grant.target !== target ||
    grant.account !== account ||
    grant.network !== network ||
    grant.pool !== pool ||
    grant.whileSubmitting !== whileSubmitting
  ) {
    throw new ShieldedRefusal(
      'invalid_fee_approval',
      'That approval is no longer open, so nothing was sent. Review the fee again.'
    )
  }
  return grant
}

// Ends an offer the user said no to, only at the request of the account it was made for.
export function dropGrant(id: unknown, account: unknown): void {
  if (typeof id === 'string' && grants.get(id)?.account === account) grants.delete(id)
}

export function dropGrants(): void {
  grants.clear()
}
