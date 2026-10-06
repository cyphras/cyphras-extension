import type {
  ArtifactName,
  ArtifactSource,
  CircuitPins,
  Groth16Proof,
  Prover,
  TransactionWitness,
} from '@cyphras/private'
import { ensureOffscreen } from '../offscreenProver'
import {
  PROVER_PORT,
  PROVER_WAKE,
  fromWire,
  toWire,
  type ProveReply,
  type ProveRequest,
} from './wire'

// The circuit files shipped in the extension package. The SDK reads only the verifying key from
// here, and checks it against its pin.
export function packagedArtifacts(paths: Readonly<Record<ArtifactName, string>>): ArtifactSource {
  return {
    async load(name) {
      const res = await fetch(chrome.runtime.getURL(paths[name]))
      if (!res.ok) throw new Error(`${paths[name]} is missing from the extension`)
      return new Uint8Array(await res.arrayBuffer())
    },
  }
}

const PORT_WAIT_MS = 15_000

let proverPort: chrome.runtime.Port | null = null
let portWaiters: ((port: chrome.runtime.Port) => void)[] = []
// When the last wake went out. A wake makes the document replace its port, which fails whatever
// was sent on the old one, so no second wake goes out while one may still be answered.
let wokenAt = 0
// Requests by ID, with the port each went out on: a port that closes fails only its own.
const pending = new Map<
  number,
  { readonly port: chrome.runtime.Port; readonly settle: (reply: ProveReply | undefined) => void }
>()
let nextRequest = 1

// Accepts the prover port, from the offscreen document only. Returns false for a port of another
// kind.
export function acceptProverPort(port: chrome.runtime.Port): boolean {
  if (port.name !== PROVER_PORT) return false
  if (port.sender?.url !== chrome.runtime.getURL('offscreen.html')) {
    port.disconnect()
    return true
  }
  proverPort = port
  port.onMessage.addListener((reply: ProveReply) => {
    const request = pending.get(reply.id)
    if (request?.port !== port) return
    pending.delete(reply.id)
    request.settle(reply)
  })
  port.onDisconnect.addListener(() => {
    if (proverPort === port) proverPort = null
    for (const [id, request] of pending) {
      if (request.port !== port) continue
      pending.delete(id)
      request.settle(undefined)
    }
  })
  wokenAt = 0
  for (const waiter of portWaiters.splice(0)) waiter(port)
  return true
}

// A document that was just created connects by itself, so only one that is already open is woken.
async function connectedProver(): Promise<chrome.runtime.Port> {
  const created = await ensureOffscreen()
  if (proverPort) return proverPort
  return new Promise((resolve, reject) => {
    portWaiters.push(resolve)
    if (!created && Date.now() - wokenAt > PORT_WAIT_MS) {
      wokenAt = Date.now()
      chrome.runtime.sendMessage({ target: PROVER_WAKE }).catch(() => undefined)
    }
    setTimeout(() => {
      portWaiters = portWaiters.filter((w) => w !== resolve)
      reject(new Error('the offscreen prover did not connect'))
    }, PORT_WAIT_MS)
  })
}

// Sends one request and settles with the document's reply, or with nothing if the port closes
// first.
function request(port: chrome.runtime.Port, req: ProveRequest): Promise<ProveReply | undefined> {
  return new Promise((settle) => {
    pending.set(req.id, { port, settle })
    try {
      port.postMessage(req)
    } catch {
      pending.delete(req.id)
      settle(undefined)
    }
  })
}

// snarkjs runs in the offscreen document, since it needs browser APIs the service worker lacks.
// The document loads the wasm and zkey from the package itself and proves only with files that
// match the pins of the proof, so the worker never holds the proving key. A port that closes before
// the document answers loses only the request: nothing is saved before a proof, so the proof is
// asked for once more on a new port. A failure the document reports is not retried.
export function offscreenProver(paths: Readonly<Record<ArtifactName, string>>): Prover {
  return {
    async prove(witness: TransactionWitness, circuit: CircuitPins): Promise<Groth16Proof> {
      for (let attempt = 1; ; attempt++) {
        const reply = await request(await connectedProver(), {
          id: nextRequest++,
          witness: toWire(witness),
          circuit: { wasm: circuit.wasm, zkey: circuit.zkey },
          paths,
        })
        if (reply?.ok) return fromWire(reply.proof) as Groth16Proof
        if (reply || attempt === 2) throw new Error('the offscreen prover failed')
      }
    },
  }
}
