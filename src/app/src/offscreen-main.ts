import type { TransactionWitness } from '@cyphras/private'
import { snarkjsProver } from '@cyphras/private-prover-snarkjs'
import {
  PROVE_TARGET,
  fromWire,
  toWire,
  type ProveArtifact,
  type ProveReply,
  type ProveRequest,
} from '@bg/shielded/wire'

// Extension pages may not start blob: workers, so snarkjs proves on this document's own thread.
const prover = snarkjsProver({ singleThread: true })

// Checked files by path and pin; a failed load is retried on the next request.
const artifacts = new Map<string, Promise<Uint8Array>>()

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

// The proof binds to bytes that match the pin the service worker checked its own copy against.
function load(artifact: ProveArtifact): Promise<Uint8Array> {
  const key = `${artifact.path}:${artifact.sha256}`
  let loading = artifacts.get(key)
  if (!loading) {
    loading = (async () => {
      const res = await fetch(chrome.runtime.getURL(artifact.path))
      const bytes = new Uint8Array(await res.arrayBuffer())
      if ((await sha256Hex(bytes)) !== artifact.sha256) {
        throw new Error(`${artifact.path} does not match its pin`)
      }
      return bytes
    })()
    artifacts.set(key, loading)
    loading.catch(() => artifacts.delete(key))
  }
  return loading
}

// One proof at a time: proving takes the whole thread and most of the memory it can get.
let queue: Promise<unknown> = Promise.resolve()

async function prove(req: ProveRequest): Promise<ProveReply> {
  try {
    const [wasm, zkey] = await Promise.all([load(req.wasm), load(req.zkey)])
    const proof = await prover.prove(fromWire(req.witness) as TransactionWitness, { wasm, zkey })
    return { ok: true, proof: toWire(proof) }
  } catch {
    // The witness holds spending keys, so no error detail leaves this document.
    return { ok: false }
  }
}

// Proofs are for the extension itself; a content script, which runs in a tab, is turned away.
function fromExtension(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab
}

chrome.runtime.onMessage.addListener((msg: { target?: string }, sender, sendResponse) => {
  if (msg?.target !== PROVE_TARGET || !fromExtension(sender)) return false
  const run = queue.then(() => prove(msg as ProveRequest))
  queue = run
  void run.then(sendResponse)
  return true
})
