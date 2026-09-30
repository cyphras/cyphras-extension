interface Entry<T> {
  value: T
  cachedAt: number
}

// Stale-while-revalidate over chrome.storage.local: once a value is stored, reads never wait
// on the network, and an expired entry triggers one background refresh, so admin-panel
// edits reach the UI on a later open.
export class RemoteCache<T> {
  private inflight: Promise<T | null> | null = null
  private readonly storageKey: string
  private readonly ttlMs: number
  private readonly fetchFresh: () => Promise<T | null>

  constructor(storageKey: string, ttlMs: number, fetchFresh: () => Promise<T | null>) {
    this.storageKey = storageKey
    this.ttlMs = ttlMs
    this.fetchFresh = fetchFresh
  }

  async get(): Promise<T | null> {
    const stored = await chrome.storage.local.get(this.storageKey)
    const entry = stored[this.storageKey] as Entry<T> | undefined
    if (!entry || entry.value === undefined) return this.refresh() // also catches older stored formats
    if (Date.now() - entry.cachedAt > this.ttlMs) void this.refresh()
    return entry.value
  }

  // Public for callers that can detect their copy is incomplete (for example
  // an unknown chain id) and need fresh data ahead of the TTL.
  refresh(): Promise<T | null> {
    this.inflight ??= this.fetchFresh()
      .then(async (value) => {
        if (value !== null) {
          const entry: Entry<T> = { value, cachedAt: Date.now() }
          await chrome.storage.local.set({ [this.storageKey]: entry })
        }
        return value
      })
      .catch(() => null)
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }
}
