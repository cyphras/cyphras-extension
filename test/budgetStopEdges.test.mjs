// Edges of a call the fee budget stopped: every state its saved payment can be in offers the retry
// the result promised, a newer attempt that ended does not block the only legitimate retry, and the
// offscreen prover keeps working with the router closed to it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { generateMnemonic } from 'bip39'
import { stubChromeStorage } from './support/chrome.mjs'
import { resolveSources } from './support/sources.mjs'

// Review timers of minutes would keep the test process alive after every review it declines.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = realSetTimeout(fn, ms, ...args)
  if (typeof ms === 'number' && ms >= 60_000) timer.unref()
  return timer
}

resolveSources()
const { local, session } = stubChromeStorage()
globalThis.fetch = async () => {
  throw new Error('no network in this test')
}

const { PrivateWallet } = await import('@cyphras/private')
const { Keypair } = await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { SHIELDED_REVIEW_PORT } = await import('../src/constants/services.ts')
const { shieldedRetry } = await import('../src/background/shielded/wallet.ts')
const { declineAllReviews, watchReviewPort } = await import('../src/background/shielded/reviews.ts')
const { issueGrant, takeGrant } = await import('../src/background/shielded/approvals.ts')
const { needsRetry } = await import('../src/app/src/lib/privateActivity.ts')
const { FEE_REVIEW_TIMEOUT_MS } = await import('../src/app/src/lib/privateFees.ts')

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

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const stopped = (state) => ({
  planId: 'p1',
  kind: 'unshield',
  state,
  needsUserDecision: false,
  mustRetry: true,
  route: { kind: 'self', account },
  relayerCode: null,
  lastError: 'signer_mismatch',
})

test('a payment the budget stopped is offered its retry whether or not its first attempt was sent', () => {
  // A conflict on the first attempt leaves the plan submitted; the second attempt is the one stopped.
  for (const state of ['prepared', 'submitted']) {
    assert.equal(needsRetry(stopped(state)), true, state)
  }
})

const saved = {
  planId: 'held',
  kind: 'unshield',
  amount: 10n * XLM,
  to: account,
  route: { kind: 'self', account },
  exitParts: [],
}
let plans = [saved]
PrivateWallet.prototype.plans = async () => plans
let retried = 0
PrivateWallet.prototype.retry = async () => {
  retried++
  return { planId: 'again', state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
}

function holderPort() {
  const holder = crypto.randomUUID()
  watchReviewPort({ name: SHIELDED_REVIEW_PORT + holder, onDisconnect: { addListener() {} } })
  return holder
}

test('a newer attempt that ended does not block the retry of its payment', async () => {
  for (const state of ['dead', 'superseded', 'confirmed']) {
    plans = [saved, { ...saved, planId: 'newer', state, retryOf: 'held' }]
    retried = 0
    const step = await shieldedRetry(
      testnet,
      account,
      'xlm',
      holderPort(),
      'held',
      true,
      undefined,
      ['self_relay_links_account']
    )
    declineAllReviews()
    assert.ok(step.kind === 'submitted' || step.kind === 'review', state)
    assert.equal(retried, 1, state)
  }
})

test('a newer attempt that is still open blocks it, whether prepared or submitted', async () => {
  for (const state of ['prepared', 'submitted']) {
    plans = [saved, { ...saved, planId: 'newer', state, retryOf: 'held' }]
    retried = 0
    await assert.rejects(
      shieldedRetry(testnet, account, 'xlm', holderPort(), 'held', false, undefined),
      { code: 'already_continued' },
      state
    )
    assert.equal(retried, 0, state)
  }
})

test('an offer is still open when the popup review that shows it times out', () => {
  const now = Date.now
  try {
    const t0 = now()
    Date.now = () => t0
    const id = issueGrant({
      call: 'retry',
      target: 'p1',
      account: 'G',
      network: 'testnet',
      caps: undefined,
      budget: 1n,
      warnings: [],
    })
    Date.now = () => t0 + FEE_REVIEW_TIMEOUT_MS
    assert.equal(takeGrant(id, 'retry', 'p1', 'G', 'testnet').target, 'p1')
  } finally {
    Date.now = now
  }
})

test('the offscreen document asks the worker for nothing over runtime messages', () => {
  const offscreen = source('../src/app/src/offscreen-main.ts')
  assert.doesNotMatch(offscreen, /runtime\.sendMessage/)
  const index = source('../src/background/index.ts')
  const connect = index.indexOf('chrome.runtime.onConnect.addListener')
  assert.notEqual(connect, -1)
  assert.ok(index.indexOf('acceptProverPort(', connect) > connect)
})
