// The sheets that follow a refused or stopped retry say what the payment's row says: while an
// older attempt of it may still land, they say so first and never that nothing has left the
// balance; the warning not to pay it again stays.
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
const { shieldedEarlierMayLand } = await import('../src/background/shielded/wallet.ts')
const { EARLIER_MAY_LAND, NOT_AGAIN, refusalCopy, waitingNote } =
  await import('../src/app/src/lib/privateFees.ts')

test('a refusal after a retry names the earlier attempt, for both codes and kinds', () => {
  for (const refusal of ['network_fee_high', 'restore_needed']) {
    for (const kind of ['send', 'unshield']) {
      const after = refusalCopy(refusal, kind, '0.11', 'G', true).note
      assert.ok(after.startsWith(EARLIER_MAY_LAND), `${refusal} ${kind}`)
      assert.doesNotMatch(after, /Nothing has left/, `${refusal} ${kind}`)
      assert.ok(after.includes(NOT_AGAIN), `${refusal} ${kind}`)
      const first = refusalCopy(refusal, kind, '0.11', 'G').note
      assert.doesNotMatch(first, /earlier attempt/, `${refusal} ${kind}`)
      assert.ok(first.includes(NOT_AGAIN), `${refusal} ${kind}`)
      if (refusal === 'network_fee_high') assert.match(first, /^Nothing has left/)
    }
  }
})

test('the result of a declined fee review names the earlier attempt only when it may land', () => {
  assert.ok(waitingNote(true).startsWith(EARLIER_MAY_LAND))
  assert.doesNotMatch(waitingNote(true), /Nothing was sent/)
  assert.match(waitingNote(false), /^Nothing was sent/)
})

test('the background decides it from the payment attempts, as the status does', async () => {
  const mnemonic = generateMnemonic()
  const owner = Keypair.fromSecret((await deriveKeypairRaw(mnemonic, 0)).secret).publicKey()
  local.put('cyphras_accounts', {
    accounts: [{ index: 0, publicKey: owner, label: 'Account 1', walletId: 'primary' }],
    activeIndex: 0,
    activePublicKey: owner,
  })
  session.put('cyphras_session_pubkey', owner)
  session.put('cyphras_session_mnemonic', mnemonic)
  const plan = (planId, state, createdAt) => ({ planId, familyId: 'a', state, createdAt })
  const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
  const ask = (plans, planId) => {
    PrivateWallet.prototype.plans = async () => plans
    return shieldedEarlierMayLand(testnet, owner, 'xlm', planId)
  }
  assert.equal(await ask([plan('a', 'submitted', 1), plan('b', 'prepared', 2)], 'b'), true)
  assert.equal(await ask([plan('a', 'dead', 1), plan('b', 'prepared', 2)], 'b'), false)
  assert.equal(await ask([plan('a', 'prepared', 1)], 'a'), false)
  assert.equal(await ask([], 'missing'), false)
})
