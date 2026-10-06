import { ASSETS_API } from '@constants/backend'
import { RemoteCache } from '@/lib/remoteCache'

export interface Announcement {
  id: number
  title: string
  body: string
  icon?: string
  linkUrl?: string
  linkLabel?: string
  tone: 'info' | 'success' | 'warning'
  dismissible: boolean
  version: number
}

// Short TTL: a card is time-sensitive (a launch, an incident), and the list
// is a few hundred bytes.
const TTL_MS = 5 * 60 * 1000
const DISMISSED_KEY = 'cyphras_dismissed_announcements'

// Wallet pages a card may open, mirrored from the admin API's allowlist; a
// card link is either one of these ("cyphras:/bridge") or an https website.
const WALLET_PAGES = new Set(['/bridge', '/swap', '/receive', '/send', '/history', '/assets/add'])
const WALLET_LINK_PREFIX = 'cyphras:'

/** The wallet route a card link opens, or null when it is a website link. */
export function walletPageOf(link: string): string | null {
  if (!link.startsWith(WALLET_LINK_PREFIX)) return null
  const page = link.slice(WALLET_LINK_PREFIX.length)
  return WALLET_PAGES.has(page) ? page : null
}

function linkOrUndefined(raw: unknown): string | undefined {
  if (typeof raw === 'string' && walletPageOf(raw)) return raw
  return httpsOrUndefined(raw)
}

function httpsOrUndefined(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    return new URL(raw).protocol === 'https:' ? raw : undefined
  } catch {
    return undefined
  }
}

// The panel validates too, but the wallet only trusts what it checks itself:
// text stays text, an icon must be https, and a link must be https or an
// allowlisted wallet page, or it is dropped.
function sanitize(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'number' || typeof r.title !== 'string' || r.title.trim() === '') return null
  const tone = r.tone === 'success' || r.tone === 'warning' ? r.tone : 'info'
  return {
    id: r.id,
    title: r.title.slice(0, 60),
    body: typeof r.body === 'string' ? r.body.slice(0, 140) : '',
    icon: httpsOrUndefined(r.icon),
    linkUrl: linkOrUndefined(r.linkUrl),
    linkLabel: typeof r.linkLabel === 'string' ? r.linkLabel.slice(0, 24) : undefined,
    tone,
    dismissible: r.dismissible !== false,
    version: typeof r.version === 'number' ? r.version : 0,
  }
}

const caches = new Map<string, RemoteCache<Announcement[]>>()

function cacheFor(networkId: string): RemoteCache<Announcement[]> {
  let cache = caches.get(networkId)
  if (!cache) {
    cache = new RemoteCache<Announcement[]>(
      `cyphras_announcements_${networkId}`,
      TTL_MS,
      async () => {
        const res = await fetch(`${ASSETS_API}/v1/announcements?network=${networkId}`, {
          cache: 'no-cache',
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return null
        const data = (await res.json()) as { announcements?: unknown[] }
        return (data.announcements ?? []).map(sanitize).filter((a): a is Announcement => a !== null)
      }
    )
    caches.set(networkId, cache)
  }
  return cache
}

async function withoutDismissed(cards: Announcement[] | null): Promise<Announcement[]> {
  const stored = await chrome.storage.local.get(DISMISSED_KEY)
  const dismissed = (stored[DISMISSED_KEY] ?? {}) as Record<string, number>
  return (cards ?? []).filter((c) => dismissed[c.id] !== c.version)
}

// From the local copy for an instant first paint. A dismissed card comes back only when
// its version is bumped.
export async function getAnnouncements(networkId: string): Promise<Announcement[]> {
  if (networkId !== 'mainnet' && networkId !== 'testnet') return []
  return withoutDismissed(await cacheFor(networkId).get())
}

// The same list straight from the server: the stale-while-revalidate copy lags one open
// behind, which would hide a card published minutes ago until the next open.
export async function fetchAnnouncements(networkId: string): Promise<Announcement[] | null> {
  if (networkId !== 'mainnet' && networkId !== 'testnet') return []
  const fresh = await cacheFor(networkId).refresh()
  return fresh === null ? null : withoutDismissed(fresh)
}

export async function dismissAnnouncement(card: Announcement): Promise<void> {
  const stored = await chrome.storage.local.get(DISMISSED_KEY)
  const dismissed = (stored[DISMISSED_KEY] ?? {}) as Record<string, number>
  dismissed[card.id] = card.version
  await chrome.storage.local.set({ [DISMISSED_KEY]: dismissed })
}
