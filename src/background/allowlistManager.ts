import { ALLOWLIST_STORAGE_KEY } from '@constants/external'
import { LEGACY_NETWORK_TO_CHAIN } from '@constants/chains'
import { getAccountsStore } from './keyManager'

// v2 structure: { [accountKey]: { [chainId]: string[] } } where accountKey is
// `${walletId}:${index}` (chain-neutral, so one HD account's grants survive
// gaining addresses on new chains) and chainId is CAIP-2. Callers still pass
// an address + wallet network id; translation happens here so the call sites
// stay untouched and per-chain grants remain independent.
type AllowList = Record<string, Record<string, string[]>>

const V2_MARKER = '__v2'

function chainIdOf(networkId: string): string {
  return LEGACY_NETWORK_TO_CHAIN[networkId] ?? networkId
}

// Resolves any known address (Stellar today, other families later) to the
// account's stable key. Unknown addresses (e.g. an account removed after the
// grant) fall back to an address-scoped key so grants never silently move.
async function accountKeyOf(address: string): Promise<string> {
  const store = await getAccountsStore()
  const account = store.accounts.find(
    (a) => a.publicKey === address || Object.values(a.addresses ?? {}).includes(address)
  )
  return account ? `${account.walletId}:${account.index}` : `pk:${address}`
}

async function getAllowList(): Promise<AllowList> {
  const result = await chrome.storage.local.get(ALLOWLIST_STORAGE_KEY)
  const raw = result[ALLOWLIST_STORAGE_KEY]
  if (!raw || typeof raw !== 'object') return {}

  if ((raw as Record<string, unknown>)[V2_MARKER]) {
    const { [V2_MARKER]: _marker, ...list } = raw as Record<string, unknown>
    return list as AllowList
  }

  // One-way migration: v1 keys are Stellar pubkeys and wallet network ids;
  // pre-networkId flat arrays are dropped (their network is unknowable).
  const migrated: AllowList = {}
  for (const [pk, val] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(val) || typeof val !== 'object' || val === null) continue
    const accountKey = await accountKeyOf(pk)
    migrated[accountKey] = migrated[accountKey] ?? {}
    for (const [networkId, origins] of Object.entries(val as Record<string, string[]>)) {
      const chainId = chainIdOf(networkId)
      migrated[accountKey][chainId] = [
        ...new Set([...(migrated[accountKey][chainId] ?? []), ...origins]),
      ]
    }
  }
  await saveAllowList(migrated)
  return migrated
}

async function saveAllowList(list: AllowList): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: { ...list, [V2_MARKER]: true } })
}

export async function isAllowed(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<boolean> {
  const list = await getAllowList()
  const key = await accountKeyOf(publicKey)
  return list[key]?.[chainIdOf(networkId)]?.includes(origin) ?? false
}

export async function grantAccess(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<void> {
  const list = await getAllowList()
  const key = await accountKeyOf(publicKey)
  const chainId = chainIdOf(networkId)
  if (!list[key]) list[key] = {}
  if (!list[key][chainId]) list[key][chainId] = []
  if (!list[key][chainId].includes(origin)) {
    list[key][chainId].push(origin)
    await saveAllowList(list)
  }
}

export async function revokeAccess(
  origin: string,
  publicKey: string,
  networkId: string
): Promise<void> {
  const list = await getAllowList()
  const key = await accountKeyOf(publicKey)
  const chainId = chainIdOf(networkId)
  if (!list[key]?.[chainId]) return
  list[key][chainId] = list[key][chainId].filter((o) => o !== origin)
  await saveAllowList(list)
}

export async function revokeAllAccess(publicKey: string, networkId?: string): Promise<void> {
  const list = await getAllowList()
  const key = await accountKeyOf(publicKey)
  if (!list[key]) return
  if (networkId) {
    delete list[key][chainIdOf(networkId)]
  } else {
    delete list[key]
  }
  await saveAllowList(list)
}

// Removes one site from every account and chain. A site that disconnects itself
// must never touch the grants other sites hold.
export async function revokeOriginEverywhere(origin: string): Promise<void> {
  const list = await getAllowList()
  for (const chains of Object.values(list)) {
    for (const chainId of Object.keys(chains)) {
      chains[chainId] = chains[chainId].filter((o) => o !== origin)
    }
  }
  await saveAllowList(list)
}

export async function getConnectedApps(publicKey: string, networkId: string): Promise<string[]> {
  const list = await getAllowList()
  const key = await accountKeyOf(publicKey)
  return list[key]?.[chainIdOf(networkId)] ?? []
}
