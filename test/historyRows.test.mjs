// History shows what reached the chain, one row per payment: a deposit voided before it left the
// device is not listed, and the attempts of one payment, which spend the same notes, are one row,
// the attempt that landed or else the newest. The review of a high network fee names 1.01 XLM only
// when the fee is above it.
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
const { paymentRows, reachedChain } = await import('../src/background/shielded/history.ts')
const { shieldedHistory } = await import('../src/background/shielded/wallet.ts')
const { feeLead } = await import('../src/app/src/lib/privateFees.ts')

const attempt = (planId, fields) => ({
  planId,
  familyId: 'a',
  state: 'prepared',
  createdAt: 1,
  ...fields,
})

test('the attempts of one payment are one row: the newest, or the one that landed', () => {
  const rows = (plans) => paymentRows(plans).map((p) => p.planId)
  assert.deepEqual(
    rows([
      attempt('a', { state: 'dead', createdAt: 1 }),
      attempt('b', { createdAt: 2 }),
      attempt('c', { state: 'submitted', createdAt: 3 }),
    ]),
    ['c']
  )
  assert.deepEqual(
    rows([attempt('a', { state: 'confirmed', createdAt: 1 }), attempt('b', { createdAt: 2 })]),
    ['a']
  )
  assert.deepEqual(rows([attempt('a', { state: 'superseded' }), attempt('b', { createdAt: 2 })]), [
    'b',
  ])
  assert.deepEqual(rows([attempt('a', {}), attempt('x', { familyId: 'x' })]).sort(), ['a', 'x'])
})

test('a deposit voided before it left the device is not history', () => {
  assert.equal(reachedChain({ state: 'failed', txHash: undefined }), false)
  assert.equal(reachedChain({ state: 'failed', txHash: 'f'.repeat(64) }), true)
  assert.equal(reachedChain({ state: 'submitting', txHash: undefined }), true)
})

test('history lists no voided deposit and one row per payment', async () => {
  const mnemonic = generateMnemonic()
  const owner = Keypair.fromSecret((await deriveKeypairRaw(mnemonic, 0)).secret).publicKey()
  local.put('cyphras_accounts', {
    accounts: [{ index: 0, publicKey: owner, label: 'Account 1', walletId: 'primary' }],
    activeIndex: 0,
    activePublicKey: owner,
  })
  session.put('cyphras_session_pubkey', owner)
  session.put('cyphras_session_mnemonic', mnemonic)
  const deposit = (fields) => ({
    id: undefined,
    amount: 10_000_000n,
    state: 'failed',
    txHash: undefined,
    depositor: owner,
    ...fields,
  })
  const plan = (planId, fields) => ({
    planId,
    kind: 'unshield',
    amount: 10_000_000n,
    fee: 0n,
    to: owner,
    route: { kind: 'self', account: owner },
    state: 'prepared',
    txHash: undefined,
    createdAt: 1,
    familyId: 'a',
    ...fields,
  })
  PrivateWallet.prototype.history = async () => []
  PrivateWallet.prototype.deposits = async () => [
    deposit({}),
    deposit({ id: 3, state: 'pending', txHash: 'a'.repeat(64) }),
  ]
  PrivateWallet.prototype.plans = async () => [
    plan('a', { state: 'dead', createdAt: 1 }),
    plan('b', { createdAt: 2, retryOf: 'a' }),
    plan('c', { createdAt: 3, retryOf: 'b' }),
  ]
  const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
  const items = await shieldedHistory(testnet, owner, 'xlm')
  assert.deepEqual(
    items.filter((i) => i.kind === 'shield').map((i) => i.depositId),
    [3]
  )
  assert.deepEqual(
    items.filter((i) => i.kind === 'unshield').map((i) => i.planId),
    ['c']
  )
})

test('a high network fee names 1.01 XLM only when the fee is above it', () => {
  const within = feeLead('network', undefined, 'shield', 3_603_369n)
  assert.doesNotMatch(within, /1\.01/)
  assert.match(within, /more than usual to include transactions/)
  assert.match(feeLead('network', undefined, 'unshield', 20_473_382n), /more than the 1\.01 XLM/)
})
