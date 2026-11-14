import type { NetworkFeeCaps, TransactionSigner } from '@cyphras/private'
import { CyphrasError } from '@cyphras/private'
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import type { ShieldedFeeReason } from '@ext-types/index'

// The most one transaction envelope's fee field holds; this wallet's signer takes no fee bumps, so
// it is the most any approval can lift one transaction's fee to.
export const MAX_ENVELOPE_FEE = 4_294_967_295n

// What the wallet pays without asking for one call: the SDK's default caps of 0.01 XLM to get
// included and 1 XLM of resources.
export const DEFAULT_FEE_BUDGET = 10_100_000n

// The SDK's default inclusion cap, which an approval never lowers.
const MIN_INCLUSION_CAP = 100_000n
// 0.01 XLM, the step the resource part of an approval rounds up to.
const RESOURCE_STEP = 100_000n
// The SDK's default resource cap.
const DEFAULT_RESOURCE_CAP = 10_000_000n

const stroops = (value: unknown): bigint | null =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null

const tenPercentOver = (value: bigint): bigint => (value * 11n + 9n) / 10n

export interface FeeCeiling {
  readonly inclusionCap: bigint
  readonly resourceCap: bigint
  readonly ceiling: bigint
}

// The caps one approval of a fee gives a transaction, from the inclusion and resource fees the
// wallet's own simulation reported: 10% above each, never below the default inclusion cap, the
// resource part rounded up to 0.01 XLM, and never past what one envelope carries. The room above
// the fee lets the next simulation move a little. Null for a fee that is not two whole stroop
// amounts, or that no envelope carries.
export function feeCeiling(inclusion: unknown, resource: unknown): FeeCeiling | null {
  const i = stroops(inclusion)
  const r = stroops(resource)
  if (i === null || r === null || i + r > MAX_ENVELOPE_FEE) return null
  const over = tenPercentOver(i)
  const inclusionCap = over > MIN_INCLUSION_CAP ? over : MIN_INCLUSION_CAP
  if (inclusionCap >= MAX_ENVELOPE_FEE) return null
  const rounded = ((tenPercentOver(r) + RESOURCE_STEP - 1n) / RESOURCE_STEP) * RESOURCE_STEP
  const resourceCap =
    inclusionCap + rounded > MAX_ENVELOPE_FEE ? MAX_ENVELOPE_FEE - inclusionCap : rounded
  return { inclusionCap, resourceCap, ceiling: inclusionCap + resourceCap }
}

// The network fee caps of one approved call. Rent and a high network fee take the approved room as
// the resource cap. A restore takes it as resource plus restore room, the part above the default
// resource cap as the restore room: the SDK sends a restore a call needs as a transaction of its
// own before the call and takes what it paid from that room alone, so the call after it is held to
// the default caps.
export function grantCaps(
  reason: ShieldedFeeReason,
  inclusionCap: bigint,
  ceiling: bigint
): NetworkFeeCaps {
  const room = ceiling - inclusionCap
  if (reason !== 'restore' || room <= DEFAULT_RESOURCE_CAP) {
    return { inclusion: inclusionCap, resource: room, restore: 0n }
  }
  return {
    inclusion: inclusionCap,
    resource: DEFAULT_RESOURCE_CAP,
    restore: room - DEFAULT_RESOURCE_CAP,
  }
}

// The most a call may pay in all once a fee is approved. A restore before another transaction of
// the call leaves that transaction the default room, so its most adds that room; a pool restore
// alone sends nothing after it.
export function grantBudget(
  reason: ShieldedFeeReason,
  ceiling: bigint,
  restoreOnly: boolean
): bigint {
  return reason === 'restore' && !restoreOnly ? ceiling + DEFAULT_FEE_BUDGET : ceiling
}

// The message of a budget refusal. The SDK keeps it on the plan the refusal stopped, which tells a
// budget stop from any other signing refusal after a worker restart too.
export const BUDGET_STOP_MESSAGE =
  'the network fees of this call would pass the most the user was shown'

// What the account's key signed for in the calls of one payment, deposit or action so far: the fee
// fields of the envelopes, an upper bound of what the network charged; whether one was a restore of
// the pool's entries, and whether one was the call itself, whose attempt then did not go through.
export interface FeeSpent {
  readonly signed: bigint
  readonly restored: boolean
  readonly attempted: boolean
}

const NOTHING_SPENT: FeeSpent = { signed: 0n, restored: false, attempted: false }

// Where a call stopped at its budget: the fee of the transaction it was not signed for, and what
// was signed for so far. It rides as the refusal's cause, which the SDK keeps when it names the
// payment the refusal stopped.
export class FeeBudgetStop {
  readonly inclusion: bigint
  readonly resource: bigint
  readonly spent: FeeSpent

  constructor(inclusion: bigint, resource: bigint, spent: FeeSpent) {
    this.inclusion = inclusion
    this.resource = resource
    this.spent = spent
  }
}

// The fee field of an envelope, split into the inclusion bid and the resource fee it declares, and
// whether its one operation restores archived entries.
function feeOf(
  envelope: string,
  networkPassphrase: string
): { total: bigint; resource: bigint; restore: boolean } {
  const tx = TransactionBuilder.fromXDR(envelope, networkPassphrase)
  if (!(tx instanceof Transaction)) return { total: BigInt(tx.fee), resource: 0n, restore: false }
  const ext = tx.toEnvelope().v1().tx().ext()
  const resource = ext.switch() === 1 ? BigInt(ext.sorobanData().resourceFee().toString()) : 0n
  const restore = tx.operations.length === 1 && tx.operations[0].type === 'restoreFootprint'
  return { total: BigInt(tx.fee), resource, restore }
}

// The signer of one SDK call. It signs envelopes whose fee fields add up to at most `budget`, the
// most the user was shown for the call, however many transactions the call sends: a restore before
// the call, a call sent again after an archival or a conflict. Past it, it refuses before signing,
// naming the fee it was asked for and what was signed for so far, `before` included, so the next
// step can be reviewed. A fee counts from the moment it is asked for, so two signs at once cannot
// both pass.
export function budgetSigner(
  signer: TransactionSigner,
  budget: bigint,
  before: FeeSpent = NOTHING_SPENT
): TransactionSigner {
  let signed = 0n
  let restored = before.restored
  let attempted = before.attempted
  return {
    publicKey: signer.publicKey,
    async signTransaction(envelope: string, networkPassphrase: string): Promise<unknown> {
      let fee: { total: bigint; resource: bigint; restore: boolean }
      try {
        fee = feeOf(envelope, networkPassphrase)
      } catch {
        throw new CyphrasError('signer_mismatch', 'the transaction to sign could not be read')
      }
      if (signed + fee.total > budget) {
        throw new CyphrasError(
          'signer_mismatch',
          BUDGET_STOP_MESSAGE,
          { feeBudget: true },
          {
            cause: new FeeBudgetStop(fee.total - fee.resource, fee.resource, {
              signed: before.signed + signed,
              restored,
              attempted,
            }),
          }
        )
      }
      signed += fee.total
      try {
        const reply = await signer.signTransaction(envelope, networkPassphrase)
        if (fee.restore) restored = true
        else attempted = true
        return reply
      } catch (err) {
        signed -= fee.total
        throw err
      }
    },
  }
}
