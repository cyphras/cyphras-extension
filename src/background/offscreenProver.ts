import type { ProofInputs, ProvedReveal } from '../private/proof.js'
import { serializeProofInputs } from '../private/proofMessage.js'

const OFFSCREEN_URL = 'offscreen.html'
let creating: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  const has = (await chrome.offscreen.hasDocument?.()) ?? false
  if (has) {
    return
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Generate zero-knowledge proofs for private payments',
      })
      .finally(() => {
        creating = null
      })
  }
  await creating
}

export async function generateProof(inputs: ProofInputs, network: string): Promise<ProvedReveal> {
  await ensureOffscreen()
  const res = (await chrome.runtime.sendMessage({
    target: 'offscreen-prove',
    network,
    inputs: serializeProofInputs(inputs),
  })) as {
    ok: boolean
    proved?: ProvedReveal
    error?: string
  }
  if (!res?.ok || !res.proved) {
    throw new Error(res?.error ?? 'proof generation failed')
  }
  return res.proved
}
