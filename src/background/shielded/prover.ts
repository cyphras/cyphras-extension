import type {
  ArtifactName,
  ArtifactSource,
  Deployment,
  Groth16Proof,
  Prover,
  TransactionWitness,
} from '@cyphras/private'
import { ensureOffscreen } from '../offscreenProver'
import { PROVE_TARGET, fromWire, toWire, type ProveReply, type ProveRequest } from './wire'

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

// snarkjs runs in the offscreen document, since it needs browser APIs the service worker lacks.
// The document reads its own copy of the wasm and zkey from the package and checks it against the
// same pins, which is far cheaper than passing megabytes through extension messaging.
export function offscreenProver(
  deployment: Deployment,
  paths: Readonly<Record<ArtifactName, string>>
): Prover {
  return {
    async prove(witness: TransactionWitness): Promise<Groth16Proof> {
      await ensureOffscreen()
      const request: ProveRequest = {
        target: PROVE_TARGET,
        witness: toWire(witness),
        wasm: { path: paths.wasm, sha256: deployment.artifacts.wasm },
        zkey: { path: paths.zkey, sha256: deployment.artifacts.zkey },
      }
      const reply = (await chrome.runtime.sendMessage(request)) as ProveReply | undefined
      if (!reply?.ok) throw new Error('the offscreen prover failed')
      return fromWire(reply.proof) as Groth16Proof
    },
  }
}
