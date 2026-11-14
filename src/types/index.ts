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
  // The reviewed quote's floor and route; signing uses them as they are.
  destMin?: string
  path?: Array<{ assetCode: string; assetIssuer: string }>
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
  // Approve confirmed but no burn was sent; waits for the user to continue or cancel.
  | 'approved'
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

// Private mode views. Amounts are stroops as decimal strings; times are Unix milliseconds unless a
// field says seconds.

// The network and account a request's view showed; refused once either is no longer active.
export interface ShieldedScope {
  networkId: string
  publicKey: string
}

// Why a transaction the account submits itself asks more than the wallet pays without asking: the
// network's own fees, a renewal of the pool's entries close to expiring, or a restore of archived
// ones.
export type ShieldedFeeReason = 'network' | 'rent' | 'restore'

// What a fee renews or restores, by the SDK's kinds of pool entries.
export type ShieldedFeeEntry =
  | 'code'
  | 'instance'
  | 'tree'
  | 'balance'
  | 'asset'
  | 'record'
  | 'other'

// A network fee above what the wallet pays without asking, as the wallet's own simulation reported
// it. ceiling is the most its transaction may pay once approved: 10% above the fee, the resource
// part rounded up to 0.01 XLM. most is what the whole call may pay, the ceiling plus the default
// room of a transaction after a restore; the background holds the call to it. approval names the
// background's offer, which the popup returns with the user's yes, once.
export interface ShieldedFeeView {
  reason: ShieldedFeeReason
  total: string
  inclusionCap: string
  ceiling: string
  most: string
  // What the payment, deposit or action has signed for in network fees so far, over every call
  // its fees stopped; an upper bound of what the network charged. restored: one of those was a
  // restore of the pool's entries; attempted: one was the call itself, which did not go through.
  // The review is for the next step only.
  paid?: string
  restored?: boolean
  attempted?: boolean
  entries: ShieldedFeeEntry[]
  approval?: string
}

export interface ShieldedErrorView {
  code: string
  message: string
  // The failure came after the deposit or payment was saved or sent, so it may still land: a
  // payment is paid again only through a retry of planId, never through a new one.
  mayLand?: boolean
  planId?: string
  // The fee to review before the transaction goes again with a higher cap.
  fee?: ShieldedFeeView
  // The relayer did not send the payment, and why; planId names it. The relayer still holds its
  // proof, so it is paid again only through a retry with the same notes.
  refusal?: 'network_fee_high' | 'restore_needed'
  // The background's offer to submit that retry from the account, at most the default fee.
  selfPay?: string
  // The relayer's fee for a payment the pool queues is above what this wallet allows.
  queued?: boolean
  // A payment to the same destination that may still land; a new one waits for it.
  openPlanId?: string
  // The transaction of a restore that failed on chain.
  hash?: string
}

export interface ShieldedBalanceView {
  spendable: string
  pendingDeposits: string
  locked: string // inputs of payments not yet confirmed or dead
  awaitingPayout: string // unshields waiting in the vault's exit queue
  // Part of spendable whose notes a payment of this account was refused for as already spent;
  // never added to spendable.
  maybeSpent: string
}

// 'unresolved': it was still submitting when no RPC provider held the ledgers it could have landed
// in any more. Whether it landed is unknown, but it can no longer land.
export type ShieldedDepositState =
  | 'submitting'
  | 'pending'
  | 'admitted'
  | 'cancelled'
  | 'refunded'
  | 'failed'
  | 'unresolved'

// What a screening reason code means; 'unknown' says nothing about whether the deposit may still
// be admitted.
export type ShieldedScreening =
  | 'held_for_review'
  | 'refused_by_reviewer'
  | 'legal_hold'
  | 'refused'
  | 'cancelled'
  | 'unknown'

export interface ShieldedDepositView {
  id: number | null // null until the deposit's ID is known
  amount: string
  state: ShieldedDepositState
  txHash: string | null
  // Passed screening, so only the pool's delay remains; null while the wallet cannot tell.
  attested: boolean | null
  earliestAdmission: number | null // Unix seconds
  flag: { reason: number; kind: ShieldedScreening } | null
  refundableAt: number | null // Unix seconds
  refundKind: ShieldedScreening | null
  // False while the state rests on the indexer's word alone, or on the wallet's own cancel or
  // refund that not every RPC provider reports a success yet.
  confirmed: boolean
}

export type ShieldedPlanState =
  | 'prepared'
  | 'submitted'
  | 'confirmed'
  | 'queued'
  | 'settled'
  | 'stranded'
  | 'superseded'
  | 'dead'

export interface ShieldedPlanView {
  planId: string
  kind: 'send' | 'unshield'
  amount: string
  fee: string
  to: string
  // The relayer it went through, or the account that submitted it itself; a retry goes the same
  // way unless the popup asks for the other.
  route: { kind: 'relayer'; url: string } | { kind: 'self'; account: string }
  state: ShieldedPlanState
  txHash: string | null
  createdAt: number
  payoutLeft: string | null
  // False while the exit's state rests on the indexer's word alone; null for a plan with no exit.
  exitConfirmed: boolean | null
  // Exits of this payout that the destination could not receive, each claimable on its own.
  strandedExits: number[]
  relayerStatus: string | null
  // Why its submission last stopped before anything was sent: the relayer's refusal code, or the
  // wallet's own error code for a self-relayed one; null once it landed.
  relayerCode: string | null
  lastError: string | null
  // Paying again must go through a retry with the same notes, never through a new send.
  mustRetry: boolean
  needsUserDecision: boolean
  // The plan it proves again with the same notes, and the first plan of that line, which every
  // plan spending those notes shares: a balance counts a family once.
  retryOf: string | null
  familyId: string
  // What the notes it spends hold, and what of that comes back after the amount and the fee.
  inputValue: string
  change: string
  // The last ledger its proof can land in, and an estimate, in Unix milliseconds, of when that
  // ledger closes; null until a sync has read close times. Only mustRetry and needsUserDecision
  // decide whether it may be paid again.
  deadline: number
  deadlineBy: number | null
}

// One entry of the private history. A deposit and a payment of this account carry what ties them to
// its status, which holds their current state and actions; an entry rebuilt from the chain has only
// what the chain shows.
export interface ShieldedHistoryItem {
  id: string
  kind: 'shield' | 'send' | 'receive' | 'unshield' | 'refund' | 'cancel' | 'claim'
  amount: string
  // The relayer fee of a relayed payment; null where the account paid the network itself, or where
  // the chain does not separate the fee from the amount, which then includes it.
  fee: string | null
  // The private address paid, the Stellar address unshielded to or claimed for, or the depositor;
  // null for an unshield rebuilt from the chain whose destination no checked event showed.
  counterparty: string | null
  txHash: string | null
  ledger: number | null
  // Unix milliseconds: when the account made it, or when its ledger closed as the first RPC
  // provider reported it, unconfirmed; null when neither is known.
  time: number | null
  planId: string | null
  // The deposit an entry is about: its shield transaction, or its ID when the wallet knows no
  // transaction, as for a deposit recovered from the chain.
  depositTx: string | null
  depositId: number | null
  // Rebuilt from the chain with the viewing keys, with no record of the account's own.
  recovered: boolean
}

export interface ShieldedStatusView {
  address: string
  balance: ShieldedBalanceView
  deposits: ShieldedDepositView[]
  plans: ShieldedPlanView[]
  syncedAt: number | null
  syncError: ShieldedErrorView | null
  // Where the last sync read the pool's history: 'archive' when neither an indexer nor the RPC still
  // held it and the pool's published archive copies, checked against the chain, did.
  syncSource: 'indexer' | 'rpc' | 'archive' | null
  // 'mismatch': a service or the vault points elsewhere, so shields and spends are refused.
  services: 'verified' | 'unverified' | 'mismatch'
  // The SDK's warning from when this pool last started this account from a fresh state, and when
  // (Unix milliseconds); kept until the user dismisses it.
  stateReset: { warning: string; at: number } | null
}

// What a send or unshield would pay now, and what the notes as of the last sync can move with that
// fee; the review asks the relayer again.
export interface ShieldedQuoteView {
  fee: string
  // The most one payment can move after the fee: from the two largest notes, and for an unshield
  // within the pool's cap for one withdrawal. Null before the wallet's first sync.
  maxAmount: string | null
}

// The pool's limits as the chain shows them now, for the active account as the depositor.
export interface ShieldedLimitsView {
  minDeposit: string
  maxDeposit: string
  maxDailyPerDepositor: string // what one account may deposit in a UTC day
  // The largest deposit the pool takes now: within its maximum, its room before the TVL cap and
  // what is left of the account's daily allowance.
  depositRoom: string
  // A deposit of at least this waits delayLarge seconds before it can be admitted, a smaller one
  // delaySmall.
  largeDepositThreshold: string
  delaySmall: number
  delayLarge: number
  // Across all users per UTC day; a payout past it waits in the exit queue.
  maxDailyOutflow: string
  depositsPaused: boolean
  haltedUntil: number | null // Unix seconds
}

export interface ShieldedReceiptView {
  depositId: number | null // null until a sync finds the ID
  txHash: string
}

export interface ShieldedReviewView {
  reviewId: string
  kind: 'send' | 'unshield'
  amount: string
  fee: string
  to: string
  selfRelay: boolean
  // Asked again after the relayer raised its fee: the payment is already saved with these notes
  // and may still land, so declining it never makes way for a new payment.
  repriced: boolean
  // The pool will queue this payment, and the relayer asks its queued fee, above its usual one.
  queued: { usual: string } | null
  warnings: { code: string; message: string }[]
}

export type ShieldedStep =
  | { kind: 'review'; review: ShieldedReviewView }
  | { kind: 'submitted'; planId: string; txHash: string | null; fee: string }

// A restore of the pool's archived entries: its transaction, null when nothing needed restoring.
export interface ShieldedRestoreView {
  txHash: string | null
  restored: number
}

export interface ServicePayload {
  type: ServiceType
  password?: string
  mnemonic?: string
  secretKey?: string // for IMPORT_SECRET_KEY
  walletId?: string // for ADD_ACCOUNT target wallet, REMOVE_HD_WALLET
  walletLabel?: string // for CREATE_HD_WALLET, IMPORT_HD_WALLET, IMPORT_SECRET_KEY
  publicKey?: string // for SWITCH_ACCOUNT, RENAME_ACCOUNT, REMOVE_ACCOUNT, every private request
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
  // Bitcoin: fee tiers in sat/vB, and a built payment's figures (sats as strings, JSON-safe).
  btcFees?: { slow: number; normal: number; fast: number }
  btcQuote?: {
    feeSats: string
    sendSats: string
    vsize: number
    spendableSats: string
    pendingSats: string
  }
  xdr?: string
  quote?: SwapQuote
  connectedApps?: string[]
  ok?: boolean
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
  // Private mode (shielded); set beside `error` when a shielded request fails.
  shieldedError?: ShieldedErrorView
  shieldedAddress?: string
  shieldedStatus?: ShieldedStatusView
  shieldedReceipt?: ShieldedReceiptView
  shieldedStep?: ShieldedStep
  shieldedQuote?: ShieldedQuoteView
  shieldedLimits?: ShieldedLimitsView
  shieldedHistory?: ShieldedHistoryItem[]
  shieldedRestore?: ShieldedRestoreView
  jobId?: string
  jobs?: CctpJobInfo[]
  maxFee?: string
  breakdown?: CctpFeeBreakdown
  activity?: ChainActivity[]
}

export interface AccountInfo {
  index: number // BIP44 index; -1 for imported secret keys
  publicKey: string
  label: string
  walletId: string // 'primary' | UUID (extra HD wallets) | 'sk:UUID' (imported keys)
  // Per-family derived addresses; the account identity is (walletId, index).
  // publicKey mirrors addresses.stellar during the multichain migration.
  addresses?: Partial<Record<'stellar' | 'evm' | 'bitcoin' | 'bitcoinTestnet', string>>
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
export interface ChainActivity {
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
