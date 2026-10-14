// The deployments this build opens, with the installed SDK release's pins: the shipped networks
// open exactly the pools it pins, and every deployment it pins ships circuit files that match
// those pins byte for byte, since the SDK and the prover refuse any other, and has the second RPC
// provider the release recommends for it, without which one provider alone decides what the
// wallet believes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PINNED_DEPLOYMENTS } from '@cyphras/private'
import { SHIELDED_DEPLOYMENTS } from '../src/background/shielded/deployments.ts'
import { pinnedPool } from '../src/background/shielded/gate.ts'
import { DEFAULT_NETWORKS } from '../src/constants/networks.ts'

test('the shipped networks open exactly the pools the SDK release pins', () => {
  for (const net of DEFAULT_NETWORKS) {
    for (const pool of net.shielded ?? []) {
      const opens = pinnedPool(net, pool, SHIELDED_DEPLOYMENTS) !== undefined
      assert.equal(opens, PINNED_DEPLOYMENTS[pool.deployment] !== null, pool.deployment)
    }
  }
  const testnet = DEFAULT_NETWORKS.find((n) => n.id === 'testnet')
  assert.equal(pinnedPool(testnet, testnet.shielded[0], SHIELDED_DEPLOYMENTS)?.name, 'testnet/xlm')
})

test('every pinned deployment ships circuit files that match its pins', () => {
  for (const { name, deployment, artifactPaths } of Object.values(SHIELDED_DEPLOYMENTS)) {
    for (const [artifact, path] of Object.entries(artifactPaths)) {
      const bytes = readFileSync(new URL(`../src/app/public/${path}`, import.meta.url))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      assert.equal(sha256, deployment.artifacts[artifact], `${name}: ${path}`)
    }
  }
})

test('every pinned deployment that recommends a second RPC has one', () => {
  for (const { name, deployment, secondRpcUrl } of Object.values(SHIELDED_DEPLOYMENTS)) {
    if (deployment.recommendSecondRpc) {
      assert.ok(secondRpcUrl, `${name} recommends a second RPC provider and none is set`)
    }
  }
})
