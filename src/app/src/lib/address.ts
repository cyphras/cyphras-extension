export type RecipientFamily = 'stellar' | 'evm' | 'bitcoin'

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Bech32 (any case) or base58 legacy/P2SH; mainnet and test networks alike.
const BITCOIN_ADDRESS = /^((bc|tb)1[ac-hj-np-z02-9]{11,71}|[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34})$/
const BITCOIN_TESTNET_PREFIX = /^(tb1|[mn2])/

export function isBitcoinTestnetAddress(address: string): boolean {
  return BITCOIN_TESTNET_PREFIX.test(address.trim().toLowerCase())
}

// Which network an address belongs to, from its shape alone; the send engine
// for that family still does its own full validation.
export function detectRecipientFamily(address: string): RecipientFamily | null {
  const a = address.trim()
  if (STELLAR_ADDRESS.test(a)) return 'stellar'
  if (EVM_ADDRESS.test(a)) return 'evm'
  if (BITCOIN_ADDRESS.test(/^(bc|tb)1/i.test(a) ? a.toLowerCase() : a)) return 'bitcoin'
  return null
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function nibble(c: string | undefined): number {
  const n = parseInt(c ?? '0', 16)
  return Number.isNaN(n) ? (c ?? '0').charCodeAt(0) % 16 : n
}

// The identicon library only reads Stellar base32 keys, so any other address maps to a
// deterministic stand-in key built from its characters (hex digits keep their value).
export function identiconKeyFor(address: string): string {
  if (/^G[A-Z2-7]{55}$/.test(address)) return address
  const hex = address.replace(/^0x/i, '').toLowerCase()
  let out = 'G'
  for (let i = 0; out.length < 56; i++) {
    const a = nibble(hex[i % hex.length])
    const b = nibble(hex[(i * 7 + 3) % hex.length])
    out += BASE32[(a * 16 + b + i) % 32]
  }
  return out
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
