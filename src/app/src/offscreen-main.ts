import type { TransactionWitness } from '@cyphras/private'
import { snarkjsProver } from '@cyphras/private-prover-snarkjs'
import {
  PROVER_PORT,
  PROVER_WAKE,
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
    return { id: req.id, ok: true, proof: toWire(proof) }
  } catch {
    // The witness holds spending keys, so no error detail leaves this document.
    return { id: req.id, ok: false }
  }
}

// Witnesses come only over a port this document opens to the service worker, which accepts it
// from this document alone; nothing else in the extension receives what is posted on it.
let port: chrome.runtime.Port | null = null

// A wake means the worker holds no port of this document, even if another extension page keeps
// the old one open, so every wake replaces it.
function connect(): void {
  port?.disconnect()
  const opened = chrome.runtime.connect({ name: PROVER_PORT })
  opened.onMessage.addListener((req: ProveRequest) => {
    const run = queue.then(() => prove(req))
    queue = run
    void run.then((reply) => opened.postMessage(reply))
  })
  // A stopped worker drops the port; it is opened again when a new worker wakes this document,
  // rather than at once, which would keep restarting the worker. A reply that finds its port
  // closed is lost, and the worker fails that proof.
  opened.onDisconnect.addListener(() => {
    if (port === opened) port = null
  })
  port = opened
}

chrome.runtime.onMessage.addListener(
  (msg: { target?: string }, sender: chrome.runtime.MessageSender) => {
    if (msg?.target === PROVER_WAKE && sender.url === chrome.runtime.getURL('background.js')) {
      connect()
    }
    return false
  }
)

connect()
