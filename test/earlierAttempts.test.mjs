// A payment shows one row, its newest attempt, so its actions stay at hand. While an earlier attempt
// of it may still land and none has, the row says so and never says the funds are back or that
// nothing went out; once an attempt landed the row is that one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { earlierMayLand, paymentRows } = await import('../src/background/shielded/history.ts')
const { planStatus } = await import('../src/app/src/lib/privateActivity.ts')
const { EARLIER_MAY_LAND } = await import('../src/app/src/lib/privateFees.ts')

const attempt = (planId, fields) => ({
  planId,
  familyId: 'a',
  kind: 'unshield',
  state: 'prepared',
  createdAt: 1,
  needsUserDecision: false,
  mustRetry: true,
  route: { kind: 'self', account: 'G' },
  relayerCode: null,
  lastError: null,
  exitConfirmed: null,
  deadlineBy: null,
  ...fields,
})

// The row of a payment as the history list builds it, with the flag the status view carries.
function row(plans) {
  const [shown] = paymentRows(plans)
  return { ...shown, earlierMayLand: earlierMayLand(shown, plans) }
}

test('an earlier attempt that may land is named on a held newest attempt', () => {
  const r = row([
    attempt('a', { state: 'submitted', createdAt: 1 }),
    attempt('b', { createdAt: 2, lastError: 'fee_above_cap' }),
  ])
  assert.equal(r.planId, 'b')
  assert.equal(r.earlierMayLand, true)
  const { label, detail } = planStatus(r, String)
  assert.equal(label, 'Needs your approval')
  assert.ok(detail.startsWith(EARLIER_MAY_LAND))
  assert.doesNotMatch(detail, /Nothing was sent|Nothing has left/)
})

test('an earlier attempt that may land is named on a dead newest attempt', () => {
  const r = row([
    attempt('a', { state: 'prepared', createdAt: 1 }),
    attempt('b', { state: 'dead', createdAt: 2 }),
  ])
  assert.equal(r.planId, 'b')
  assert.equal(r.earlierMayLand, true)
  const { detail } = planStatus(r, String)
  assert.match(detail, /An earlier attempt of this payment may still land\./)
  assert.doesNotMatch(detail, /back in Available/)
})

test('an earlier attempt that ended adds nothing to the row', () => {
  const r = row([
    attempt('a', { state: 'dead', createdAt: 1 }),
    attempt('b', { createdAt: 2, lastError: 'fee_above_cap' }),
  ])
  assert.equal(r.earlierMayLand, false)
  assert.doesNotMatch(planStatus(r, String).detail, /earlier attempt/)
})

test('an attempt that landed is the row, with nothing about earlier attempts', () => {
  const plans = [
    attempt('a', { state: 'confirmed', createdAt: 1 }),
    attempt('b', { state: 'dead', createdAt: 2 }),
  ]
  const r = row(plans)
  assert.equal(r.planId, 'a')
  assert.equal(r.earlierMayLand, false)
  assert.equal(earlierMayLand(plans[1], plans), false)
})
