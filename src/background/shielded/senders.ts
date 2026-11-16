// True for a message from the offscreen prover document, which talks to the worker only over the
// prover port and so never has a reason to send a wallet request.
export function isOffscreenDocument(
  sender: { readonly url?: string },
  offscreenUrl: string
): boolean {
  if (sender.url === undefined) return false
  try {
    const at = new URL(sender.url)
    const offscreen = new URL(offscreenUrl)
    return at.origin === offscreen.origin && at.pathname === offscreen.pathname
  } catch {
    return false
  }
}
