// What the popup says and offers about a payment that waits on the user, and about a fee to
// review: a payment never sent is offered its retry at once and never told it may still land, the
// sheets say what the account pays and discloses, and notes that may be spent elsewhere stay part
// of Available.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { holdOf, needsRetry, planStatus } = await import('../src/app/src/lib/privateActivity.ts')
const { entryLines, feeNotes, refusalCopy, shortfall, queuedNote } =
  await import('../src/app/src/lib/privateFees.ts')
const { privateBalance } = await import('../src/app/src/lib/privateBalance.ts')

const unit = (u) => `${u} stroops`

function plan(fields) {
  return {
    planId: 'p',
    kind: 'unshield',
    amount: '100000000',
    fee: '1000000',
    to: 'G',
    route: { kind: 'relayer', url: 'https://relayer.example' },
    state: 'prepared',
    txHash: null,
    createdAt: 1,
    payoutLeft: null,
    exitConfirmed: null,
    strandedExits: [],
    relayerStatus: null,
    relayerCode: null,
    lastError: null,
    mustRetry: true,
    needsUserDecision: false,
    retryOf: null,
    familyId: 'p',
    inputValue: '150000000',
    change: '49000000',
    deadline: 10,
    deadlineBy: null,
    ...fields,
  }
}

const self = { kind: 'self', account: 'GACCOUNT' }

test('a payment stopped for a fee or refused by the relayer waits on the user, with a retry now', () => {
  const cases = [
    [plan({ route: self, lastError: 'fee_above_cap' }), 'fee_above_cap', 'Needs your approval'],
    [plan({ route: self, lastError: 'fee_above_limit' }), 'fee_above_limit', 'Not sent yet'],
    [plan({ relayerCode: 'network_fee_high' }), 'network_fee_high', 'Not sent yet'],
    [plan({ relayerCode: 'restore_needed' }), 'restore_needed', 'Not sent yet'],
  ]
  for (const [p, hold, label] of cases) {
    assert.equal(holdOf(p), hold)
    assert.equal(needsRetry(p), true, hold)
    const status = planStatus(p, unit)
    assert.equal(status.label, label)
    assert.doesNotMatch(status.detail, /may still land/i)
  }
})

test('a payment that may still land keeps its text and waits for its deadline', () => {
  for (const p of [
    plan({}),
    plan({ relayerCode: 'rejected' }),
    plan({ route: self, lastError: 'transaction_failed' }),
    // The relayer's code stays on a plan it later took; only one never sent waits on the user.
    plan({ relayerCode: 'network_fee_high', state: 'submitted' }),
    plan({ relayerCode: 'network_fee_high', needsUserDecision: true }),
  ]) {
    assert.equal(holdOf(p), null)
  }
  assert.equal(needsRetry(plan({ relayerCode: 'rejected' })), false)
  assert.equal(planStatus(plan({}), unit).label, 'May still land')
})

test('a dead withdrawal the relayer refused suggests submitting it from the account', () => {
  assert.match(
    planStatus(plan({ state: 'dead', relayerCode: 'rejected' }), unit).detail,
    /without a relayer/
  )
  assert.doesNotMatch(planStatus(plan({ state: 'dead' }), unit).detail, /without a relayer/)
  assert.doesNotMatch(
    planStatus(plan({ state: 'dead', kind: 'send', relayerCode: 'rejected' }), unit).detail,
    /without a relayer/
  )
})

test('entries read in words, each once, anything unnamed last', () => {
  assert.deepEqual(entryLines(['other', 'tree', 'code', 'tree', 'record']), [
    "The pool's payment records",
    "The pool's program",
    'Records of past or waiting payments',
    'Other pool data',
  ])
})

test('the notes of a fee review say what it does, what it links and how far it goes', () => {
  const restore = feeNotes('restore', 'unshield', 'GABC...WXYZ', true)
  assert.equal(restore.warning, 'This fee is as large as your payment, or larger.')
  assert.match(restore.notes[0], /restores the pool for everyone/)
  assert.match(restore.notes[1], /GABC\.\.\.WXYZ pays this fee and becomes publicly linked/)
  assert.match(restore.notes.at(-2), /plus 10%/)
  assert.match(restore.notes.at(-1), /this one transaction only/)
  const rent = feeNotes('rent', 'cancel', 'G', true)
  assert.equal(rent.warning, null)
  assert.equal(
    rent.notes[0],
    "The pool's data needs renewing. This keeps it on the network for everyone."
  )
  assert.doesNotMatch(rent.notes.join(' '), /keeper|publicly linked/)
})

test('an account short of the most it may pay lacks the difference, rounded up to 0.01 XLM', () => {
  assert.equal(shortfall(16_600_000n, 10_000_001n), 6_600_000n)
  assert.equal(shortfall(16_600_000n, 16_600_000n), null)
  assert.equal(shortfall(16_600_000n, null), null)
})

test('a refusal offers the account only for a withdrawal, with what it pays and links', () => {
  const high = refusalCopy('network_fee_high', 'unshield', '0.1', 'GABC...WXYZ')
  assert.equal(high.payLabel, 'Pay the fee myself')
  assert.match(high.lead, /relayer's fee of 0\.1 XLM/)
  assert.match(high.payNote, /at most 1\.01 XLM, and becomes publicly linked/)
  assert.equal(refusalCopy('network_fee_high', 'send', null, 'G').payLabel, null)
  assert.equal(refusalCopy('restore_needed', 'unshield', null, 'G').payLabel, 'Pay from my account')
  assert.equal(refusalCopy('restore_needed', 'send', null, 'G').payLabel, null)
  assert.match(queuedNote('unshield', '0.3', '0.2'), /0\.3 XLM instead of the usual 0\.2 XLM/)
})

test('notes that may already be spent elsewhere stay part of Available and are never added', () => {
  const status = {
    address: 'cyt1q',
    balance: {
      spendable: '50000000',
      locked: '0',
      pendingDeposits: '0',
      awaitingPayout: '0',
      maybeSpent: '20000000',
    },
    plans: [],
    deposits: [],
  }
  const model = privateBalance(status)
  assert.equal(model.total, 50_000_000n)
  assert.equal(model.maybeSpent, 20_000_000n)
  assert.equal(model.parts.find((p) => p.key === 'available').amount, 50_000_000n)
})
