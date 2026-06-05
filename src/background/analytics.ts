/// <reference types="chrome" />

/**
 * Anonymous usage analytics.
 *
 * Privacy rules enforced here:
 *  - No wallet addresses, public keys, or signerAddress ever sent
 *  - No transaction XDR, hashes, or amounts
 *  - No dApp origins or URLs
 *  - No IP address (server must not log it - configure nginx: access_log off)
 *  - Anonymous UUID is random and not linked to any identity
 *  - Error codes are whitelisted constants only - no dynamic strings from user data
 *  - Users can opt out via Settings -> Privacy toggle
 */

const ANON_ID_KEY = 'cyphras_anon_id'
const LAST_PING_KEY = 'cyphras_analytics_last_ping'
const OPT_OUT_KEY = 'cyphras_analytics_opt_out'
const DAILY_ALARM = 'cyphras_analytics_daily'
const ENDPOINT = 'https://api.cyphras.com/v1/analytics/event'

// Whitelisted Horizon/SDK error codes safe to send - no user data leaks through these
const SAFE_ERROR_CODES = new Set([
  'SIGN_FAILED',
  'SUBMIT_FAILED',
  'TRUSTLINE_FAILED',
  'SIMULATE_FAILED',
  'INVOKE_FAILED',
  'READ_FAILED',
  'FETCH_FAILED',
  'FEE_ESTIMATE_FAILED',
  'TX_FAILED',
  'NOT_SUPPORTED',
  'TIMEOUT',
  'NOT_CONNECTED',
  'WALLET_LOCKED',
  'tx_bad_seq',
  'tx_bad_auth',
  'tx_insufficient_balance',
  'tx_no_source_account',
  'tx_insufficient_fee',
  'tx_bad_auth_extra',
  'tx_internal_error',
  'tx_not_supported',
  'op_no_destination',
  'op_no_trust',
  'op_line_full',
  'op_underfunded',
  'op_src_no_trust',
  'op_no_issuer',
  'op_low_reserve',
])

async function getAnonId(): Promise<string> {
  const res = await chrome.storage.local.get(ANON_ID_KEY)
  if (res[ANON_ID_KEY]) return res[ANON_ID_KEY] as string
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [ANON_ID_KEY]: id })
  return id
}

async function isOptedOut(): Promise<boolean> {
  const res = await chrome.storage.local.get(OPT_OUT_KEY)
  return res[OPT_OUT_KEY] === true
}

async function send(
  event: string,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  try {
    if (await isOptedOut()) return
    const anonymousId = await getAnonId()
    const { version } = chrome.runtime.getManifest()
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        anonymousId,
        version,
        timestamp: new Date().toISOString(),
        ...props,
      }),
    })
  } catch {
    // Never surface analytics failures to users
  }
}

function safeErrorCode(code: string): string {
  return SAFE_ERROR_CODES.has(code) ? code : 'UNKNOWN'
}

/** First install only */
export async function trackInstall(): Promise<void> {
  await send('install')
}

/**
 * Daily active user ping.
 * De-duped to one ping per calendar day via chrome.storage.
 */
export async function trackDailyPing(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const res = await chrome.storage.local.get(LAST_PING_KEY)
  if (res[LAST_PING_KEY] === today) return
  await send('daily_active')
  await chrome.storage.local.set({ [LAST_PING_KEY]: today })
}

/** Called when a wallet is successfully created or imported for the first time */
export async function trackWalletCreated(method: 'hd_wallet' | 'import_key'): Promise<void> {
  await send('wallet_created', { method })
}

/** Funnel step - where users drop off during onboarding */
export async function trackOnboardingStep(
  step: 'create_wallet' | 'import_wallet' | 'backup_shown' | 'completed'
): Promise<void> {
  await send('onboarding_step', { step })
}

/** User approved a dApp connection request */
export async function trackConnect(): Promise<void> {
  await send('connect_approved')
}

/** User rejected a dApp connection request */
export async function trackConnectRejected(): Promise<void> {
  await send('connect_rejected')
}

/** User approved a sign request */
export async function trackSign(type: 'transaction' | 'message' | 'authEntry'): Promise<void> {
  await send('sign_approved', { type })
}

/** User rejected a sign request */
export async function trackSignRejected(
  type: 'transaction' | 'message' | 'authEntry'
): Promise<void> {
  await send('sign_rejected', { type })
}

/** Transaction submitted successfully */
export async function trackSubmit(method: 'submit' | 'sign_and_submit'): Promise<void> {
  await send('tx_submitted', { method })
}

/**
 * Transaction submission failed.
 * Only whitelisted Horizon/SDK error codes are forwarded - no dynamic data.
 */
export async function trackSubmitFailed(errorCode: string): Promise<void> {
  await send('tx_submit_failed', { error_code: safeErrorCode(errorCode) })
}

/** A new account was added to the wallet */
export async function trackAccountAdded(method: 'hd_derive' | 'import_key'): Promise<void> {
  await send('account_added', { method })
}

/**
 * User switched active network.
 * Only sends the type ('mainnet' | 'testnet' | 'custom') - never the network URL or name.
 */
export async function trackNetworkSwitched(networkId: string): Promise<void> {
  const type = networkId === 'mainnet' ? 'mainnet' : networkId === 'testnet' ? 'testnet' : 'custom'
  await send('network_switched', { to: type })
}

/** A contract method was called */
export async function trackContractInvoked(mode: 'invoke' | 'simulate' | 'read'): Promise<void> {
  await send('contract_invoked', { mode })
}

/**
 * An extension-level error occurred.
 * Only whitelisted error codes are forwarded.
 */
export async function trackError(code: string): Promise<void> {
  await send('extension_error', { error_code: safeErrorCode(code) })
}

/**
 * Register the hourly alarm that drives the daily ping check.
 * Must be called on onInstalled AND on service-worker startup -
 * MV3 workers are killed and restarted, losing in-memory alarms.
 */
export function setupAnalyticsAlarm(): void {
  chrome.alarms.get(DAILY_ALARM, (existing: chrome.alarms.Alarm | undefined) => {
    if (!existing) {
      chrome.alarms.create(DAILY_ALARM, { periodInMinutes: 60 })
    }
  })
}

export { DAILY_ALARM, OPT_OUT_KEY }
