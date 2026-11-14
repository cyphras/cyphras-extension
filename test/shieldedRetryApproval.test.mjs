// A self-relayed retry the popup already put in front of the user, after a fee review or a relayer
// refusal, must reach the network: the SDK goes without a confirm only when its review has no
// warnings, and a self-relayed unshield always warns that it links the account.
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

const { CyphrasError, PrivateWallet } = await import('@cyphras/private')
const { unshieldWarnings } = await import(
  new URL('../node_modules/@cyphras/private/dist/wallet/nudges.js', import.meta.url).href
)
const { Keypair } = await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { SHIELDED_REVIEW_PORT } = await import('../src/constants/services.ts')
const { shieldedRetry } = await import('../src/background/shielded/wallet.ts')
const { watchReviewPort } = await import('../src/background/shielded/reviews.ts')

const XLM = 10_000_000n
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

// The review gate of the SDK's spend, with the warnings the SDK itself gives a self-relayed
// unshield to an old account in a large pool: a request without a confirm goes only when there
// are none.
const requests = []
PrivateWallet.prototype.retry = async function (planId, request) {
  requests.push(request)
  const warnings = unshieldWarnings({
    to: account,
    amount: 10n * XLM,
    fee: 0n,
    spendable: 100n * XLM,
    deposits: [],
    notes: [],
    now: Date.now(),
    destinationCreatedLedger: 1,
    createsAccount: false,
    latestLedger: 10_000_000,
    admittedDeposits: 1_000,
    selfRelay: request.selfRelay !== undefined,
    willQueue: false,
  })
  const review = {
    kind: 'unshield',
    amount: 10n * XLM,
    fee: 0n,
    to: account,
    relayer: undefined,
    warnings,
    parts: 1,
    queued: false,
  }
  const confirmed =
    request.confirm === undefined ? warnings.length === 0 : await request.confirm(review)
  if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
  return { planId: `${planId}-next`, state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
}

function holderPort() {
  const holder = crypto.randomUUID()
  watchReviewPort({ name: SHIELDED_REVIEW_PORT + holder, onDisconnect: { addListener() {} } })
  return holder
}

test('a self-relayed unshield always carries a warning the user must confirm', () => {
  const codes = (selfRelay) =>
    unshieldWarnings({
      to: account,
      amount: 10n * XLM,
      fee: 0n,
      spendable: 100n * XLM,
      deposits: [],
      notes: [],
      now: Date.now(),
      destinationCreatedLedger: 1,
      createsAccount: false,
      latestLedger: 10_000_000,
      admittedDeposits: 1_000,
      selfRelay,
      willQueue: false,
    }).map((w) => w.code)
  assert.deepEqual(codes(false), [])
  assert.deepEqual(codes(true), ['self_relay_links_account'])
})

test('paying the fee from the account after a review or a refusal is not dropped unconfirmed', async () => {
  const approved = { inclusion: 100_000n, resource: 16_500_000n, restore: 0n }
  for (const caps of [undefined, approved]) {
    requests.length = 0
    const step = await shieldedRetry(
      testnet,
      account,
      'xlm',
      holderPort(),
      'held',
      true,
      caps,
      true
    )
    assert.equal(requests.length, 1)
    assert.ok(step.kind === 'submitted' || step.kind === 'review', JSON.stringify(step))
  }
})
