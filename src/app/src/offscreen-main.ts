import * as snarkjs from 'snarkjs'
import { initPoseidon } from '@private/poseidon.js'
import { proveReveal } from '@private/proof.js'
import { deserializeProofInputs } from '@private/proofMessage.js'
import { CIRCUIT_WASM_SHA256, circuitZkey } from '@private/circuitHashes.js'
import {
  SHIELDED_ARTIFACT_SHA256,
  SHIELDED_ZKEY,
  assertShieldedNetwork,
} from '@shielded/circuitHashes.js'
import { loadWallet, receiveAddress } from '@shielded/wallet.js'
import { setCircuitBase } from '@shielded/poseidon2.js'
import { buildShield, buildWithdraw, buildTransferTo, buildScan } from '@shielded/vault.js'
import { serializeSpendPlan } from '@shielded/submit.js'
import { deserializePool } from '@shielded/config.js'
import type { SerializedPool } from '@shielded/config.js'
import type { Note } from '@shielded/notes.js'

// snarkjs proving is too heavy for the ephemeral service worker, so it runs in this offscreen document.
const WASM_URL = chrome.runtime.getURL('circuit/withdraw.wasm')
const SHIELDED_WASM_KEY = 'circuits/transaction.wasm'

// The wasm is shared across networks; the zkey is network-specific, so artifacts are cached per network
// and a testnet proof can never be built against the mainnet key or vice versa.
const artifactsByNetwork = new Map<string, { wasm: Uint8Array; zkey: Uint8Array }>()
let poseidonReady = false

// Each prove path evicts the other so the two ~30MB blobs are never both resident.
let shieldedArtifacts: { wasm: Uint8Array; zkey: Uint8Array } | null = null

// Scan/address needs only the Poseidon wasms, not the 30MB zkey.
let scanPoseidonVerified = false

// Serialize the two snarkjs runs so evicted artifacts are never reloaded mid-proof.
let proveQueue: Promise<unknown> = Promise.resolve()
function withProveLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = proveQueue.then(fn, fn)
  proveQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

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
  // Free the shielded zkey before pulling in the existing-send artifacts.
  shieldedArtifacts = null
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

// Fail closed if an artifact does not match its pinned hash, so no tampered bytes reach a proof.
async function verifyArtifact(key: string): Promise<ArrayBuffer> {
  const want = SHIELDED_ARTIFACT_SHA256[key]
  if (!want) throw new Error(`no pinned hash for ${key}`)
  const buf = await (await fetch(chrome.runtime.getURL(key))).arrayBuffer()
  const got = await sha256Hex(buf)
  if (got !== want) {
    throw new Error(`shielded artifact ${key} integrity check failed: got ${got} want ${want}`)
  }
  return buf
}

// Verify every bundled shielded artifact before any crypto so the proof binds to checked bytes.
async function loadShieldedArtifacts(): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
  if (shieldedArtifacts) {
    return shieldedArtifacts
  }
  // Free the existing-send artifacts so the 30MB shielded zkey is the only big blob resident.
  artifactsByNetwork.clear()
  const keys = Object.keys(SHIELDED_ARTIFACT_SHA256)
  const buffers = await Promise.all(keys.map((k) => verifyArtifact(k)))
  const verified = new Map(keys.map((k, i) => [k, buffers[i]]))
  shieldedArtifacts = {
    wasm: new Uint8Array(verified.get(SHIELDED_WASM_KEY)!),
    zkey: new Uint8Array(verified.get(SHIELDED_ZKEY)!),
  }
  // poseidon2.ts / tree.ts fetch '/circuits/poseidon2_*.wasm' after this passes.
  setCircuitBase('/circuits')
  return shieldedArtifacts
}

// Verify just the Poseidon wasms, skipping the 30MB zkey, to keep the prefetch cheap.
async function loadShieldedScanArtifacts(): Promise<void> {
  if (scanPoseidonVerified) {
    return
  }
  const keys = Object.keys(SHIELDED_ARTIFACT_SHA256).filter(
    (k) => k !== SHIELDED_WASM_KEY && k !== SHIELDED_ZKEY
  )
  await Promise.all(keys.map((k) => verifyArtifact(k)))
  scanPoseidonVerified = true
  // poseidon2.ts / tree.ts fetch '/circuits/poseidon2_*.wasm' after this passes.
  setCircuitBase('/circuits')
}

interface ShieldedRequest {
  op: 'address' | 'scan' | 'shield' | 'send' | 'unshield'
  network: string
  mnemonic: string
  account: number
  pool: SerializedPool
  amount?: string
  recipientCy1?: string
  notes?: Note[]
  knownCommitments?: string[]
}

// Build and prove a shielded op with the integrity-checked buffers; no storage or submit here.
async function runShielded(req: ShieldedRequest): Promise<unknown> {
  assertShieldedNetwork(req.network)
  const wallet = await loadWallet(req.mnemonic, req.account)
  const pool = deserializePool(req.pool)

  // Scan/address load only the verified Poseidon wasms, never the 30MB zkey.
  if (req.op === 'address') {
    await loadShieldedScanArtifacts()
    return await receiveAddress(wallet)
  }
  if (req.op === 'scan') {
    await loadShieldedScanArtifacts()
    return await buildScan(wallet, pool, req.knownCommitments ?? [])
  }

  // Prove ops load + verify the full transaction.wasm + zkey before proving.
  const { wasm, zkey } = await loadShieldedArtifacts()
  // The proof binds to the integrity-checked buffers, never the raw '/circuits' paths.
  const prove = (txInput: Record<string, unknown>) => snarkjs.groth16.fullProve(txInput, wasm, zkey)

  if (req.op === 'shield') {
    if (!req.amount) throw new Error('shield requires amount')
    const plan = await buildShield(wallet, BigInt(req.amount), pool, { prove })
    return serializeSpendPlan(plan)
  }
  if (req.op === 'unshield') {
    if (!req.amount || !req.notes) throw new Error('unshield requires amount and notes')
    const plan = await buildWithdraw(wallet, req.notes, BigInt(req.amount), pool, {
      relay: true,
      prove,
    })
    return serializeSpendPlan(plan)
  }
  if (!req.amount || !req.notes || !req.recipientCy1) {
    throw new Error('send requires amount, notes, and recipient')
  }
  const plan = await buildTransferTo(
    wallet,
    req.notes,
    BigInt(req.amount),
    req.recipientCy1,
    pool,
    { prove }
  )
  return serializeSpendPlan(plan)
}

// Only the service worker (no sender.tab); keeps the proving oracle off-limits to any page.
function fromServiceWorker(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen-prove' && fromServiceWorker(sender)) {
    void withProveLock(async () => {
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
    })
    return true
  }

  if (msg?.target === 'offscreen-shielded' && fromServiceWorker(sender)) {
    void withProveLock(async () => {
      try {
        const result = await runShielded(msg as ShieldedRequest)
        sendResponse({ ok: true, result })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return true
  }

  return false
})
