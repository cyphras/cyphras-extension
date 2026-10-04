import { base64 } from '@scure/base'
import type { Deployment, KeyValueStore } from '@cyphras/private'

// The SDK seals every value and hides every record name, so this store only ever holds ciphertext.
// Records are scoped to their vault, so a reset testnet vault starts from a fresh state.
export function chromeStore(deployment: Deployment): KeyValueStore {
  const scope = `cyphras_shielded_${deployment.network}_${deployment.vault}_`
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
