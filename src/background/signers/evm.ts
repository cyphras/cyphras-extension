import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1'

// MetaMask-parity derivation: BIP39 seed -> BIP32 secp256k1 at
// m/44'/60'/0'/0/index -> keccak256(uncompressed pubkey)[12..] with EIP-55
// checksum. The same mnemonic must yield byte-identical addresses to
// MetaMask, which is what makes seed import/export between wallets safe.
export const EVM_PATH_PREFIX = "m/44'/60'/0'/0/"

function toChecksumAddress(addressHex: string): string {
  const lower = addressHex.toLowerCase()
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)))
  let out = '0x'
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  }
  return out
}

export function deriveEvmPrivateKey(mnemonic: string, index = 0): Uint8Array {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const child = HDKey.fromMasterSeed(seed).derive(`${EVM_PATH_PREFIX}${index}`)
  if (!child.privateKey) throw new Error('EVM derivation produced no key')
  return child.privateKey
}

export function evmAddressFromPrivateKey(privateKey: Uint8Array): string {
  const uncompressed = secp256k1.getPublicKey(privateKey, false).slice(1)
  const addressHex = bytesToHex(keccak_256(uncompressed).slice(-20))
  return toChecksumAddress(addressHex)
}

// Minimal RLP encoder - only what an EIP-1559 transaction needs (byte
// strings and nested lists).
type RlpInput = Uint8Array | RlpInput[]

function rlpEncodeLength(length: number, offset: number): Uint8Array {
  if (length < 56) return Uint8Array.from([offset + length])
  const bytes: number[] = []
  for (let l = length; l > 0; l = Math.floor(l / 256)) bytes.unshift(l % 256)
  return Uint8Array.from([offset + 55 + bytes.length, ...bytes])
}

function rlpEncode(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length === 1 && input[0] < 0x80) return input
    return concatBytes(rlpEncodeLength(input.length, 0x80), input)
  }
  const encoded = concatBytes(...input.map(rlpEncode))
  return concatBytes(rlpEncodeLength(encoded.length, 0xc0), encoded)
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

// Big integers RLP-encode as minimal big-endian bytes; zero is empty.
function bigintToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0)
  let hex = value.toString(16)
  if (hex.length % 2 === 1) hex = `0${hex}`
  return hexToBytes(hex)
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export interface Eip1559Tx {
  chainId: bigint
  nonce: bigint
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
  gasLimit: bigint
  to: string
  value: bigint
  data: Uint8Array
}

// Signs a type-2 (EIP-1559) transaction and returns the raw hex ready for
// eth_sendRawTransaction.
export function signEip1559(tx: Eip1559Tx, privateKey: Uint8Array): string {
  const fields: RlpInput = [
    bigintToBytes(tx.chainId),
    bigintToBytes(tx.nonce),
    bigintToBytes(tx.maxPriorityFeePerGas),
    bigintToBytes(tx.maxFeePerGas),
    bigintToBytes(tx.gasLimit),
    hexToBytes(tx.to),
    bigintToBytes(tx.value),
    tx.data,
    [], // access list
  ]
  const unsigned = concatBytes(Uint8Array.from([0x02]), rlpEncode(fields))
  const signature = secp256k1.sign(keccak_256(unsigned), privateKey, { lowS: true })
  const signed: RlpInput = [
    ...fields,
    bigintToBytes(BigInt(signature.recovery)),
    bigintToBytes(signature.r),
    bigintToBytes(signature.s),
  ]
  return `0x02${bytesToHex(rlpEncode(signed))}`
}

// transfer(address,uint256) calldata for ERC-20 sends.
export function erc20TransferData(to: string, amount: bigint): Uint8Array {
  const recipient = to.toLowerCase().replace('0x', '').padStart(64, '0')
  const value = amount.toString(16).padStart(64, '0')
  return hexToBytes(`a9059cbb${recipient}${value}`)
}
