// A call the fee budget stopped asks the user for the next step at once, and says the same on the
// result and in Private activity; the account's key is reachable only with a budget; offers are
// bound to their pool; the offscreen document never drives the wallet.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { CyphrasError } = await import('@cyphras/private')
const { Account, Keypair, Networks, Operation, SorobanDataBuilder, TransactionBuilder } =
  await import('@stellar/stellar-sdk')
const { DEFAULT_FEE_BUDGET, budgetSigner, feeCeiling } =
  await import('../src/background/shielded/fees.ts')
const { dropGrant, issueGrant, takeGrant } = await import('../src/background/shielded/approvals.ts')
const { MayStillLand, errorView } = await import('../src/background/shielded/errors.ts')
const { isOffscreenDocument } = await import('../src/background/shielded/senders.ts')
const { holdOf, needsRetry, planStatus, unfinishedSendTo } =
  await import('../src/app/src/lib/privateActivity.ts')
const { feeLead, feeTitle } = await import('../src/app/src/lib/privateFees.ts')

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

function envelope(keypair, fee, resource, sequence) {
  return new TransactionBuilder(new Account(keypair.publicKey(), sequence), {
    fee: String(fee),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(new SorobanDataBuilder().setResourceFee(resource).build())
    .setTimeout(30)
    .build()
    .toXDR()
}

async function stopAfterRestore() {
  const keypair = Keypair.random()
  const call = budgetSigner(
    { publicKey: keypair.publicKey(), signTransaction: async (e) => e },
    DEFAULT_FEE_BUDGET
  )
  await call.signTransaction(envelope(keypair, 100, 5_999_900, '1'), Networks.TESTNET)
  try {
    await call.signTransaction(envelope(keypair, 100, 4_999_900, '2'), Networks.TESTNET)
  } catch (err) {
    return err
  }
  throw new Error('the second envelope was signed')
}

test('a budget stop of a saved payment opens a review of the next step, naming what was paid', async () => {
  const stop = await stopAfterRestore()
  // As the SDK names the payment the refusal stopped, keeping its cause.
  const named = new CyphrasError(
    stop.code,
    stop.message,
    { ...stop.details, planId: 'p1' },
    { cause: stop.cause }
  )
  const view = errorView(new MayStillLand(named))
  assert.equal(view.mayLand, undefined)
  assert.equal(view.planId, 'p1')
  assert.equal(view.fee.reason, 'network')
  assert.equal(view.fee.total, '5000000')
  assert.equal(view.fee.paid, '6000000')
  assert.equal(feeTitle(view.fee.reason, view.fee.paid), 'Needs your approval')
  assert.match(feeLead(view.fee.reason, '0.6'), /already paid 0\.6 XLM in network fees/)
  assert.doesNotMatch(view.message, /[Tt]ry again/)
})

test('a shield that may still land after a budget stop is not told to try again', async () => {
  const view = errorView(new MayStillLand(await stopAfterRestore()))
  assert.equal(view.mayLand, true)
  assert.doesNotMatch(view.message, /[Tt]ry again/)
})

test('Private activity holds a payment the budget stopped, as the result does', () => {
  const plan = {
    planId: 'p1',
    kind: 'unshield',
    state: 'prepared',
    needsUserDecision: false,
    mustRetry: true,
    route: { kind: 'self', account: 'G' },
    relayerCode: null,
    lastError: 'signer_mismatch',
    exitConfirmed: null,
  }
  assert.equal(holdOf(plan), 'fee_budget')
  assert.equal(needsRetry(plan), true)
  assert.equal(planStatus(plan, String).label, 'Needs your approval')
  const restore = { ...plan, lastError: 'restore_failed' }
  assert.equal(needsRetry(restore), true)
  assert.equal(planStatus(restore, String).label, 'Not sent yet')
})

test('the budget is taken before the account signs, and given back when it does not', async () => {
  const keypair = Keypair.random()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let fail = false
  const call = budgetSigner(
    {
      publicKey: keypair.publicKey(),
      signTransaction: async (e) => {
        await gate
        if (fail) throw new Error('declined')
        return e
      },
    },
    DEFAULT_FEE_BUDGET
  )
  const first = call.signTransaction(envelope(keypair, 6_000_000, 0, '1'), Networks.TESTNET)
  await assert.rejects(
    call.signTransaction(envelope(keypair, 6_000_000, 0, '2'), Networks.TESTNET),
    { code: 'signer_mismatch' }
  )
  fail = true
  release()
  await assert.rejects(first, /declined/)
  fail = false
  await call.signTransaction(envelope(keypair, 10_000_000, 0, '3'), Networks.TESTNET)
})

test('no ceiling when the inclusion cap alone reaches the envelope limit', () => {
  assert.equal(feeCeiling('4000000000', '0'), null)
})

test('the account key is reachable only through a budget', () => {
  const wallet = source('../src/background/shielded/wallet.ts')
  assert.equal(wallet.match(/vaultSigner\(/g).length, 1)
  assert.match(wallet, /budgetSigner\(vaultSigner\(keypair, pool\.deployment\), budget\)/)
  assert.doesNotMatch(wallet, /readonly signer: TransactionSigner/)
  assert.doesNotMatch(wallet, /selfRelay: signer\b/)
})

test('an offer is bound to its pool and to the deposit mode of a shield', () => {
  const grant = (fields) =>
    issueGrant({
      call: 'shield',
      target: '100',
      account: 'G',
      network: 'testnet',
      pool: 'xlm',
      whileSubmitting: false,
      caps: undefined,
      budget: DEFAULT_FEE_BUDGET,
      warnings: [],
      ...fields,
    })
  const take = (id, pool, whileSubmitting) =>
    takeGrant(id, 'shield', '100', 'G', 'testnet', pool, whileSubmitting)
  assert.throws(() => take(grant(), 'usdc', false), { code: 'invalid_fee_approval' })
  assert.throws(() => take(grant(), 'xlm', true), { code: 'invalid_fee_approval' })
  assert.equal(take(grant(), 'xlm', false).pool, 'xlm')
  const declined = grant()
  dropGrant(declined)
  assert.throws(() => take(declined, 'xlm', false), { code: 'invalid_fee_approval' })
})

test('the router refuses every wallet request from the offscreen document', () => {
  const offscreen = 'chrome-extension://abc/offscreen.html'
  assert.equal(isOffscreenDocument({ url: offscreen }, offscreen), true)
  assert.equal(isOffscreenDocument({ url: `${offscreen}?x=1` }, offscreen), true)
  assert.equal(isOffscreenDocument({ url: 'chrome-extension://abc/wallet.html' }, offscreen), false)
  assert.equal(isOffscreenDocument({}, offscreen), false)
  const index = source('../src/background/index.ts')
  const guard = index.indexOf(
    "isOffscreenDocument(sender, chrome.runtime.getURL('offscreen.html'))"
  )
  assert.notEqual(guard, -1)
  assert.ok(guard < index.indexOf('case SERVICE_TYPES.'), 'the guard comes before every handler')
})

test('an unfinished send is found by its latest attempt, whatever the case of the address', () => {
  const plan = (fields) => ({
    planId: 'a',
    kind: 'send',
    to: 'cyt1qabc',
    state: 'prepared',
    retryOf: null,
    ...fields,
  })
  assert.equal(unfinishedSendTo([plan({})], ' CYT1QABC ').planId, 'a')
  assert.equal(
    unfinishedSendTo(
      [plan({}), plan({ planId: 'b', state: 'submitted', retryOf: 'a' })],
      'cyt1qabc'
    ).planId,
    'b'
  )
  assert.equal(unfinishedSendTo([plan({ state: 'confirmed' })], 'cyt1qabc'), undefined)
  assert.equal(unfinishedSendTo([plan({ kind: 'unshield' })], 'cyt1qabc'), undefined)
  assert.equal(unfinishedSendTo([plan({})], 'cyt1qother'), undefined)
})
