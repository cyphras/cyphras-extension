// chrome.storage as the background uses it, held in memory. Values go in and come out as JSON, as
// the browser stores them, so a field left undefined is not kept.
function storageArea() {
  const values = new Map()
  return {
    async get(keys) {
      const names = keys == null ? [...values.keys()] : [keys].flat()
      return Object.fromEntries(
        names.filter((k) => values.has(k)).map((k) => [k, JSON.parse(values.get(k))])
      )
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) values.set(key, JSON.stringify(value))
    },
    async remove(keys) {
      for (const key of [keys].flat()) values.delete(key)
    },
    // For tests: what a release stored before, and what the code under test stored.
    put(key, value) {
      values.set(key, JSON.stringify(value))
    },
    peek(key) {
      return values.has(key) ? JSON.parse(values.get(key)) : undefined
    },
    clear() {
      values.clear()
    },
  }
}

export function stubChromeStorage() {
  const local = storageArea()
  const session = storageArea()
  globalThis.chrome = { storage: { local, session } }
  return { local, session }
}
