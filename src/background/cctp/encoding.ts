// Pure encoders/decoders for Circle CCTP V2 wire formats: no network, storage, or key access.
import { StrKey } from '@stellar/stellar-sdk'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  bytesToHex,
  hexToBytes as nobleHexToBytes,
  concatBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js'

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  return nobleHexToBytes(clean)
}

function toHex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function evmAddressToBytes32(address: string): Uint8Array {
  const addr = hexToBytes(address)
  if (addr.length !== 20) throw new Error('invalid EVM address length')
  const out = new Uint8Array(32)
  out.set(addr, 12)
  return out
}

// A valid contract strkey (C address) decodes to exactly 32 raw bytes, so no padding is needed.
export function stellarContractIdToBytes32(contractId: string): Uint8Array {
  return new Uint8Array(StrKey.decodeContract(contractId))
}

function uint256ToBytes32(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('value must be non-negative')
  const hex = value.toString(16)
  if (hex.length > 64) throw new Error('value exceeds uint256')
  return hexToBytes(hex.padStart(64, '0'))
}

function uint32ToBytes32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('value out of uint32 range')
  }
  return uint256ToBytes32(BigInt(value))
}

function rightPad32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 32) * 32)
  out.set(bytes)
  return out
}

function writeU32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff
  out[offset + 1] = (value >>> 16) & 0xff
  out[offset + 2] = (value >>> 8) & 0xff
  out[offset + 3] = value & 0xff
}

function readU32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  )
}

function readBytes32(data: Uint8Array, offset: number): Uint8Array {
  return data.slice(offset, offset + 32)
}

function readUint256(data: Uint8Array, offset: number): bigint {
  return BigInt(toHex(readBytes32(data, offset)))
}

// Computable before broadcast, so the hash is persisted first: a worker death or lost RPC
// response after sending must never leave a possibly-landing tx with no local record.
export function evmTxHash(rawSignedHex: string): string {
  return toHex(keccak_256(hexToBytes(rawSignedHex)))
}

// Hook layout per circlefin/stellar-cctp cctp-forwarder/src/message.rs. The 24-byte magic stays
// zero to opt out of Circle's hosted Forwarding Service; the recipient is the strkey as ASCII.

const HOOK_VERSION = 0
const HOOK_VERSION_OFFSET = 24
const HOOK_LENGTH_OFFSET = 28
const HOOK_RECIPIENT_OFFSET = 32

export interface DecodedHookData {
  version: number
  forwardRecipient: string
}

// Same check as Circle's buildCctpForwarderHookData (circlefin/stellar-cctp examples), so a bad
// recipient fails here instead of encoding a burn that can never be delivered.
function assertValidForwardRecipient(strkey: string): void {
  const valid =
    StrKey.isValidEd25519PublicKey(strkey) ||
    StrKey.isValidContract(strkey) ||
    StrKey.isValidMed25519PublicKey(strkey)
  if (!valid) {
    throw new Error(`invalid forward recipient: ${strkey} (expected a G, C, or M address)`)
  }
}

export function encodeHookData(recipientStrkey: string): Uint8Array {
  assertValidForwardRecipient(recipientStrkey)
  const recipient = utf8ToBytes(recipientStrkey)
  const out = new Uint8Array(HOOK_RECIPIENT_OFFSET + recipient.length)
  writeU32BE(out, HOOK_VERSION_OFFSET, HOOK_VERSION)
  writeU32BE(out, HOOK_LENGTH_OFFSET, recipient.length)
  out.set(recipient, HOOK_RECIPIENT_OFFSET)
  return out
}

export function decodeHookData(hookData: Uint8Array): DecodedHookData {
  if (hookData.length < HOOK_RECIPIENT_OFFSET) throw new Error('hook data too short')
  const version = readU32BE(hookData, HOOK_VERSION_OFFSET)
  const length = readU32BE(hookData, HOOK_LENGTH_OFFSET)
  if (hookData.length < HOOK_RECIPIENT_OFFSET + length) {
    throw new Error('hook data shorter than declared recipient length')
  }
  const recipientBytes = hookData.slice(HOOK_RECIPIENT_OFFSET, HOOK_RECIPIENT_OFFSET + length)
  const forwardRecipient = new TextDecoder().decode(recipientBytes)
  assertValidForwardRecipient(forwardRecipient)
  return { version, forwardRecipient }
}

const SELECTOR_ERC20_APPROVE = '095ea7b3' // approve(address,uint256)
const SELECTOR_DEPOSIT_FOR_BURN_WITH_HOOK = '779b432d' // depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)
const SELECTOR_RECEIVE_MESSAGE = '57ecfd28' // receiveMessage(bytes,bytes)
const SELECTOR_USED_NONCES = 'feb61724' // usedNonces(bytes32)

export function encodeErc20Approve(spender: string, amount: bigint): Uint8Array {
  return concatBytes(
    hexToBytes(SELECTOR_ERC20_APPROVE),
    evmAddressToBytes32(spender),
    uint256ToBytes32(amount)
  )
}

export interface DepositForBurnWithHookParams {
  amount: bigint
  destinationDomain: number
  mintRecipient: Uint8Array // bytes32
  burnToken: string // EVM address
  destinationCaller: Uint8Array // bytes32
  maxFee: bigint
  minFinalityThreshold: number
  hookData: Uint8Array
}

export function encodeDepositForBurnWithHook(params: DepositForBurnWithHookParams): Uint8Array {
  if (params.mintRecipient.length !== 32) throw new Error('mintRecipient must be 32 bytes')
  if (params.destinationCaller.length !== 32) throw new Error('destinationCaller must be 32 bytes')
  if (params.hookData.length === 0) throw new Error('hookData must be non-empty')

  // 7 static head slots + 1 offset slot pointing at the dynamic hookData tail.
  const head = concatBytes(
    uint256ToBytes32(params.amount),
    uint32ToBytes32(params.destinationDomain),
    params.mintRecipient,
    evmAddressToBytes32(params.burnToken),
    params.destinationCaller,
    uint256ToBytes32(params.maxFee),
    uint32ToBytes32(params.minFinalityThreshold),
    uint256ToBytes32(BigInt(8 * 32))
  )
  const tail = concatBytes(
    uint256ToBytes32(BigInt(params.hookData.length)),
    rightPad32(params.hookData)
  )
  return concatBytes(hexToBytes(SELECTOR_DEPOSIT_FOR_BURN_WITH_HOOK), head, tail)
}

export function encodeReceiveMessage(message: Uint8Array, attestation: Uint8Array): Uint8Array {
  const messageOffset = 2 * 32
  const messageTailLen = 32 + Math.ceil(message.length / 32) * 32
  const attestationOffset = messageOffset + messageTailLen

  const head = concatBytes(
    uint256ToBytes32(BigInt(messageOffset)),
    uint256ToBytes32(BigInt(attestationOffset))
  )
  const tail = concatBytes(
    uint256ToBytes32(BigInt(message.length)),
    rightPad32(message),
    uint256ToBytes32(BigInt(attestation.length)),
    rightPad32(attestation)
  )
  return concatBytes(hexToBytes(SELECTOR_RECEIVE_MESSAGE), head, tail)
}

// Takes decodeCctpMessage().nonce as-is: CCTP V2 nonces are already the bytes32 mapping key.
export function encodeUsedNoncesCall(nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes')
  return concatBytes(hexToBytes(SELECTOR_USED_NONCES), nonce)
}

// An eth_call result of exactly zero means "not used"; anything else
// (MessageTransmitterV2 stores NONCE_USED = 1) means a mint already landed.
export function usedNoncesResultIsUsed(callResultHex: string): boolean {
  const bytes = hexToBytes(callResultHex)
  // A mapping getter always returns one 32-byte word. Anything else (e.g. '0x' from a misrouted
  // RPC) is inconclusive, never "not used", so throw rather than let the caller sign a mint.
  if (bytes.length !== 32) {
    throw new Error(`unexpected usedNonces result length: ${callResultHex}`)
  }
  return bytes.some((b) => b !== 0)
}

// Offsets per circlefin/evm-cctp-contracts src/messages/v2/MessageV2.sol and BurnMessageV2.sol.

const HEADER_MESSAGE_BODY_INDEX = 148
const BODY_HOOK_DATA_INDEX = 228

export interface DecodedCctpBurnBody {
  version: number
  burnToken: Uint8Array
  mintRecipient: Uint8Array
  amount: bigint
  messageSender: Uint8Array
  maxFee: bigint
  feeExecuted: bigint
  expirationBlock: bigint
  hookData: Uint8Array
}

export interface DecodedCctpMessage {
  version: number
  sourceDomain: number
  destinationDomain: number
  nonce: Uint8Array
  sender: Uint8Array
  recipient: Uint8Array
  destinationCaller: Uint8Array
  minFinalityThreshold: number
  finalityThresholdExecuted: number
  body: DecodedCctpBurnBody
}

export function decodeCctpMessage(messageHex: string): DecodedCctpMessage {
  const data = hexToBytes(messageHex)
  if (data.length < HEADER_MESSAGE_BODY_INDEX)
    throw new Error('cctp message shorter than its header')
  const body = data.slice(HEADER_MESSAGE_BODY_INDEX)
  if (body.length < BODY_HOOK_DATA_INDEX)
    throw new Error('cctp burn body shorter than its fixed fields')

  return {
    version: readU32BE(data, 0),
    sourceDomain: readU32BE(data, 4),
    destinationDomain: readU32BE(data, 8),
    nonce: readBytes32(data, 12),
    sender: readBytes32(data, 44),
    recipient: readBytes32(data, 76),
    destinationCaller: readBytes32(data, 108),
    minFinalityThreshold: readU32BE(data, 140),
    finalityThresholdExecuted: readU32BE(data, 144),
    body: {
      version: readU32BE(body, 0),
      burnToken: readBytes32(body, 4),
      mintRecipient: readBytes32(body, 36),
      amount: readUint256(body, 68),
      messageSender: readBytes32(body, 100),
      maxFee: readUint256(body, 132),
      feeExecuted: readUint256(body, 164),
      expirationBlock: readUint256(body, 196),
      hookData: body.slice(BODY_HOOK_DATA_INDEX),
    },
  }
}
