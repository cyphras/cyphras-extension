// The shielded gate: a pool opens only where the SDK release pins its vault, on the shipped network
// that vault lives on, by name and passphrase.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pinnedPool } from '../src/background/shielded/gate.ts'

const PUBLIC = 'Public Global Stellar Network ; September 2015'
const TESTNET = 'Test SDF Network ; September 2015'

const mainnet = {
  id: 'mainnet',
  name: 'Mainnet',
  horizonUrl: 'https://horizon.stellar.org',
  sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
  passphrase: PUBLIC,
  friendbotUrl: '',
  txTimeout: 90,
  isDefault: true,
}

const xlm = { poolId: 'xlm', deployment: 'mainnet/xlm', label: 'XLM', native: true, decimals: 7 }

// What an SDK release that pins the mainnet XLM vault gives the extension.
const vault = {
  name: 'mainnet/xlm',
  deployment: { id: 'mainnet/xlm', network: 'mainnet', networkPassphrase: PUBLIC },
  rpcUrl: 'https://mainnet.sorobanrpc.com',
  maxRelayerFee: 10_000_000n,
}
const deployments = { 'mainnet/xlm': vault }

test('a pinned deployment opens on its own network and passphrase', () => {
  assert.equal(pinnedPool(mainnet, xlm, deployments), vault)
})

test('a network whose passphrase is not the deployment one is refused', () => {
  assert.equal(pinnedPool({ ...mainnet, passphrase: TESTNET }, xlm, deployments), undefined)
})

test('a deployment the SDK release does not pin is refused', () => {
  assert.equal(pinnedPool(mainnet, xlm, {}), undefined)
  assert.equal(pinnedPool(mainnet, { ...xlm, deployment: 'testnet/xlm' }, deployments), undefined)
})

test('a custom network on the right passphrase is refused', () => {
  assert.equal(
    pinnedPool({ ...mainnet, id: 'my-node', isDefault: false }, xlm, deployments),
    undefined
  )
})
