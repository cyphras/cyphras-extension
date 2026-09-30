export type RecipientFamily = 'stellar' | 'evm'

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

// Which network an address belongs to, from its shape alone; the send engine
// for that family still does its own full validation.
export function detectRecipientFamily(address: string): RecipientFamily | null {
  const a = address.trim()
  if (STELLAR_ADDRESS.test(a)) return 'stellar'
  if (EVM_ADDRESS.test(a)) return 'evm'
  return null
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// The identicon library only reads Stellar base32 keys, so an EVM address maps to a
// deterministic stand-in key built from its hex.
export function identiconKeyFor(address: string): string {
  if (/^G[A-Z2-7]{55}$/.test(address)) return address
  const hex = address.replace(/^0x/i, '').toLowerCase()
  let out = 'G'
  for (let i = 0; out.length < 56; i++) {
    const a = parseInt(hex[i % hex.length] ?? '0', 16)
    const b = parseInt(hex[(i * 7 + 3) % hex.length] ?? '0', 16)
    out += BASE32[(a * 16 + b + i) % 32]
  }
  return out
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
