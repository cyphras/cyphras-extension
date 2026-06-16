import * as bip39 from 'bip39'
import { Keypair } from '@stellar/stellar-sdk'

const KEY_DERIVATION_NUMBER = 0
const STORAGE_KEY_ENCRYPTED = 'cyphras_encrypted_key' // legacy: stores derived secret
const STORAGE_KEY_PUBKEY = 'cyphras_public_key' // legacy: stores single pubkey
const STORAGE_KEY_ENCRYPTED_MNEMONIC = 'cyphras_encrypted_mnemonic' // primary HD mnemonic
const STORAGE_KEY_ACCOUNTS = 'cyphras_accounts' // accounts array + activePublicKey
const STORAGE_KEY_HD_WALLETS = 'cyphras_hd_wallets' // extra HD wallets (beyond primary)
const STORAGE_KEY_IMPORTED_KEYS = 'cyphras_imported_keys' // imported secret keys
const SESSION_SECRET_KEY = 'cyphras_session_secret'
const SESSION_MNEMONIC_KEY = 'cyphras_session_mnemonic' // primary mnemonic while unlocked
const SESSION_EXTRA_HD_MNEMONICS_KEY = 'cyphras_session_extra_hd' // extra HD mnemonics while unlocked
const SESSION_IMPORTED_SECRETS_KEY = 'cyphras_session_imported_sk' // imported secrets while unlocked

const STELLAR_SEED_KEY = 'ed25519 seed'
const HARDENED_OFFSET = 0x80000000

// Current encryption version. Bump when changing algorithm/params so old
// wallets can be detected and migrated without breaking existing users.
const CURRENT_ENCRYPTION_VERSION = 1
const PBKDF2_ITERATIONS = 600_000 // NIST SP 800-132 minimum for SHA-256 (2024)

// BIP44 derivation paths per chain - extend here when adding a new chain
export const CHAIN_DERIVATION_PATHS = {
  stellar: [44 + HARDENED_OFFSET, 148 + HARDENED_OFFSET],
  evm: [44 + HARDENED_OFFSET, 60 + HARDENED_OFFSET],
  bitcoin: [44 + HARDENED_OFFSET, 0 + HARDENED_OFFSET],
} as const

export type SupportedChain = keyof typeof CHAIN_DERIVATION_PATHS

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(signature)
}

async function deriveKey(
  seed: Uint8Array,
  pathSegments: readonly number[],
  index: number
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const masterData = await hmacSha512(enc.encode(STELLAR_SEED_KEY), seed)
  let key = masterData.slice(0, 32)
  let chainCode = masterData.slice(32)

  const segments = [...pathSegments, index + HARDENED_OFFSET]

  for (const segment of segments) {
    const buf = new Uint8Array(37)
    buf[0] = 0x00
    buf.set(key, 1)
    buf[33] = (segment >>> 24) & 0xff
    buf[34] = (segment >>> 16) & 0xff
    buf[35] = (segment >>> 8) & 0xff
    buf[36] = segment & 0xff
    const derived = await hmacSha512(chainCode, buf)
    key = derived.slice(0, 32)
    chainCode = derived.slice(32)
  }

  return key
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return arr
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128)
}

export async function deriveKeypairRaw(
  mnemonic: string,
  index = KEY_DERIVATION_NUMBER
): Promise<{ privateKey: Uint8Array; secret: string }> {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const privateKey = await deriveKey(new Uint8Array(seed), CHAIN_DERIVATION_PATHS.stellar, index)
  // Use Stellar SDK for strkey encoding instead of custom base32/CRC - guarantees correct S.../G... output
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(privateKey))
  return { privateKey, secret: keypair.secret() }
}

// Future multi-chain entry point - add chain-specific output formatting when implementing EVM/Bitcoin
export async function deriveChainKeypair(
  mnemonic: string,
  chain: SupportedChain,
  index = 0
): Promise<{ secret: string }> {
  if (chain !== 'stellar') throw new Error(`Chain "${chain}" is not yet supported`)
  const { secret } = await deriveKeypairRaw(mnemonic, index)
  return { secret }
}

export async function encryptAndStore(
  secret: string,
  publicKey: string,
  password: string
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS)

  const enc = new TextEncoder()
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret))

  const payload = {
    v: CURRENT_ENCRYPTION_VERSION, // version field - allows future migration
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(encrypted)),
  }

  await chrome.storage.local.set({
    [STORAGE_KEY_ENCRYPTED]: JSON.stringify(payload),
    [STORAGE_KEY_PUBKEY]: publicKey,
  })
}

export async function decryptSecret(password: string): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY_ENCRYPTED)
  const raw = result[STORAGE_KEY_ENCRYPTED]
  if (!raw) return null

  try {
    const payload = JSON.parse(raw)
    const salt = hexToBytes(payload.salt)
    const iv = hexToBytes(payload.iv)
    const data = hexToBytes(payload.data)

    // Handle wallets encrypted before v1 (310k iterations) vs current v1 (600k iterations).
    // If no version field, this is a pre-v1 wallet - use the old iteration count.
    const iterations = payload.v === CURRENT_ENCRYPTION_VERSION ? PBKDF2_ITERATIONS : 310_000

    const key = await deriveEncryptionKey(password, salt, iterations)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

export async function upgradeEncryptionIfNeeded(password: string): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY_ENCRYPTED)
  const raw = result[STORAGE_KEY_ENCRYPTED]
  if (!raw) return

  try {
    const payload = JSON.parse(raw)
    if (payload.v === CURRENT_ENCRYPTION_VERSION) return // already current

    const secret = await decryptSecret(password)
    if (!secret) return // wrong password - don't upgrade

    const pubkey = await getStoredPublicKey()
    if (!pubkey) return

    await encryptAndStore(secret, pubkey, password) // re-encrypt with v1 params
  } catch {
    // Silent - upgrade is best-effort
  }
}

export async function storeSessionSecret(secret: string): Promise<void> {
  await chrome.storage.session?.set({ [SESSION_SECRET_KEY]: secret })
}

export async function getSessionSecret(): Promise<string | null> {
  const result = await chrome.storage.session?.get(SESSION_SECRET_KEY)
  return result?.[SESSION_SECRET_KEY] ?? null
}

export async function clearSessionSecret(): Promise<void> {
  await chrome.storage.session?.remove(SESSION_SECRET_KEY)
}

export async function getStoredPublicKey(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY_PUBKEY)
  return result[STORAGE_KEY_PUBKEY] ?? null
}

export async function hasWallet(): Promise<boolean> {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_ENCRYPTED,
    STORAGE_KEY_ENCRYPTED_MNEMONIC,
  ])
  return !!(result[STORAGE_KEY_ENCRYPTED] || result[STORAGE_KEY_ENCRYPTED_MNEMONIC])
}

export async function isLegacyWallet(): Promise<boolean> {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_ENCRYPTED,
    STORAGE_KEY_ENCRYPTED_MNEMONIC,
  ])
  return !!result[STORAGE_KEY_ENCRYPTED] && !result[STORAGE_KEY_ENCRYPTED_MNEMONIC]
}

export async function clearWallet(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEY_ENCRYPTED,
    STORAGE_KEY_PUBKEY,
    STORAGE_KEY_ENCRYPTED_MNEMONIC,
    STORAGE_KEY_ACCOUNTS,
    STORAGE_KEY_HD_WALLETS,
    STORAGE_KEY_IMPORTED_KEYS,
  ])
}

export interface AccountInfo {
  index: number // BIP44 index; -1 for imported secret keys
  publicKey: string
  label: string
  walletId: string // 'primary' | UUID (extra HD wallets) | 'sk:UUID' (imported keys)
}

export interface AccountsStore {
  accounts: AccountInfo[]
  activeIndex: number // deprecated - kept for migration
  activePublicKey?: string // canonical active account identifier
}

export interface HDWalletStorageEntry {
  id: string
  label: string
  encryptedMnemonic: string // JSON-stringified encrypted payload
}

export interface ImportedKeyStorageEntry {
  id: string
  publicKey: string
  label: string
  encryptedSecret: string // JSON-stringified encrypted payload
}

export async function encryptAndStoreMnemonic(mnemonic: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS)
  const enc = new TextEncoder()
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(mnemonic))
  const payload = {
    v: CURRENT_ENCRYPTION_VERSION,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(encrypted)),
  }
  await chrome.storage.local.set({ [STORAGE_KEY_ENCRYPTED_MNEMONIC]: JSON.stringify(payload) })
}

export async function decryptMnemonic(password: string): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY_ENCRYPTED_MNEMONIC)
  const raw = result[STORAGE_KEY_ENCRYPTED_MNEMONIC]
  if (!raw) return null
  try {
    const payload = JSON.parse(raw)
    const salt = hexToBytes(payload.salt)
    const iv = hexToBytes(payload.iv)
    const data = hexToBytes(payload.data)
    const iterations = payload.v === CURRENT_ENCRYPTION_VERSION ? PBKDF2_ITERATIONS : 310_000
    const key = await deriveEncryptionKey(password, salt, iterations)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

export async function encryptString(value: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS)
  const enc = new TextEncoder()
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(value))
  return JSON.stringify({
    v: CURRENT_ENCRYPTION_VERSION,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(encrypted)),
  })
}

export async function decryptString(
  encryptedJson: string,
  password: string
): Promise<string | null> {
  try {
    const payload = JSON.parse(encryptedJson)
    const salt = hexToBytes(payload.salt)
    const iv = hexToBytes(payload.iv)
    const data = hexToBytes(payload.data)
    const iterations = payload.v === CURRENT_ENCRYPTION_VERSION ? PBKDF2_ITERATIONS : 310_000
    const key = await deriveEncryptionKey(password, salt, iterations)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic)
}

export async function verifyPassword(password: string): Promise<boolean> {
  const mnemonic = await decryptMnemonic(password)
  if (mnemonic) return true
  const secret = await decryptSecret(password)
  return !!secret
}

// Re-encrypts every credential (mnemonic, legacy secret, HD wallets, imported keys) under newPassword
// in one atomic write; missing any leaves it on the old password and bricks that account.
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const mnemonic = await decryptMnemonic(currentPassword)
  const legacySecret = await decryptSecret(currentPassword)
  if (!mnemonic && !legacySecret) {
    throw new Error('Failed to decrypt wallet data')
  }

  const hdWallets = await getHDWallets()
  const reHdWallets = await Promise.all(
    hdWallets.map(async (hw) => {
      const m = await decryptString(hw.encryptedMnemonic, currentPassword)
      if (!m) {
        throw new Error('Failed to decrypt a secondary wallet; password unchanged')
      }
      return { ...hw, encryptedMnemonic: await encryptString(m, newPassword) }
    })
  )

  const importedKeys = await getImportedKeys()
  const reImportedKeys = await Promise.all(
    importedKeys.map(async (ik) => {
      const s = await decryptString(ik.encryptedSecret, currentPassword)
      if (!s) {
        throw new Error('Failed to decrypt an imported key; password unchanged')
      }
      return { ...ik, encryptedSecret: await encryptString(s, newPassword) }
    })
  )

  const updates: Record<string, unknown> = {}
  if (mnemonic) {
    updates[STORAGE_KEY_ENCRYPTED_MNEMONIC] = await encryptString(mnemonic, newPassword)
  }
  if (legacySecret) {
    updates[STORAGE_KEY_ENCRYPTED] = await encryptString(legacySecret, newPassword)
  }
  if (hdWallets.length > 0) {
    updates[STORAGE_KEY_HD_WALLETS] = reHdWallets
  }
  if (importedKeys.length > 0) {
    updates[STORAGE_KEY_IMPORTED_KEYS] = reImportedKeys
  }

  await chrome.storage.local.set(updates)
}

export async function getHDWallets(): Promise<HDWalletStorageEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY_HD_WALLETS)
  return result[STORAGE_KEY_HD_WALLETS] ?? []
}

export async function saveHDWallets(wallets: HDWalletStorageEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_HD_WALLETS]: wallets })
}

export async function getImportedKeys(): Promise<ImportedKeyStorageEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY_IMPORTED_KEYS)
  return result[STORAGE_KEY_IMPORTED_KEYS] ?? []
}

export async function saveImportedKeys(keys: ImportedKeyStorageEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_IMPORTED_KEYS]: keys })
}

export async function storeSessionExtraHDMnemonics(
  mnemonics: Record<string, string>
): Promise<void> {
  await chrome.storage.session?.set({ [SESSION_EXTRA_HD_MNEMONICS_KEY]: mnemonics })
}

export async function getSessionExtraHDMnemonics(): Promise<Record<string, string>> {
  const result = await chrome.storage.session?.get(SESSION_EXTRA_HD_MNEMONICS_KEY)
  return result?.[SESSION_EXTRA_HD_MNEMONICS_KEY] ?? {}
}

export async function clearSessionExtraHDMnemonics(): Promise<void> {
  await chrome.storage.session?.remove(SESSION_EXTRA_HD_MNEMONICS_KEY)
}

export async function storeSessionImportedSecrets(secrets: Record<string, string>): Promise<void> {
  await chrome.storage.session?.set({ [SESSION_IMPORTED_SECRETS_KEY]: secrets })
}

export async function getSessionImportedSecrets(): Promise<Record<string, string>> {
  const result = await chrome.storage.session?.get(SESSION_IMPORTED_SECRETS_KEY)
  return result?.[SESSION_IMPORTED_SECRETS_KEY] ?? {}
}

export async function clearSessionImportedSecrets(): Promise<void> {
  await chrome.storage.session?.remove(SESSION_IMPORTED_SECRETS_KEY)
}

export async function getAccountsStore(): Promise<AccountsStore> {
  const result = await chrome.storage.local.get(STORAGE_KEY_ACCOUNTS)
  return result[STORAGE_KEY_ACCOUNTS] ?? { accounts: [], activeIndex: 0 }
}

export async function saveAccountsStore(store: AccountsStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: store })
}

export async function storeSessionMnemonic(mnemonic: string): Promise<void> {
  await chrome.storage.session?.set({ [SESSION_MNEMONIC_KEY]: mnemonic })
}

export async function getSessionMnemonic(): Promise<string | null> {
  const result = await chrome.storage.session?.get(SESSION_MNEMONIC_KEY)
  return result?.[SESSION_MNEMONIC_KEY] ?? null
}

export async function clearSessionMnemonic(): Promise<void> {
  await chrome.storage.session?.remove(SESSION_MNEMONIC_KEY)
}
