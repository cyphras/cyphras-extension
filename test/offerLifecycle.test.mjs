// An offer to pay a fee lives three minutes in the background's memory: it is refused after that,
// after a worker restart, and when a request names anything but the call it was made for. A payment
// stopped by the fee budget has a retry offered at once, as every other stop that waits on the user.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { DEFAULT_FEE_BUDGET } = await import('../src/background/shielded/fees.ts')
const { issueGrant, takeGrant } = await import('../src/background/shielded/approvals.ts')
const { ShieldedRefusal, errorView } = await import('../src/background/shielded/errors.ts')
const { needsRetry } = await import('../src/app/src/lib/privateActivity.ts')

const scope = { account: 'GACCOUNT', network: 'testnet' }
const offer = () =>
  issueGrant({
    call: 'retry',
    target: 'p1',
    ...scope,
    caps: undefined,
    budget: DEFAULT_FEE_BUDGET,
    warnings: [],
  })
const take = (id) => takeGrant(id, 'retry', 'p1', 'GACCOUNT', 'testnet')

test('an offer is open for three minutes and refused after them', () => {
  const now = Date.now
  try {
    const t0 = now()
    Date.now = () => t0
    const early = offer()
    const late = offer()
    Date.now = () => t0 + 3 * 60_000 - 1
    assert.equal(take(early).target, 'p1')
    Date.now = () => t0 + 3 * 60_000 + 1
    assert.throws(() => take(late), { code: 'invalid_fee_approval' })
  } finally {
    Date.now = now
  }
})

test('a worker restart ends every offer, and the refusal carries nothing to approve', async () => {
  const id = offer()
  const restarted = await import('../src/background/shielded/approvals.ts?restarted')
  assert.throws(() => restarted.takeGrant(id, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
    code: 'invalid_fee_approval',
  })
  const view = errorView(
    new ShieldedRefusal('invalid_fee_approval', 'That approval is no longer open.')
  )
  assert.equal(view.code, 'invalid_fee_approval')
  assert.equal(view.fee, undefined)
  assert.equal(view.planId, undefined)
})

test('two offers for one payment are separate, and using one leaves the other', () => {
  const first = offer()
  const second = offer()
  assert.notEqual(first, second)
  take(first)
  assert.equal(take(second).target, 'p1')
})

test('a saved payment the fee budget stopped is offered its retry at once', () => {
  const plan = {
    state: 'prepared',
    needsUserDecision: false,
    mustRetry: true,
    route: { kind: 'self', account: 'GACCOUNT' },
    relayerCode: null,
    lastError: 'signer_mismatch',
  }
  assert.equal(needsRetry(plan), true)
})
