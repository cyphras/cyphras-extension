// A payment held for the user (a fee to review, a relayer that did not send it) is offered its
// retry at once. Once a retry has taken it further, the held attempt is no longer the way on: a
// second retry of it from the account would prove the same notes again, pay another network fee
// and link the account, while the payment it continues may already be on its way.
import assert from 'node:assert/strict'
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
const { Keypair } = await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { shieldedStatus } = await import('../src/background/shielded/wallet.ts')
const { needsRetry, planStatus } = await import('../src/app/src/lib/privateActivity.ts')

const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
const mnemonic = generateMnemonic()
const account = Keypair.fromSecret((await deriveKeypairRaw(mnemonic, 0)).secret).publicKey()

local.put('cyphras_accounts', {
  accounts: [{ index: 0, publicKey: account, label: 'Account 1', walletId: 'primary' }],
  activeIndex: 0,
  activePublicKey: account,
})
session.put('cyphras_session_pubkey', account)
session.put('cyphras_session_mnemonic', mnemonic)

const relayer = { kind: 'relayer', url: 'https://relayer.example' }
const self = { kind: 'self', account }

// A plan as the SDK's plans() reports it.
function sdkPlan(fields) {
  return {
    planId: 'a',
    state: 'prepared',
    txHash: undefined,
    fee: 0n,
    kind: 'unshield',
    amount: 100_000_000n,
    to: account,
    createdAt: 1,
    route: relayer,
    exitId: undefined,
    payoutLeft: undefined,
    exitParts: [],
    exitConfirmed: undefined,
    operationId: undefined,
    relayerStatus: undefined,
    relayerCode: undefined,
    lastError: undefined,
    mustRetry: true,
    needsUserDecision: false,
    retryOf: undefined,
    familyId: 'a',
    inputValue: 150_000_000n,
    change: 50_000_000n,
    deadline: 100,
    deadlineBy: undefined,
    ...fields,
  }
}

let plans = []
PrivateWallet.prototype.plans = async () => plans
PrivateWallet.prototype.balance = async () => ({
  spendable: 0n,
  pendingDeposits: 0n,
  locked: 150_000_000n,
  awaitingPayout: 0n,
  maybeSpent: 0n,
})
PrivateWallet.prototype.deposits = async () => []

const unit = (u) => `${u}`

test('a held payment is offered its retry while it is the latest attempt', async () => {
  plans = [
    sdkPlan({
      relayerCode: 'network_fee_high',
      lastError: { code: 'service_rejected', message: 'm' },
    }),
  ]
  const status = await shieldedStatus(testnet, account, 'xlm')
  const held = status.plans.find((p) => p.planId === 'a')
  assert.equal(needsRetry(held), true)
  assert.equal(planStatus(held, unit).label, 'Not sent yet')
})

test('a held payment that a retry already took further offers no second retry', async () => {
  for (const [first, next] of [
    // The relayer refused it, and the account then submitted it itself.
    [
      sdkPlan({
        relayerCode: 'network_fee_high',
        lastError: { code: 'service_rejected', message: 'm' },
      }),
      sdkPlan({ planId: 'b', route: self, state: 'submitted', retryOf: 'a', createdAt: 2 }),
    ],
    // A fee review was declined, then approved on the retry.
    [
      sdkPlan({ route: self, lastError: { code: 'fee_above_cap', message: 'm' } }),
      sdkPlan({ planId: 'b', route: self, state: 'submitted', retryOf: 'a', createdAt: 2 }),
    ],
  ]) {
    plans = [first, next]
    const status = await shieldedStatus(testnet, account, 'xlm')
    const held = status.plans.find((p) => p.planId === 'a')
    assert.equal(needsRetry(held), false, `${planStatus(held, unit).label} offers a retry`)
  }
})
