// The private balance model against the SDK's balance: whatever is in flight, the parts add up to
// spendable + locked + pending deposits + payouts owed, and no part is negative.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateBalance } from '../src/app/src/lib/privateBalance.ts'

const XLM = 10_000_000n

function statusOf({
  spendable,
  locked,
  pendingDeposits = 0n,
  awaitingPayout = 0n,
  plans = [],
  deposits = [],
}) {
  return {
    address: 'cyt1qexample',
    balance: {
      spendable: String(spendable),
      locked: String(locked),
      pendingDeposits: String(pendingDeposits),
      awaitingPayout: String(awaitingPayout),
    },
    plans,
    deposits,
    syncedAt: null,
    syncError: null,
    services: 'verified',
    stateReset: null,
  }
}

// A payment of 10 XLM with a 0.1 XLM fee from 15 XLM of notes, unless the fields say otherwise.
function plan(fields) {
  const amount = BigInt(fields.amount ?? 10n * XLM)
  const fee = BigInt(fields.fee ?? XLM / 10n)
  const inputValue = BigInt(fields.inputValue ?? 15n * XLM)
  const planId = fields.planId ?? 'plan'
  return {
    planId,
    kind: 'send',
    to: 'cyt1qrecipient',
    route: { kind: 'relayer', url: 'https://relayer.example' },
    state: 'submitted',
    txHash: null,
    createdAt: 1,
    payoutLeft: null,
    exitConfirmed: null,
    strandedExits: [],
    relayerStatus: null,
    mustRetry: true,
    needsUserDecision: false,
    retryOf: null,
    familyId: planId,
    deadline: 5_000_000,
    deadlineBy: null,
    ...fields,
    amount: String(amount),
    fee: String(fee),
    inputValue: String(inputValue),
    change: String(inputValue - amount - fee),
  }
}

function deposit(fields) {
  return {
    id: 1,
    amount: String(5n * XLM),
    state: 'pending',
    txHash: 'a'.repeat(64),
    attested: null,
    earliestAdmission: null,
    flag: null,
    refundableAt: null,
    refundKind: null,
    confirmed: true,
    ...fields,
  }
}

const sdkTotal = ({ balance }) =>
  BigInt(balance.spendable) +
  BigInt(balance.locked) +
  BigInt(balance.pendingDeposits) +
  BigInt(balance.awaitingPayout)

const part = (model, key) => model.parts.find((p) => p.key === key)?.amount ?? 0n

function assertAddsUp(status, model) {
  assert.equal(model.total, sdkTotal(status))
  for (const p of model.parts) assert.ok(p.amount > 0n, `${p.key} is not positive`)
}

test('one payment in flight shows what leaves and the change that returns', () => {
  const status = statusOf({ spendable: 2n * XLM, locked: 15n * XLM, plans: [plan({})] })
  const model = privateBalance(status)
  assertAddsUp(status, model)
  assert.equal(part(model, 'sending'), 101n * (XLM / 10n))
  assert.equal(part(model, 'returning'), 49n * (XLM / 10n))
})

test('a stalled payment and its retry count their notes once, by the retry', () => {
  // The stalled payment's deadline passed before the wallet saw the whole pool; its retry spends
  // the same 15 XLM of notes, so only one of the two can land.
  const stalled = plan({ planId: 'stalled', needsUserDecision: true, createdAt: 1 })
  const retry = plan({
    planId: 'retry',
    retryOf: 'stalled',
    familyId: 'stalled',
    state: 'prepared',
    createdAt: 2,
  })
  const status = statusOf({ spendable: 2n * XLM, locked: 15n * XLM, plans: [retry, stalled] })
  const model = privateBalance(status)
  assertAddsUp(status, model)
  assert.equal(part(model, 'sending'), 101n * (XLM / 10n))
  assert.equal(part(model, 'returning'), 49n * (XLM / 10n))
  const sending = model.parts.find((p) => p.key === 'sending')
  assert.deepEqual(
    sending.items.map((i) => [i.plan.planId, i.amount]),
    [
      ['retry', 101n * (XLM / 10n)],
      ['stalled', 0n],
    ]
  )
})

test('a repriced pair counts its notes once, at the newer fee', () => {
  // The relayer refused the first proof's fee; the second proves the same notes with a higher one.
  const first = plan({ planId: 'first', state: 'prepared', createdAt: 1 })
  const repriced = plan({
    planId: 'repriced',
    retryOf: 'first',
    familyId: 'first',
    fee: (3n * XLM) / 10n,
    createdAt: 2,
  })
  const status = statusOf({ spendable: 0n, locked: 15n * XLM, plans: [repriced, first] })
  const model = privateBalance(status)
  assertAddsUp(status, model)
  assert.equal(part(model, 'sending'), 103n * (XLM / 10n))
  assert.equal(part(model, 'returning'), 47n * (XLM / 10n))
})

test('separate payments in flight each count', () => {
  const one = plan({ planId: 'one' })
  const other = plan({ planId: 'other', amount: 5n * XLM, inputValue: 8n * XLM, createdAt: 2 })
  const status = statusOf({ spendable: XLM, locked: 23n * XLM, plans: [other, one] })
  const model = privateBalance(status)
  assertAddsUp(status, model)
  assert.equal(part(model, 'sending'), 152n * (XLM / 10n))
  assert.equal(part(model, 'returning'), 78n * (XLM / 10n))
})

test('payouts owed and deposits add up with a payment in flight', () => {
  const queued = plan({
    planId: 'queued',
    kind: 'unshield',
    state: 'queued',
    payoutLeft: String(2n * XLM),
    mustRetry: false,
  })
  const stranded = plan({
    planId: 'stranded',
    kind: 'unshield',
    state: 'stranded',
    payoutLeft: String(3n * XLM),
    exitConfirmed: true,
    strandedExits: [4],
    mustRetry: false,
  })
  const screening = deposit({ id: 7 })
  const flagged = deposit({
    id: 8,
    amount: String(4n * XLM),
    flag: { reason: 6, kind: 'held_for_review' },
  })
  const status = statusOf({
    spendable: XLM,
    locked: 15n * XLM,
    pendingDeposits: 9n * XLM,
    awaitingPayout: 5n * XLM,
    plans: [plan({}), queued, stranded],
    deposits: [screening, flagged],
  })
  const model = privateBalance(status)
  assertAddsUp(status, model)
  assert.equal(part(model, 'screening'), 5n * XLM)
  assert.equal(part(model, 'held'), 7n * XLM)
})
