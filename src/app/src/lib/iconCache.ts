const ICON_BYTES_KEY = 'cyphras_icon_bytes'
const MAX_ICON_BYTES = 200_000
const MAX_CACHED_ICONS = 400

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Image bytes are cached as data URLs so icons render instantly (and offline)
// after their first load instead of hitting the CDN on every open. Keyed by
// source URL, so a changed URL naturally refetches; the cache only resets if
// it somehow outgrows the curated lists by far.
export async function toDataUrls(
  iconMap: Map<string, string>,
  fetchMissing = true // false serves uncached entries as raw URLs instead of waiting on downloads
): Promise<Map<string, string>> {
  const urls = [...new Set(iconMap.values())]
  const stored = await chrome.storage.local.get(ICON_BYTES_KEY)
  let cache = (stored[ICON_BYTES_KEY] ?? {}) as Record<string, string>
  if (Object.keys(cache).length > MAX_CACHED_ICONS) cache = {}

  const missing = fetchMissing ? urls.filter((u) => !cache[u]) : []
  if (missing.length > 0) {
    await Promise.allSettled(
      missing.map(async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const blob = await res.blob()
        if (blob.size > MAX_ICON_BYTES) return
        cache[url] = await blobToDataUrl(blob)
      })
    )
    chrome.storage.local.set({ [ICON_BYTES_KEY]: cache })
  }

  const out = new Map<string, string>()
  for (const [key, url] of iconMap) out.set(key, cache[url] ?? url)
  return out
}
