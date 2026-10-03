const OFFSCREEN_URL = 'offscreen.html'
let creating: Promise<void> | null = null

export async function ensureOffscreen(): Promise<void> {
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
