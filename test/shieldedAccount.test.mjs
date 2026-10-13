// A private request runs only for the account its page showed: another surface can switch accounts
// while the popup, which learns of it by polling, still shows the old one. The account is checked
// where the wallet reads it, before any wallet opens.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateMnemonic } from 'bip39'
import { stubChromeStorage } from './support/chrome.mjs'
import { resolveSources } from './support/sources.mjs'

resolveSources()
const { local, session } = stubChromeStorage()
// A refused request must not get as far as a service.
globalThis.fetch = async () => {
  throw new Error('a refused request reached the network')
}

const { Keypair } = await import('@stellar/stellar-sdk')
const { deriveKeypairRaw } = await import('../src/background/keyManager.ts')
const { DEFAULT_NETWORKS } = await import('../src/constants/networks.ts')
const { shieldedDecide, shieldedReceiveAddress, shieldedStatus } =
  await import('../src/background/shielded/wallet.ts')

const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
const mnemonic = generateMnemonic()
const accountAt = async (index) =>
  Keypair.fromSecret((await deriveKeypairRaw(mnemonic, index)).secret).publicKey()
const first = await accountAt(0)
const second = await accountAt(1)

// An unlocked wallet with two accounts of one recovery phrase, one of them active.
function unlockedAs(active) {
  local.clear()
  session.clear()
  local.put('cyphras_accounts', {
    accounts: [
      { index: 0, publicKey: first, label: 'Account 1', walletId: 'primary' },
      { index: 1, publicKey: second, label: 'Account 2', walletId: 'primary' },
    ],
    activeIndex: active === first ? 0 : 1,
    activePublicKey: active,
  })
  session.put('cyphras_session_pubkey', active)
  session.put('cyphras_session_mnemonic', mnemonic)
}

test('a request named for another account than the active one is refused', async () => {
  unlockedAs(second)
  await assert.rejects(shieldedStatus(testnet, first, 'xlm'), { code: 'account_changed' })
  await assert.rejects(shieldedReceiveAddress(testnet, first, 'xlm'), { code: 'account_changed' })
  await assert.rejects(shieldedDecide(first, 'review', true), { code: 'account_changed' })
  await assert.rejects(shieldedStatus(testnet, undefined, 'xlm'), { code: 'account_changed' })
})

test('a request runs for the account that is active when it arrives', async () => {
  unlockedAs(second)
  assert.match(await shieldedReceiveAddress(testnet, second, 'xlm'), /^cyt1/)
  // Another surface switches to the first account.
  unlockedAs(first)
  await assert.rejects(shieldedReceiveAddress(testnet, second, 'xlm'), { code: 'account_changed' })
  assert.match(await shieldedReceiveAddress(testnet, first, 'xlm'), /^cyt1/)
})
