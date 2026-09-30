import { ensureOffscreen } from './offscreenProver.js'

// shielded crypto runs offscreen: snarkjs needs URL.createObjectURL, absent in the MV3 service worker
export interface OffscreenShieldedMsg {
  op: 'address' | 'scan' | 'shield' | 'send' | 'unshield'
  network: string
  mnemonic: string
  account: number
  pool: unknown // serialized lib Pool (domain/maxDeposit as strings)
  amount?: string
  recipientCy1?: string
  notes?: unknown // serialized input Note[]
  knownCommitments?: string[]
}

export async function offscreenShielded(msg: OffscreenShieldedMsg): Promise<unknown> {
  await ensureOffscreen()
  const res = (await chrome.runtime.sendMessage({
    target: 'offscreen-shielded',
    ...msg,
  })) as { ok: boolean; result?: unknown; error?: string }
  if (!res?.ok) {
    throw new Error(res?.error ?? 'shielded operation failed')
  }
  return res.result
}
