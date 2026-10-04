import type {
  ArtifactName,
  ArtifactSource,
  Deployment,
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

// Package files read once and shared by every open wallet, so a second account does not hold
// another copy of the zkey.
const packaged = new Map<string, Promise<Uint8Array>>()

async function readPackaged(path: string): Promise<Uint8Array> {
  const res = await fetch(chrome.runtime.getURL(path))
  if (!res.ok) throw new Error(`${path} is missing from the extension`)
  return new Uint8Array(await res.arrayBuffer())
}

// The circuit files shipped in the extension package; the SDK checks each against its pin.
export function packagedArtifacts(paths: Readonly<Record<ArtifactName, string>>): ArtifactSource {
  return {
    load(name) {
      const path = paths[name]
      let reading = packaged.get(path)
      if (!reading) {
        reading = readPackaged(path)
        packaged.set(path, reading)
        reading.catch(() => packaged.delete(path))
      }
      return reading
    },
  }
}

const PORT_WAIT_MS = 15_000

let proverPort: chrome.runtime.Port | null = null
let portWaiters: ((port: chrome.runtime.Port) => void)[] = []
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
  for (const waiter of portWaiters.splice(0)) waiter(port)
  return true
}

async function connectedProver(): Promise<chrome.runtime.Port> {
  await ensureOffscreen()
  if (proverPort) return proverPort
  return new Promise((resolve, reject) => {
    portWaiters.push(resolve)
    chrome.runtime.sendMessage({ target: PROVER_WAKE }).catch(() => undefined)
    setTimeout(() => {
      portWaiters = portWaiters.filter((w) => w !== resolve)
      reject(new Error('the offscreen prover did not connect'))
    }, PORT_WAIT_MS)
  })
}

// snarkjs runs in the offscreen document, since it needs browser APIs the service worker lacks.
// The document reads its own copy of the wasm and zkey from the package and checks it against the
// same pins, which is far cheaper than passing megabytes through extension messaging.
export function offscreenProver(
  deployment: Deployment,
  paths: Readonly<Record<ArtifactName, string>>
): Prover {
  return {
    async prove(witness: TransactionWitness): Promise<Groth16Proof> {
      const port = await connectedProver()
      const request: ProveRequest = {
        id: nextRequest++,
        witness: toWire(witness),
        wasm: { path: paths.wasm, sha256: deployment.artifacts.wasm },
        zkey: { path: paths.zkey, sha256: deployment.artifacts.zkey },
      }
      const reply = await new Promise<ProveReply | undefined>((settle) => {
        pending.set(request.id, { port, settle })
        port.postMessage(request)
      })
      if (!reply?.ok) throw new Error('the offscreen prover failed')
      return fromWire(reply.proof) as Groth16Proof
    },
  }
}
