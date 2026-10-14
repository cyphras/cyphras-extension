// The networks the background serves, from a fresh install or from what an earlier release stored,
// and the network a private request may run on.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { stubChromeStorage } from './support/chrome.mjs'
import { resolveSources } from './support/sources.mjs'

resolveSources()
const { local } = stubChromeStorage()

const { addNetwork, getNetworks, getShieldedNetwork, setActiveNetwork } =
  await import('../src/background/networkManager.ts')

const NETWORKS = 'cyphras_networks'
const PUBLIC = 'Public Global Stellar Network ; September 2015'
const TESTNET = 'Test SDF Network ; September 2015'

const pool = (deployment) => ({
  poolId: 'xlm',
  deployment,
  label: 'XLM',
  native: true,
  decimals: 7,
})

// The shipped networks as 0.4.0 stored them: mainnet without pools, testnet with its own.
const mainnet040 = {
  id: 'mainnet',
  name: 'Mainnet',
  horizonUrl: 'https://horizon.stellar.org',
  sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
  passphrase: PUBLIC,
  friendbotUrl: '',
  explorerUrl: 'https://stellar.expert/explorer/public',
  txTimeout: 90,
  isDefault: true,
}
const testnet040 = {
  id: 'testnet',
  name: 'Testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  passphrase: TESTNET,
  friendbotUrl: 'https://friendbot.stellar.org',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  txTimeout: 90,
  isDefault: true,
  shielded: [pool('testnet/xlm')],
}
const custom = {
  id: 'c0ffee',
  name: 'My node',
  horizonUrl: 'https://horizon.example.org',
  sorobanRpcUrl: 'https://rpc.example.org',
  passphrase: PUBLIC,
  friendbotUrl: '',
  txTimeout: 90,
  isDefault: false,
}

const poolsOf = (networks) =>
  Object.fromEntries(networks.map((n) => [n.id, (n.shielded ?? []).map((p) => p.deployment)]))

beforeEach(() => local.clear())

test('a fresh install serves the shipped networks with the pools the SDK release pins', async () => {
  assert.deepEqual(poolsOf(await getNetworks()), {
    mainnet: ['mainnet/xlm'],
    testnet: ['testnet/xlm'],
  })
  // Read back from what the first read stored.
  assert.deepEqual(poolsOf(await getNetworks()), {
    mainnet: ['mainnet/xlm'],
    testnet: ['testnet/xlm'],
  })
})

test('a 0.4.0 store gets the mainnet pool without being rewritten', async () => {
  local.put(NETWORKS, [mainnet040, testnet040])
  assert.deepEqual(poolsOf(await getNetworks()), {
    mainnet: ['mainnet/xlm'],
    testnet: ['testnet/xlm'],
  })
  assert.deepEqual(local.peek(NETWORKS), [mainnet040, testnet040])
})

test('pools smuggled into storage are ignored', async () => {
  local.put(NETWORKS, [
    { ...mainnet040, shielded: [pool('testnet/xlm')] },
    testnet040,
    { ...custom, shielded: [pool('mainnet/xlm')] },
  ])
  assert.deepEqual(poolsOf(await getNetworks()), {
    mainnet: ['mainnet/xlm'],
    testnet: ['testnet/xlm'],
    c0ffee: [],
  })
})

test('a custom network gets no pools, whatever it is added with', async () => {
  local.put(NETWORKS, [mainnet040, testnet040])
  await addNetwork({ ...custom, shielded: [pool('mainnet/xlm')] })
  assert.deepEqual(poolsOf(await getNetworks()).c0ffee, [])
  assert.equal(local.peek(NETWORKS)[2].shielded, undefined)
})

test('a custom network cannot reuse the id of a shipped one', async () => {
  local.put(NETWORKS, [mainnet040, testnet040])
  await assert.rejects(addNetwork({ ...custom, id: 'mainnet' }), /already exists/)
  // One stored under a shipped id all the same, as an edited store can hold, gets no pools.
  local.put(NETWORKS, [
    mainnet040,
    { ...testnet040, ...custom, id: 'testnet', passphrase: TESTNET },
  ])
  assert.deepEqual(poolsOf(await getNetworks()), { mainnet: ['mainnet/xlm'], testnet: [] })
})

test('a private request runs only on the network its page showed', async () => {
  local.put(NETWORKS, [mainnet040, testnet040])
  await setActiveNetwork('testnet')
  assert.equal((await getShieldedNetwork('testnet')).id, 'testnet')
  await assert.rejects(getShieldedNetwork('mainnet'), { code: 'network_changed' })
  await assert.rejects(getShieldedNetwork(undefined), { code: 'network_changed' })
  // Another surface switches networks while the page still shows testnet.
  await setActiveNetwork('mainnet')
  await assert.rejects(getShieldedNetwork('testnet'), { code: 'network_changed' })
  assert.equal((await getShieldedNetwork('mainnet')).id, 'mainnet')
})
