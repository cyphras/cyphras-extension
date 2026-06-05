export const CYPHRAS_MSG_REQUEST = 'CYPHRAS_MSG_REQUEST'
export const CYPHRAS_MSG_RESPONSE = 'CYPHRAS_MSG_RESPONSE'
export const CYPHRAS_WALLET_CHANGED = 'CYPHRAS_WALLET_CHANGED'
export const CYPHRAS_INTERNAL_REQUEST = 'CYPHRAS_INTERNAL_REQUEST'
export const CYPHRAS_INTERNAL_RESPONSE = 'CYPHRAS_INTERNAL_RESPONSE'

export const EXTERNAL_SERVICE_TYPES = {
  // Connection
  IS_CONNECTED: 'IS_CONNECTED',
  IS_ALLOWED: 'IS_ALLOWED',
  IS_CONNECTED_AND_ALLOWED: 'IS_CONNECTED_AND_ALLOWED',
  REQUEST_ACCESS: 'REQUEST_ACCESS',
  REVOKE_ACCESS: 'REVOKE_ACCESS',
  REVOKE_ALL_ACCESS: 'REVOKE_ALL_ACCESS',

  // Account
  GET_ADDRESS: 'GET_ADDRESS',
  GET_PUBLIC_KEY: 'GET_PUBLIC_KEY', // returns { publicKey, signerAddress } - used by SDK getAccount()
  GET_ACCOUNT_INFO: 'GET_ACCOUNT_INFO',
  GET_BALANCE: 'GET_BALANCE',
  GET_ASSETS: 'GET_ASSETS',
  HAS_TRUSTLINE: 'HAS_TRUSTLINE',

  // Network
  GET_NETWORK: 'GET_NETWORK',
  GET_NETWORK_DETAILS: 'GET_NETWORK_DETAILS',

  // Signing
  SIGN_TRANSACTION: 'SIGN_TRANSACTION',
  SIGN_MESSAGE: 'SIGN_MESSAGE',
  SIGN_AUTH_ENTRY: 'SIGN_AUTH_ENTRY',

  // Transactions
  SUBMIT_TRANSACTION: 'SUBMIT_TRANSACTION',
  SIGN_AND_SUBMIT: 'SIGN_AND_SUBMIT',
  ESTIMATE_FEE: 'ESTIMATE_FEE',
  GET_TRANSACTION: 'GET_TRANSACTION',

  // Assets
  ADD_ASSET: 'ADD_ASSET',
  REMOVE_ASSET: 'REMOVE_ASSET',
  ADD_TOKEN: 'ADD_TOKEN',

  // Transaction builders (return unsigned XDR - sign + submit separately)
  BUILD_PAYMENT_XDR: 'BUILD_PAYMENT_XDR',
  BUILD_PATH_PAYMENT_XDR: 'BUILD_PATH_PAYMENT_XDR',
  BUILD_MANAGE_OFFER_XDR: 'BUILD_MANAGE_OFFER_XDR',

  // Smart contracts (Soroban)
  INVOKE_CONTRACT: 'INVOKE_CONTRACT',
  SIMULATE_CONTRACT: 'SIMULATE_CONTRACT',
  READ_CONTRACT: 'READ_CONTRACT',
  GET_CONTRACT_SPEC: 'GET_CONTRACT_SPEC',
} as const

export type ExternalServiceType =
  (typeof EXTERNAL_SERVICE_TYPES)[keyof typeof EXTERNAL_SERVICE_TYPES]

export const ALLOWLIST_STORAGE_KEY = 'cyphras_allowlist'
export const PENDING_REQUESTS_KEY = 'cyphras_pending_requests'
// Key in chrome.storage.session where full approval payloads (XDR, etc.) are stored
export const APPROVAL_PAYLOAD_STORAGE_KEY = 'cyphras_approval_payloads'

export interface ExternalRequest {
  id: string
  type: string
  requestType: string
  chain?: string // 'stellar' | 'evm' | 'bitcoin' - defaults to 'stellar' when absent
  origin: string
  payload?: Record<string, unknown>
}

export interface PendingRequest extends ExternalRequest {
  tabId: number
  createdAt: number
}
