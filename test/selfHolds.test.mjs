// A self-submitted payment whose last attempt was sent and failed stays submitted; when the next
// attempt then stops on its fee or its restore, Private activity offers its retry at once, as for
// one never sent. Relayed payments wait as before. A newer attempt already on its way is not shown
// as a failure.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { holdOf, needsRetry, planStatus } = await import('../src/app/src/lib/privateActivity.ts')
const { blockedLook } = await import('../src/app/src/lib/privateFees.ts')

const plan = (fields) => ({
  planId: 'p1',
  kind: 'unshield',
  state: 'prepared',
  needsUserDecision: false,
  mustRetry: true,
  route: { kind: 'self', account: 'G' },
  relayerCode: null,
  lastError: null,
  exitConfirmed: null,
  ...fields,
})

test('a self-submitted payment stopped on its fee or restore holds, prepared or submitted', () => {
  const holds = {
    fee_above_cap: 'fee_above_cap',
    fee_above_limit: 'fee_above_limit',
    restore_failed: 'restore_failed',
    signer_mismatch: 'fee_budget',
  }
  for (const [lastError, hold] of Object.entries(holds)) {
    for (const state of ['prepared', 'submitted']) {
      const p = plan({ lastError, state })
      assert.equal(holdOf(p), hold, `${lastError} ${state}`)
      assert.equal(needsRetry(p), true, `${lastError} ${state}`)
      const detail = planStatus(p, String).detail
      if (state === 'submitted') {
        assert.match(detail, /earlier attempt did not go through/)
        assert.doesNotMatch(detail, /Nothing was sent/, lastError)
      }
    }
    for (const state of ['confirmed', 'dead', 'superseded']) {
      assert.equal(holdOf(plan({ lastError, state })), null, `${lastError} ${state}`)
    }
  }
  assert.equal(holdOf(plan({ lastError: 'signer_refused', state: 'submitted' })), null)
})

test('a relayed payment holds only while it was never sent', () => {
  const relayed = { kind: 'relayer', url: 'https://relayer.example' }
  for (const relayerCode of ['network_fee_high', 'restore_needed']) {
    assert.equal(holdOf(plan({ route: relayed, relayerCode })), relayerCode)
    assert.equal(holdOf(plan({ route: relayed, relayerCode, state: 'submitted' })), null)
  }
  assert.equal(holdOf(plan({ route: relayed, lastError: 'service_rejected' })), null)
})

test('a payment a newer attempt already continues reads as pending, not as failed', () => {
  assert.deepEqual(blockedLook('already_continued'), {
    title: 'Already continued',
    hero: 'pending',
  })
  assert.deepEqual(blockedLook('fee_above_limit'), { title: 'Fee too large', hero: 'failed' })
  assert.deepEqual(blockedLook('restore_failed'), {
    title: 'Restore did not go through',
    hero: 'failed',
  })
  assert.deepEqual(blockedLook('rpc_error'), { title: 'Not sent', hero: 'failed' })
})
