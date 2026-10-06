import type { ArtifactName, Prover, TransactionWitness } from '@cyphras/private'
import { snarkjsProver } from '@cyphras/private-prover-snarkjs'
import {
  PROVER_PORT,
  PROVER_WAKE,
  fromWire,
  toWire,
  type ProveReply,
  type ProveRequest,
} from '@bg/shielded/wire'

// A prover per set of package files. Each loads the wasm and zkey itself and keeps the ones that
// matched the pins of a proof; a load that failed is tried again for the next.
const provers = new Map<string, Prover>()

function proverFor(paths: Readonly<Record<ArtifactName, string>>): Prover {
  const key = `${paths.wasm}|${paths.zkey}`
  let prover = provers.get(key)
  if (!prover) {
    prover = snarkjsProver({
      artifacts: {
        async load(name) {
          const res = await fetch(chrome.runtime.getURL(paths[name]))
          return new Uint8Array(await res.arrayBuffer())
        },
      },
      // Extension pages may not start blob: workers, so snarkjs proves on this document's thread.
      singleThread: true,
    })
    provers.set(key, prover)
  }
  return prover
}

// One proof at a time: proving takes the whole thread and most of the memory it can get.
let queue: Promise<unknown> = Promise.resolve()

async function prove(req: ProveRequest): Promise<ProveReply> {
  try {
    const witness = fromWire(req.witness) as TransactionWitness
    const proof = await proverFor(req.paths).prove(witness, req.circuit)
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
