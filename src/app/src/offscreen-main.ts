import * as snarkjs from 'snarkjs'
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
const SHIELDED_WASM_KEY = 'circuits/transaction.wasm'

let shieldedArtifacts: { wasm: Uint8Array; zkey: Uint8Array } | null = null

// Scan/address needs only the Poseidon wasms, not the 30MB zkey.
let scanPoseidonVerified = false

// Run one shielded op at a time so concurrent requests never load the 30MB zkey or prove in parallel.
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
