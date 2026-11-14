import type { NetworkFeeCaps } from '@cyphras/private'
import { ShieldedRefusal } from './errors'

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
  // Caps for that call alone; undefined keeps the default caps.
  readonly caps: NetworkFeeCaps | undefined
  // The most every transaction of the call may pay together, as the user was shown.
  readonly budget: bigint
  // The SDK warning codes whose meaning the sheet stated, which a review of the retry may carry
  // without being shown again.
  readonly warnings: readonly string[]
}

// Offers the background made, by a random ID the popup returns with the user's yes. They live in
// memory only, so a worker restart, a lock or an account switch ends them all.
const grants = new Map<string, FeeGrant & { readonly expires: number }>()

export function issueGrant(grant: FeeGrant): string {
  const id = crypto.randomUUID()
  grants.set(id, { ...grant, expires: Date.now() + APPROVAL_TTL_MS })
  return id
}

// The grant `id` names, used up at once; refused unless it is still open and for exactly this
// call, target, account and network.
export function takeGrant(
  id: unknown,
  call: FeeCall,
  target: string,
  account: unknown,
  network: unknown
): FeeGrant {
  const grant = typeof id === 'string' ? grants.get(id) : undefined
  if (typeof id === 'string') grants.delete(id)
  if (
    !grant ||
    grant.expires < Date.now() ||
    grant.call !== call ||
    grant.target !== target ||
    grant.account !== account ||
    grant.network !== network
  ) {
    throw new ShieldedRefusal(
      'invalid_fee_approval',
      'That approval is no longer open, so nothing was sent. Review the fee again.'
    )
  }
  return grant
}

export function dropGrants(): void {
  grants.clear()
}
