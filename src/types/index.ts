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

export type CctpJobStatus =
  | 'created'
  | 'approving'
  | 'burn_submitted'
  | 'burned'
  | 'attested'
  | 'mint_submitted'
  | 'blocked_trustline'
  | 'blocked_gas'
  | 'done'
  | 'failed'

export interface CctpJobInfo {
  id: string
  direction: 'stellar-to-evm' | 'evm-to-stellar'
  status: CctpJobStatus
  amount: string
  sourceAddress: string
  destAddress: string
  maxFee: string
  speed?: 'standard' | 'fast'
  approveTxHash?: string
  burnTxHash?: string
  mintTxHash?: string
  lastError?: string
  createdAt: number
  burnBroadcastAt?: number
  attestedAt?: number
  mintBroadcastAt?: number
  // USDC Circle took, read from the attested message; absent before attestation.
  feeExecuted?: string
}

// One chain's network cost of a bridge, in its native asset. `estimated` means no simulation or
// live gas price backed it; `reserveHint` is the spare native balance required before submitting.
export interface CctpFeeLeg {
  code: string
  amount: string
  estimated: boolean
  reserveHint?: string
}

export interface CctpFeeBreakdown {
  circleFee: string // USDC, an upper bound
  receiveMin: string // USDC the destination receives at minimum
  source: CctpFeeLeg
  destination: CctpFeeLeg
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
  currentPassword?: string // for CHANGE_PASSWORD
  newPassword?: string // for CHANGE_PASSWORD
  timeoutSeconds?: number // for SET_AUTO_LOCK_TIMEOUT
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
  // EVM_TX_STATUS: receipt state of a sent tx, and the fee it actually burned.
  status?: 'pending' | 'success' | 'failed'
  fee?: string
  feeCode?: string
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
  balances?: ChainBalance[] | null
  subentryCount?: number
  secretKey?: string
  timeoutSeconds?: number
  recovered?: number
  // Private mode (shielded). Amounts are stringified stroops to stay JSON-safe.
  shieldedAddress?: string
  shieldedBalance?: string
  // Max movable in one relayed 2-note spend; decides single-tx vs auto-split loop
  shieldedMaxSpendable?: string
  // Unspent note count; sizes the auto-split loop (ceil(noteCount/2) chunks)
  shieldedNoteCount?: string
  shieldedScan?: { added: number; balance: string; maxSpendable: string; noteCount: string }
  shieldedSend?: { hash: string; balance: string }
  // One relayed chunk of an auto-split spend; UI loops until done is true
  shieldedSpendChunk?: { done: boolean; remaining: string; sent: string; balance: string }
  shieldedQuote?: {
    fee: string
    netCost: string
    margin: string
    marginBps: string
    calibrated: boolean
  }
  jobId?: string
  jobs?: CctpJobInfo[]
  maxFee?: string
  breakdown?: CctpFeeBreakdown
  activity?: EvmActivity[]
}

export interface AccountInfo {
  index: number // BIP44 index; -1 for imported secret keys
  publicKey: string
  label: string
  walletId: string // 'primary' | UUID (extra HD wallets) | 'sk:UUID' (imported keys)
  // Per-family derived addresses; the account identity is (walletId, index).
  // publicKey mirrors addresses.stellar during the multichain migration.
  addresses?: Partial<Record<'stellar' | 'evm', string>>
}

// Chain-neutral balance shape crossing the background boundary; raw chain
// wire formats (Horizon balances, EVM RPC results) never leave the background.
export interface ChainBalance {
  chain: string // CAIP-2
  code: string
  issuer: string // '' for native
  amount: string // decimal string in display units
  decimals: number
  isNative: boolean
  // Part of `amount` that cannot be spent: open-offer liabilities, plus the minimum-balance
  // reserve for XLM. Absent means nothing is locked.
  locked?: string
}

// One EVM transfer or contract call touching the account, normalized at the
// background boundary the same way balances are (display units, CAIP-2 chain).
export interface EvmActivity {
  chain: string
  hash: string
  timestamp: string // ISO
  from: string
  to: string
  direction: 'in' | 'out' | 'self'
  status: 'success' | 'failed' | 'pending'
  kind: 'native' | 'erc20' | 'contract'
  amount: string
  code: string
  tokenAddress?: string
  fee?: string // native display units, paid by the sender
  feeCode: string
  method?: string
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
