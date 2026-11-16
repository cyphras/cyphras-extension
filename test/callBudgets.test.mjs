// Every call the account pays for itself is held to the most the user was shown, each call with its
// own budget, and an approved retry skips the SDK's review only for the saved payment itself, from
// the account, with no warning the sheet did not state.
import assert from 'node:assert/strict'
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

const { CyphrasError, PINNED_DEPLOYMENTS, PrivateWallet } = await import('@cyphras/private')
const { Account, Keypair, Networks, Operation, TransactionBuilder } =
  await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { SHIELDED_REVIEW_PORT } = await import('../src/constants/services.ts')
const { shieldedAccountAction, shieldedRestorePool, shieldedRetry, shieldedShield, shieldedSpend } =
  await import('../src/background/shielded/wallet.ts')
const { declineAllReviews, watchReviewPort } = await import('../src/background/shielded/reviews.ts')
const { DEFAULT_FEE_BUDGET } = await import('../src/background/shielded/fees.ts')

const XLM = 10_000_000n
const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
const deployment = PINNED_DEPLOYMENTS['testnet/xlm']
const mnemonic = generateMnemonic()
const account = Keypair.fromSecret((await deriveKeypairRaw(mnemonic, 0)).secret).publicKey()

local.put('cyphras_accounts', {
  accounts: [{ index: 0, publicKey: account, label: 'Account 1', walletId: 'primary' }],
  activeIndex: 0,
  activePublicKey: account,
})
session.put('cyphras_session_pubkey', account)
session.put('cyphras_session_mnemonic', mnemonic)

let sequence = 1
function vaultCall(fee) {
  return new TransactionBuilder(new Account(account, String(sequence++)), {
    fee: String(fee),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: deployment.vault,
        function: 'transact',
        args: [],
      })
    )
    .setTimeout(30)
    .build()
    .toXDR()
}

const sign = (signer, fee) => signer.signTransaction(vaultCall(fee), Networks.TESTNET)

function holderPort() {
  const holder = crypto.randomUUID()
  watchReviewPort({ name: SHIELDED_REVIEW_PORT + holder, onDisconnect: { addListener() {} } })
  return holder
}

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
PrivateWallet.prototype.deposits = async () => []

// The signer each SDK call was given, to be asked to sign afterwards.
const seen = {}
PrivateWallet.prototype.shield = async (request) => {
  seen.shield = request.signer
  return { depositId: 1, txHash: 'f'.repeat(64) }
}
PrivateWallet.prototype.cancelDeposit = async (id, signer) => {
  seen.cancel = signer
  return { txHash: 'f'.repeat(64) }
}
PrivateWallet.prototype.refundDeposit = async (id, signer) => {
  seen.refund = signer
  return { txHash: 'f'.repeat(64) }
}
PrivateWallet.prototype.claimExit = async (id, signer) => {
  seen.claim = signer
  return { txHash: 'f'.repeat(64) }
}
PrivateWallet.restoreVault = async (signer) => {
  seen.restore = signer
  return { txHash: undefined, restored: [] }
}
PrivateWallet.prototype.unshield = async (request) => {
  seen.unshield = request.selfRelay
  return { planId: 'new', state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
}

const FEE_BUDGET = { code: 'signer_mismatch', details: { feeBudget: true } }

test('each call the account pays is held to the most it was shown', async () => {
  const approved = 16_600_000n
  await shieldedShield(testnet, account, 'xlm', 10n * XLM, false, undefined, approved)
  await shieldedAccountAction(testnet, account, 'xlm', 'cancel', 1, undefined, approved)
  await shieldedAccountAction(testnet, account, 'xlm', 'refund', 1, undefined, approved)
  await shieldedAccountAction(testnet, account, 'xlm', 'claim', 1, undefined, approved)
  await shieldedRestorePool(testnet, account, 'xlm', undefined, approved)
  for (const name of ['shield', 'cancel', 'refund', 'claim', 'restore']) {
    await sign(seen[name], 15_000_000)
    await assert.rejects(sign(seen[name], 2_000_000), FEE_BUDGET, name)
  }
})

test('a first self-relayed unshield is held to the most the default caps allow', async () => {
  await shieldedSpend(testnet, account, 'xlm', holderPort(), {
    kind: 'unshield',
    to: account,
    amount: 10n * XLM,
    selfRelay: true,
  })
  await sign(seen.unshield, 6_000_000)
  await assert.rejects(sign(seen.unshield, 5_000_000), FEE_BUDGET)
})

test('calls never share a budget, one after another or together', async () => {
  const signers = []
  PrivateWallet.prototype.cancelDeposit = async (id, signer) => {
    signers.push(signer)
    return { txHash: 'f'.repeat(64) }
  }
  await Promise.all([
    shieldedAccountAction(testnet, account, 'xlm', 'cancel', 1, undefined),
    shieldedAccountAction(testnet, account, 'xlm', 'cancel', 2, undefined),
  ])
  await shieldedAccountAction(testnet, account, 'xlm', 'cancel', 3, undefined)
  assert.equal(signers.length, 3)
  for (const signer of signers) {
    await sign(signer, Number(DEFAULT_FEE_BUDGET) - 1_000_000)
    await assert.rejects(sign(signer, 2_000_000), FEE_BUDGET)
  }
})

// What the SDK asks the user before a self-relayed retry, as spend.js builds it.
function review(fields = {}) {
  return {
    kind: 'unshield',
    amount: 10n * XLM,
    fee: 0n,
    to: account,
    relayer: undefined,
    warnings: [{ code: 'self_relay_links_account', message: 'links' }],
    parts: 1,
    queued: false,
    ...fields,
  }
}

let asked
PrivateWallet.prototype.retry = async function (planId, request) {
  const confirmed = await request.confirm(asked)
  if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
  return { planId: `${planId}-next`, state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
}

test('an approved retry skips the review only when it is the saved payment, as stated', async () => {
  const stated = ['self_relay_links_account']
  const retry = async (shown = stated, selfRelay = true) => {
    const step = await shieldedRetry(
      testnet,
      account,
      'xlm',
      holderPort(),
      'held',
      selfRelay,
      undefined,
      shown
    )
    declineAllReviews()
    return step.kind
  }
  asked = review()
  assert.equal(await retry(), 'submitted')
  const goesToPopup = [
    [
      'a warning the sheet did not state',
      review({ warnings: [...review().warnings, { code: 'exit_will_queue', message: 'q' }] }),
    ],
    ['another destination', review({ to: Keypair.random().publicKey() })],
    ['another amount', review({ amount: 11n * XLM })],
    ['another kind', review({ kind: 'send' })],
    ['a relayer fee', review({ fee: 1n })],
    ['a relayer', review({ relayer: 'https://relayer.example' })],
  ]
  for (const [what, other] of goesToPopup) {
    asked = other
    assert.equal(await retry(), 'review', what)
  }
  asked = review()
  assert.equal(await retry(null), 'review', 'a retry the sheet never offered')
  assert.equal(await retry([]), 'review', 'a sheet that stated no warning')
  assert.equal(await retry(stated, false), 'review', 'a retry through a relayer')
})

test('a lock between the approval and the SDK review declines the retry', async () => {
  asked = review()
  let release
  let entered
  const inRetry = new Promise((resolve) => {
    entered = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  PrivateWallet.prototype.retry = async function (planId, request) {
    entered()
    await gate
    const confirmed = await request.confirm(asked)
    if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
    return { planId: 'next', state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
  }
  const run = shieldedRetry(testnet, account, 'xlm', holderPort(), 'held', true, undefined, [
    'self_relay_links_account',
  ])
  await inRetry
  declineAllReviews()
  release()
  await assert.rejects(run, { code: 'not_confirmed' })
})

test('a popup that is gone declines the retry before it is answered', async () => {
  asked = review()
  PrivateWallet.prototype.retry = async function (planId, request) {
    const confirmed = await request.confirm(asked)
    if (!confirmed) throw new CyphrasError('not_confirmed', 'the spend was not confirmed')
    return { planId: 'next', state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
  }
  await assert.rejects(
    shieldedRetry(testnet, account, 'xlm', 'no-such-holder', 'held', true, undefined, [
      'self_relay_links_account',
    ]),
    { code: 'not_confirmed' }
  )
})

test('a payment another attempt already continues is not retried a second time', async () => {
  plans = [saved, { ...saved, planId: 'next', state: 'submitted', retryOf: 'held' }]
  let retried = false
  PrivateWallet.prototype.retry = async () => {
    retried = true
    return { planId: 'again', state: 'submitted', txHash: 'f'.repeat(64), fee: 0n }
  }
  try {
    await assert.rejects(
      shieldedRetry(testnet, account, 'xlm', holderPort(), 'held', true, undefined, [
        'self_relay_links_account',
      ])
    )
    assert.equal(retried, false)
  } finally {
    plans = [saved]
  }
})
