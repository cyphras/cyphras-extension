// What a stopped call says it cost is a running total over every stop of the same payment, an
// upper bound worded as such, about the right kind of call, and naming a restore only when one was
// signed; only a real budget stop reads as a fee to review; the offscreen document holds no port
// but the prover's; an offer ends only at its own account's word.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { generateMnemonic } from 'bip39'
import { stubChromeStorage } from './support/chrome.mjs'
import { resolveSources } from './support/sources.mjs'

resolveSources()
const { local, session } = stubChromeStorage()
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}

const { PrivateWallet } = await import('@cyphras/private')
const { Account, Keypair, Networks, Operation, SorobanDataBuilder, TransactionBuilder } =
  await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { BUDGET_STOP_MESSAGE, DEFAULT_FEE_BUDGET, budgetSigner } =
  await import('../src/background/shielded/fees.ts')
const { dropGrant, issueGrant, takeGrant } = await import('../src/background/shielded/approvals.ts')
const { errorView } = await import('../src/background/shielded/errors.ts')
const { shieldedStatus } = await import('../src/background/shielded/wallet.ts')
const { holdOf, needsRetry, planStatus } = await import('../src/app/src/lib/privateActivity.ts')
const { feeLead, refusalExpired } = await import('../src/app/src/lib/privateFees.ts')

const keypair = Keypair.random()
let sequence = 1

function envelope(resource, operation) {
  return new TransactionBuilder(new Account(keypair.publicKey(), String(sequence++)), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setSorobanData(new SorobanDataBuilder().setResourceFee(resource).build())
    .setTimeout(30)
    .build()
    .toXDR()
}

const restore = (resource) => envelope(resource, Operation.restoreFootprint({}))
const call = (resource) =>
  envelope(
    resource,
    Operation.invokeContractFunction({
      contract: 'CDE6MIQAS4P3YXAH6SFFYUP5XPPVPXXAVCTO5ATEUUTJW376KUTKQK7Z',
      function: 'transact',
      args: [],
    })
  )

const account = { publicKey: keypair.publicKey(), signTransaction: async (e) => e }

async function stopOf(signer, envelopes) {
  for (const e of envelopes.slice(0, -1)) await signer.signTransaction(e, Networks.TESTNET)
  try {
    await signer.signTransaction(envelopes.at(-1), Networks.TESTNET)
  } catch (err) {
    return err
  }
  throw new Error('the last envelope was signed')
}

test('two stops in a row on one payment add up, and name the restore that was signed', async () => {
  const first = await stopOf(budgetSigner(account, DEFAULT_FEE_BUDGET), [
    restore(5_999_900),
    call(4_999_900),
  ])
  const firstFee = errorView(first).fee
  assert.equal(firstFee.paid, '6000000')
  assert.equal(firstFee.restored, true)
  assert.equal(firstFee.attempted, false)
  // The approval of the first review carries what was signed for into the next call.
  const spent = { signed: 6_000_000n, restored: true, attempted: false }
  const second = await stopOf(budgetSigner(account, 5_600_000n, spent), [
    call(4_999_900),
    call(4_999_900),
  ])
  const secondFee = errorView(second).fee
  assert.equal(secondFee.paid, '11000000')
  assert.equal(secondFee.restored, true)
  assert.equal(secondFee.attempted, true)
})

test('a stop after call attempts alone names no restore', async () => {
  const stop = await stopOf(budgetSigner(account, DEFAULT_FEE_BUDGET), [
    call(5_999_900),
    call(4_999_900),
  ])
  const fee = errorView(stop).fee
  assert.equal(fee.restored, false)
  assert.equal(fee.attempted, true)
  const lead = feeLead(fee.reason, { signed: '0.6', restored: false, attempted: true }, 'unshield')
  assert.doesNotMatch(lead, /pool's data/)
  assert.match(lead, /An earlier attempt did not go through\./)
})

test('the cost so far is worded as an upper bound, about the kind of call it is', () => {
  const stop = { signed: '1.2', restored: false, attempted: false }
  const leads = {
    shield: /^This deposit has signed for up to 1\.2 XLM/,
    unshield: /^This payment has signed for up to 1\.2 XLM/,
    cancel: /^This action has signed for up to 1\.2 XLM/,
    refund: /^This action has signed for up to 1\.2 XLM/,
    claim: /^This action has signed for up to 1\.2 XLM/,
    restore: /^This pool restore has signed for up to 1\.2 XLM/,
  }
  for (const [subject, lead] of Object.entries(leads)) {
    const text = feeLead('network', stop, subject)
    assert.match(text, lead, subject)
    assert.doesNotMatch(text, /already paid/)
  }
})

const self = { kind: 'self', account: 'G' }
const viewPlan = (fields) => ({
  planId: 'p1',
  kind: 'unshield',
  state: 'prepared',
  needsUserDecision: false,
  mustRetry: true,
  route: self,
  relayerCode: null,
  lastError: 'signer_mismatch',
  exitConfirmed: null,
  ...fields,
})

test('a sent attempt then a budget stop holds the payment, and says the attempt did not go through', () => {
  const plan = viewPlan({ state: 'submitted' })
  assert.equal(holdOf(plan), 'fee_budget')
  assert.match(planStatus(plan, String).detail, /earlier attempt did not go through/)
})

test('only a budget stop reads as a fee to review, also after a worker restart', async () => {
  const mnemonic = generateMnemonic()
  const owner = Keypair.fromSecret((await deriveKeypairRaw(mnemonic, 0)).secret).publicKey()
  local.put('cyphras_accounts', {
    accounts: [{ index: 0, publicKey: owner, label: 'Account 1', walletId: 'primary' }],
    activeIndex: 0,
    activePublicKey: owner,
  })
  session.put('cyphras_session_pubkey', owner)
  session.put('cyphras_session_mnemonic', mnemonic)
  const sdkPlan = (planId, message) => ({
    planId,
    state: 'prepared',
    txHash: undefined,
    fee: 0n,
    kind: 'unshield',
    amount: 10n,
    to: owner,
    createdAt: 1,
    route: { kind: 'self', account: owner },
    exitId: undefined,
    payoutLeft: undefined,
    exitParts: [],
    exitConfirmed: undefined,
    operationId: undefined,
    relayerStatus: undefined,
    relayerCode: undefined,
    lastError: { code: 'signer_mismatch', message },
    mustRetry: true,
    needsUserDecision: false,
    retryOf: undefined,
    familyId: planId,
    inputValue: 20n,
    change: 10n,
    deadline: 100,
    deadlineBy: undefined,
  })
  PrivateWallet.prototype.plans = async () => [
    sdkPlan('budget', BUDGET_STOP_MESSAGE),
    sdkPlan('refused', 'refused to sign a transaction that is not a call of the vault'),
  ]
  PrivateWallet.prototype.balance = async () => ({
    spendable: 0n,
    pendingDeposits: 0n,
    locked: 40n,
    awaitingPayout: 0n,
    maybeSpent: 0n,
  })
  PrivateWallet.prototype.deposits = async () => []
  const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
  const { plans } = await shieldedStatus(testnet, owner, 'xlm')
  const budget = plans.find((p) => p.planId === 'budget')
  const refused = plans.find((p) => p.planId === 'refused')
  assert.equal(holdOf(budget), 'fee_budget')
  assert.equal(planStatus(budget, String).label, 'Needs your approval')
  assert.equal(refused.lastError, 'signer_refused')
  assert.equal(holdOf(refused), null)
  assert.equal(needsRetry(refused), false)
  assert.notEqual(planStatus(refused, String).label, 'Needs your approval')
})

test('an expired offer to pay a refused withdrawal names the button that offers it again', () => {
  assert.match(refusalExpired('network_fee_high'), /Use Pay the fee myself in Private activity/)
  assert.match(refusalExpired('restore_needed'), /Use Pay from my account in Private activity/)
})

test('an offer ends only at the word of the account it was made for', () => {
  const id = issueGrant({
    call: 'retry',
    target: 'p1',
    account: 'GOWNER',
    network: 'testnet',
    caps: undefined,
    budget: DEFAULT_FEE_BUDGET,
    warnings: [],
  })
  dropGrant(id, 'GOTHER')
  assert.equal(takeGrant(id, 'retry', 'p1', 'GOWNER', 'testnet').target, 'p1')
  const next = issueGrant({
    call: 'retry',
    target: 'p1',
    account: 'GOWNER',
    network: 'testnet',
    caps: undefined,
    budget: DEFAULT_FEE_BUDGET,
    warnings: [],
  })
  dropGrant(next, 'GOWNER')
  assert.throws(() => takeGrant(next, 'retry', 'p1', 'GOWNER', 'testnet'), {
    code: 'invalid_fee_approval',
  })
})

test('the offscreen document holds no port but the prover port', () => {
  const index = readFileSync(new URL('../src/background/index.ts', import.meta.url), 'utf8')
  const connect = index.indexOf('chrome.runtime.onConnect.addListener')
  const guard = index.indexOf('port.name !== PROVER_PORT', connect)
  assert.ok(guard > connect)
  const check = index.indexOf(
    "isOffscreenDocument(port.sender, chrome.runtime.getURL('offscreen.html'))",
    connect
  )
  assert.ok(check > guard)
  assert.ok(index.indexOf('port.disconnect()', check) > check)
  for (const handler of ['watchReviewPort(port)', "port.name === 'wallet-popup'"]) {
    assert.ok(index.indexOf(handler, connect) > check, handler)
  }
})
