// After "Pay up to" the approved payment goes without a second confirm when the SDK's review warns
// of nothing the user did not already confirm in that flow: a fresh self-relayed unshield, and the
// retry of a payment held for its fee. A review with a new warning still goes to the popup, and the
// approval's budget stays with that call.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateMnemonic } from 'bip39'
import { stubChromeStorage } from './support/chrome.mjs'
import { resolveSources } from './support/sources.mjs'

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

const { CyphrasError, PrivateWallet } = await import('@cyphras/private')
const { Keypair } = await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { SHIELDED_REVIEW_PORT } = await import('../src/constants/services.ts')
const { shieldedDecide, shieldedRetry, shieldedSpend } =
  await import('../src/background/shielded/wallet.ts')
const { confirmedWarnings, declineAllReviews, holderOfReview, watchReviewPort } =
  await import('../src/background/shielded/reviews.ts')
const { shieldedOffer } = await import('../src/background/shielded/offers.ts')
const { takeGrant } = await import('../src/background/shielded/approvals.ts')

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

function holderPort() {
  const holder = crypto.randomUUID()
  watchReviewPort({ name: SHIELDED_REVIEW_PORT + holder, onDisconnect: { addListener() {} } })
  return holder
}

// The warnings the SDK gives a self-relayed unshield to an account that deposited recently.
const WARNINGS = [
  { code: 'self_relay_links_account', message: 'links' },
  { code: 'recent_deposit', message: 'recent' },
  { code: 'destination_new', message: 'new' },
]

function review(fields = {}) {
  return {
    kind: 'unshield',
    amount: XLM,
    fee: 0n,
    to: account,
    relayer: undefined,
    warnings: WARNINGS,
    parts: 1,
    queued: false,
    ...fields,
  }
}

const highFee = (planId) =>
  new CyphrasError('fee_above_cap', 'the network fee is above the cap', {
    inclusion: '150',
    resource: '20000000',
    reason: 'network',
    planId,
  })

const saved = (planId, retryOf) => ({
  planId,
  kind: 'unshield',
  amount: XLM,
  to: account,
  state: 'prepared',
  retryOf,
  route: { kind: 'self', account },
  exitParts: [],
})

const scope = { publicKey: account, networkId: 'testnet' }

// The popup confirms the review its request returned, the payment stops on its fee, and the
// background makes the offer the fee review shows; the popup then approves it.
async function confirmThenApprove(first, holder) {
  assert.equal(first.kind, 'review')
  const { reviewId } = first.review
  let stopped
  try {
    await shieldedDecide(account, reviewId, true)
  } catch (err) {
    stopped = err
  }
  const offer = shieldedOffer(stopped, 'retry', undefined, scope, {
    pool: 'xlm',
    kind: 'unshield',
    confirmed: confirmedWarnings(holderOfReview(reviewId)),
  })
  const { planId, fee } = offer.shieldedError
  assert.ok(fee.approval, 'the fee review has an offer')
  const grant = takeGrant(fee.approval, 'retry', planId, account, 'testnet', 'xlm')
  return { planId, grant, holder }
}

let retryReview
let budgetSigner
PrivateWallet.prototype.retry = async function (planId, request) {
  budgetSigner = request.selfRelay
  const confirmed = await request.confirm(retryReview)
  if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
  return { planId: `${planId}-sent`, state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
}

async function approvedRetry({ planId, grant }) {
  const step = await shieldedRetry(
    testnet,
    account,
    'xlm',
    holderPort(),
    planId,
    true,
    grant.caps,
    grant.warnings,
    grant.budget,
    grant.spent
  )
  declineAllReviews()
  return step
}

test('a fresh self-relayed unshield is sent once its fee is approved', async () => {
  PrivateWallet.prototype.plans = async () => [saved('p1')]
  PrivateWallet.prototype.unshield = async (request) => {
    if (!(await request.confirm(review()))) throw new CyphrasError('not_confirmed', 'no')
    throw highFee('p1')
  }
  const holder = holderPort()
  const first = await shieldedSpend(testnet, account, 'xlm', holder, {
    kind: 'unshield',
    to: account,
    amount: XLM,
    selfRelay: true,
  })
  const approved = await confirmThenApprove(first, holder)
  retryReview = review()
  assert.equal((await approvedRetry(approved)).kind, 'submitted')
})

test('the retry of a payment held for its fee is sent once its fee is approved', async () => {
  // The held payment p1 is retried from Private activity: its review is confirmed, the new attempt
  // p2 stops on its fee, and the review of p2's fee is approved.
  PrivateWallet.prototype.plans = async () => [saved('p1'), saved('p2', 'p1')]
  let calls = 0
  PrivateWallet.prototype.retry = async function (planId, request) {
    calls++
    budgetSigner = request.selfRelay
    const confirmed = await request.confirm(review())
    if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
    if (calls === 1) throw highFee('p2')
    return { planId: `${planId}-sent`, state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
  }
  PrivateWallet.prototype.plans = async () =>
    calls === 0 ? [saved('p1')] : [saved('p1'), saved('p2', 'p1')]
  const holder = holderPort()
  const first = await shieldedRetry(testnet, account, 'xlm', holder, 'p1', true, undefined)
  const approved = await confirmThenApprove(first, holder)
  assert.equal(approved.planId, 'p2')
  assert.equal((await approvedRetry(approved)).kind, 'submitted')
})

test('a review with a new warning goes to the popup, and the call keeps the approved budget', async () => {
  PrivateWallet.prototype.plans = async () => [saved('p1')]
  PrivateWallet.prototype.unshield = async (request) => {
    if (!(await request.confirm(review()))) throw new CyphrasError('not_confirmed', 'no')
    throw highFee('p1')
  }
  PrivateWallet.prototype.retry = async function (planId, request) {
    budgetSigner = request.selfRelay
    const confirmed = await request.confirm(retryReview)
    if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
    return { planId: `${planId}-sent`, state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
  }
  const holder = holderPort()
  const first = await shieldedSpend(testnet, account, 'xlm', holder, {
    kind: 'unshield',
    to: account,
    amount: XLM,
    selfRelay: true,
  })
  const approved = await confirmThenApprove(first, holder)
  retryReview = review({
    warnings: [...WARNINGS, { code: 'exit_will_queue', message: 'queue' }],
  })
  assert.equal((await approvedRetry(approved)).kind, 'review')
  assert.ok(approved.grant.budget > 10_100_000n)
  assert.ok(budgetSigner, 'the retry was given the budgeted signer of its approval')
})
