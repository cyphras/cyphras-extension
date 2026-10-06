const ICON_BYTES_KEY = 'cyphras_icon_bytes'
const MAX_ICON_BYTES = 200_000
const MAX_CACHED_ICONS = 400

// One download per URL per popup session; a URL that failed (often a host
// without CORS, whose image still loads fine in an img) is not retried until
// the next session.
const inFlight = new Set<string>()
const failed = new Set<string>()

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function cacheIcons(urls: string[]): Promise<void> {
  const fetched: Record<string, string> = {}
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (blob.size > MAX_ICON_BYTES) throw new Error('Icon too large')
        fetched[url] = await blobToDataUrl(blob)
      } catch {
        failed.add(url)
      } finally {
        inFlight.delete(url)
      }
    })
  )
  if (Object.keys(fetched).length === 0) return
  // Re-read before writing, so batches finishing in parallel never drop each other's entries.
  const stored = await chrome.storage.local.get(ICON_BYTES_KEY)
  let cache = (stored[ICON_BYTES_KEY] ?? {}) as Record<string, string>
  if (Object.keys(cache).length > MAX_CACHED_ICONS) cache = {}
  await chrome.storage.local.set({ [ICON_BYTES_KEY]: { ...cache, ...fetched } })
}

/**
 * Resolves icons without ever waiting on the network: cached bytes when
 * present, otherwise the source URL for the img to load directly, while the
 * bytes are cached in the background so the next open renders instantly and
 * offline. Keyed by source URL, so a changed URL naturally refetches.
 */
export async function toDataUrls(iconMap: Map<string, string>): Promise<Map<string, string>> {
  const stored = await chrome.storage.local.get(ICON_BYTES_KEY)
  const cache = (stored[ICON_BYTES_KEY] ?? {}) as Record<string, string>
  const missing = [...new Set(iconMap.values())].filter(
    (url) => !cache[url] && !inFlight.has(url) && !failed.has(url)
  )
  if (missing.length > 0) {
    for (const url of missing) inFlight.add(url)
    void cacheIcons(missing)
  }
  const out = new Map<string, string>()
  for (const [key, url] of iconMap) out.set(key, cache[url] ?? url)
  return out
}
