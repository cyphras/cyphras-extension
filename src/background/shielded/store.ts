import { base64 } from '@scure/base'
import type { Deployment, KeyValueStore } from '@cyphras/private'

const PREFIX = 'cyphras_shielded_'

// Records are scoped to their vault, so a reset testnet vault starts from a fresh state.
function scopeOf(deployment: Deployment): string {
  return `${PREFIX}${deployment.network}_${deployment.vault}_`
}

// The SDK seals every value and hides every record name, so this store only ever holds ciphertext.
export function chromeStore(deployment: Deployment): KeyValueStore {
  const scope = scopeOf(deployment)
  return {
    async get(key) {
      const name = scope + key
      const value = (await chrome.storage.local.get(name))[name]
      return typeof value === 'string' ? base64.decode(value) : undefined
    },
    async set(key, value) {
      await chrome.storage.local.set({ [scope + key]: base64.encode(value) })
    },
    async delete(key) {
      await chrome.storage.local.remove(scope + key)
    },
  }
}

// Shielded records of any vault this release does not open, such as one a testnet reset retired.
export async function removeRetiredShieldedData(current: readonly Deployment[]): Promise<void> {
  const scopes = current.map(scopeOf)
  const all = await chrome.storage.local.get(null)
  const stale = Object.keys(all).filter(
    (k) => k.startsWith(PREFIX) && !scopes.some((scope) => k.startsWith(scope))
  )
  if (stale.length > 0) await chrome.storage.local.remove(stale)
}
