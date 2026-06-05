import { ALLOWLIST_STORAGE_KEY } from '@constants/external'

// Structure: { [pubkey]: { [networkId]: string[] } }
type AllowList = Record<string, Record<string, string[]>>

async function getAllowList(): Promise<AllowList> {
  const result = await chrome.storage.local.get(ALLOWLIST_STORAGE_KEY)
  const raw = result[ALLOWLIST_STORAGE_KEY]
  if (!raw || typeof raw !== 'object') return {}

  // Migrate from old flat format { pubkey: string[] } -> { pubkey: { networkId: string[] } }
  // Old entries are dropped because we can't determine which network they belonged to.
  const migrated: AllowList = {}
  let needsSave = false
  for (const [pk, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      needsSave = true // old format - discard
    } else if (typeof val === 'object' && val !== null) {
      migrated[pk] = val as Record<string, string[]>
    }
  }
  if (needsSave) {
    await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: migrated })
  }
  return migrated
}

export async function isAllowed(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<boolean> {
  const list = await getAllowList()
  return list[publicKey]?.[networkId]?.includes(origin) ?? false
}

export async function grantAccess(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<void> {
  const list = await getAllowList()
  if (!list[publicKey]) list[publicKey] = {}
  if (!list[publicKey][networkId]) list[publicKey][networkId] = []
  if (!list[publicKey][networkId].includes(origin)) {
    list[publicKey][networkId].push(origin)
    await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: list })
  }
}

export async function revokeAccess(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<void> {
  const list = await getAllowList()
  if (!list[publicKey]?.[networkId]) return
  list[publicKey][networkId] = list[publicKey][networkId].filter((o) => o !== origin)
  await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: list })
}

export async function revokeAllAccess(publicKey: string, networkId?: string): Promise<void> {
  const list = await getAllowList()
  if (!list[publicKey]) return
  if (networkId) {
    delete list[publicKey][networkId]
  } else {
    delete list[publicKey]
  }
  await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: list })
}

export async function getConnectedApps(publicKey: string, networkId: string): Promise<string[]> {
  const list = await getAllowList()
  return list[publicKey]?.[networkId] ?? []
}
