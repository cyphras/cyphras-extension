// Toolbar badge counting in-flight bridges, so one left running with the
// popup closed stays visible.
import type { CctpJob } from './store'

const BADGE_COLOR = '#1b98e0' // the app's primary blue
const JOBS_PREFIX = 'cyphras_cctp_jobs_'

export async function refreshCctpBadge(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null)
    let inFlight = 0
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(JOBS_PREFIX) || !Array.isArray(value)) continue
      inFlight += (value as CctpJob[]).filter(
        (j) => j.status !== 'done' && j.status !== 'failed'
      ).length
    }
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
    await chrome.action.setBadgeText({ text: inFlight > 0 ? String(inFlight) : '' })
  } catch {
    // badge is cosmetic
  }
}
