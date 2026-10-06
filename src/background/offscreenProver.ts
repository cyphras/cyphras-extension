const OFFSCREEN_URL = 'offscreen.html'
let creating: Promise<void> | null = null

// True when the document had to be created, which then opens its prover port by itself.
export async function ensureOffscreen(): Promise<boolean> {
  const has = (await chrome.offscreen.hasDocument?.()) ?? false
  if (has) {
    return false
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
  return true
}
