/// <reference path="../../private/vendor.d.ts" />
import { initPoseidon } from '@private/poseidon.js'
import { proveReveal } from '@private/proof.js'
import { deserializeProofInputs } from '@private/proofMessage.js'
import { CIRCUIT_WASM_SHA256, circuitZkey } from '@private/circuitHashes.js'

// snarkjs proving is too heavy for the ephemeral service worker, so it runs in this offscreen document.
const WASM_URL = chrome.runtime.getURL('circuit/withdraw.wasm')

// The wasm is shared across networks; the zkey is network-specific, so artifacts are cached per network
// and a testnet proof can never be built against the mainnet key or vice versa.
const artifactsByNetwork = new Map<string, { wasm: Uint8Array; zkey: Uint8Array }>()
let poseidonReady = false

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function loadArtifacts(network: string): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
  const cached = artifactsByNetwork.get(network)
  if (cached) {
    return cached
  }
  const zkey = circuitZkey(network)
  const [w, z] = await Promise.all([fetch(WASM_URL), fetch(chrome.runtime.getURL(zkey.file))])
  const [wBuf, zBuf] = await Promise.all([w.arrayBuffer(), z.arrayBuffer()])
  // Reject a tampered, swapped, or wrong-network artifact before proving, so a modified circuit cannot
  // silently produce proofs against the wrong constraints or the other network's key.
  const [wasmHash, zkeyHash] = await Promise.all([sha256Hex(wBuf), sha256Hex(zBuf)])
  if (wasmHash !== CIRCUIT_WASM_SHA256) {
    throw new Error(
      `circuit wasm integrity check failed, refusing to prove: got ${wasmHash} want ${CIRCUIT_WASM_SHA256}`
    )
  }
  if (zkeyHash !== zkey.sha256) {
    throw new Error(
      `circuit zkey integrity check failed for ${network}, refusing to prove: got ${zkeyHash} want ${zkey.sha256} from ${zkey.file}`
    )
  }
  const pair = { wasm: new Uint8Array(wBuf), zkey: new Uint8Array(zBuf) }
  artifactsByNetwork.set(network, pair)
  if (!poseidonReady) {
    await initPoseidon()
    poseidonReady = true
  }
  return pair
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only answer the background service worker, never a page: same-extension tab senders carry a
  // sender.tab, the service worker does not. Keeps the proving oracle off-limits to any page.
  if (msg?.target !== 'offscreen-prove' || sender.id !== chrome.runtime.id || sender.tab) {
    return false
  }
  void (async () => {
    try {
      if (typeof msg.network !== 'string' || !msg.network) {
        throw new Error('offscreen-prove message missing network')
      }
      const { wasm, zkey } = await loadArtifacts(msg.network)
      const proved = await proveReveal(deserializeProofInputs(msg.inputs), wasm, zkey)
      sendResponse({ ok: true, proved })
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return true
})
