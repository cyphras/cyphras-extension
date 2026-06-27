import { MESSAGE_TYPES } from '../constants/windowMode'
import type { WindowMode } from '../constants/windowMode'
import type { ServiceType } from '../constants/services'
import type { NetworkConfig } from '../constants/networks'

export interface MessagePayload {
  type: keyof typeof MESSAGE_TYPES
  route?: string
  mode?: WindowMode
}

export interface MessageResponse {
  ok: boolean
  error?: string
}

export interface PaymentParams {
  destination: string
  amount: string
  assetCode: string
  assetIssuer: string
  memo?: string
  memoType?: 'text' | 'id'
  fee?: string
  timeout?: number
}

export interface SwapParams {
  fromAssetCode: string
  fromAssetIssuer: string
  toAssetCode: string
  toAssetIssuer: string
  amount: string
  slippage: string
  fee?: string
  timeout?: number
}

export interface SwapQuote {
  destinationAmount: string
  destMin: string
  path: Array<{ assetCode: string; assetIssuer: string }>
  xdr: string
}

export interface TrustlineParams {
  assetCode: string
  assetIssuer: string
  limit?: string
}

export type PrivateNoteStatus = 'pending' | 'committed' | 'scheduled' | 'revealed' | 'failed'

export interface PrivateNote {
  counter: number
  pool: string
  asset: string
  denomination: string
  relayerFee: string
  recipient: string
  privacyLevel: 'fast' | 'standard' | 'maximum'
  status: PrivateNoteStatus
  txHash: string | null
  revealTxHash?: string
  jobId: string | null
  scheduledFor?: string
  // When scheduling happened, so the delivery bar can advance in step with the ETA countdown.
  scheduledAt?: number
  // The processor's last on-chain check that this note's commit leaf is in the pool, so the UI shows
  // what actually left the wallet rather than the intended amount.
  committedOnChain?: boolean
  // The commit tx fee_charged (stroops), set when the commit confirms, so the fee total renders locally without a Horizon fetch.
  commitFeeStroops?: string
  commitAttempts?: number
  lastError?: string
  recovered?: boolean
  // Shared by every note from one send so History groups splits together; absent on older notes.
  batchId?: string
  createdAt: number
}

export interface PrivateQuotePiece {
  denomination: string
  count: number
  anonSet: number
}

export interface PrivateSendQuote {
  feeStroops: string
  pieces: PrivateQuotePiece[]
  totalNotes: number
  // Per-commit network fee in stroops from simulating a commit; "0" if it could not be estimated.
  commitFeeStroops?: string
}

export interface ServicePayload {
  type: ServiceType
  password?: string
  mnemonic?: string
  secretKey?: string // for IMPORT_SECRET_KEY
  walletId?: string // for ADD_ACCOUNT target wallet, REMOVE_HD_WALLET
  walletLabel?: string // for CREATE_HD_WALLET, IMPORT_HD_WALLET, IMPORT_SECRET_KEY
  publicKey?: string // for SWITCH_ACCOUNT, RENAME_ACCOUNT, REMOVE_ACCOUNT
  index?: number // legacy SWITCH_ACCOUNT, RENAME_ACCOUNT, REMOVE_ACCOUNT
  label?: string // for ADD_ACCOUNT, RENAME_ACCOUNT
  order?: string[] // for REORDER_ACCOUNTS (array of publicKeys in new order)
  networkId?: string
  network?: NetworkConfig
  payment?: PaymentParams
  swap?: SwapParams
  trustline?: TrustlineParams
  horizonUrl?: string
  networkPassphrase?: string
  origin?: string
}

export interface ServiceResponse {
  publicKey?: string
  mnemonic?: string
  error?: string
  code?: string
  isUnlocked?: boolean
  hasWallet?: boolean
  isLegacy?: boolean
  failedAttempts?: number
  lockedUntil?: number
  networks?: NetworkConfig[]
  activeNetwork?: NetworkConfig
  txHash?: string
  xdr?: string
  quote?: SwapQuote
  connectedApps?: string[]
  ok?: boolean
  notes?: PrivateNote[]
  privateQuote?: PrivateSendQuote
  accounts?: AccountInfo[]
  activePublicKey?: string
  account?: AccountInfo
  hdWallets?: HDWalletInfo[]
  importedKeys?: ImportedKeyInfo[]
  unfunded?: boolean
  rawBalances?: Array<{
    balance: string
    asset_type: string
    asset_code?: string
    asset_issuer?: string
  }> | null
  subentryCount?: number
}

export interface AccountInfo {
  index: number // BIP44 index; -1 for imported secret keys
  publicKey: string
  label: string
  walletId: string // 'primary' | UUID (extra HD wallets) | 'sk:UUID' (imported keys)
}

export interface HDWalletInfo {
  id: string
  label: string
  accountCount: number
}

export interface ImportedKeyInfo {
  id: string
  publicKey: string
  label: string
}

export type WalletStatus = {
  hasWallet: boolean
  isUnlocked: boolean
  isLegacy?: boolean
  publicKey?: string
  failedAttempts?: number
  lockedUntil?: number
}
