/// <reference path="../../private/vendor.d.ts" />
import { initPoseidon } from '@private/poseidon.js'
import { proveReveal } from '@private/proof.js'
import { deserializeProofInputs } from '@private/proofMessage.js'
import { CIRCUIT_WASM_SHA256, CIRCUIT_ZKEY_SHA256 } from '@private/circuitHashes.js'

// snarkjs proving is too heavy for the ephemeral service worker, so it runs in this offscreen document.
const WASM_URL = chrome.runtime.getURL('circuit/withdraw.wasm')
const ZKEY_URL = chrome.runtime.getURL('circuit/withdraw.zkey')

let artifacts: { wasm: Uint8Array; zkey: Uint8Array } | null = null

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function loadArtifacts(): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
  if (!artifacts) {
    const [w, z] = await Promise.all([fetch(WASM_URL), fetch(ZKEY_URL)])
    const [wBuf, zBuf] = await Promise.all([w.arrayBuffer(), z.arrayBuffer()])
    // Reject a tampered or swapped artifact before proving, so a modified circuit cannot silently
    // produce proofs against the wrong constraints.
    const [wasmHash, zkeyHash] = await Promise.all([sha256Hex(wBuf), sha256Hex(zBuf)])
    if (wasmHash !== CIRCUIT_WASM_SHA256 || zkeyHash !== CIRCUIT_ZKEY_SHA256) {
      throw new Error('circuit artifact integrity check failed, refusing to generate a proof')
    }
    artifacts = { wasm: new Uint8Array(wBuf), zkey: new Uint8Array(zBuf) }
    await initPoseidon()
  }
  return artifacts
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only answer the background service worker, never a page: same-extension tab senders carry a
  // sender.tab, the service worker does not. Keeps the proving oracle off-limits to any page.
  if (msg?.target !== 'offscreen-prove' || sender.id !== chrome.runtime.id || sender.tab) {
    return false
  }
  void (async () => {
    try {
      const { wasm, zkey } = await loadArtifacts()
      const proved = await proveReveal(deserializeProofInputs(msg.inputs), wasm, zkey)
      sendResponse({ ok: true, proved })
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return true
})
