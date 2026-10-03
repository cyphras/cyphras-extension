import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { NETWORK, TEST_NETWORK, p2wpkh } from '@scure/btc-signer'

// BIP84 native SegWit (bc1q/tb1q): m/84'/0'/0'/0/index on mainnet and coin type 1 on
// test networks. These are the standard paths, so the same seed restores the coins in
// any BIP84 wallet.
function bitcoinPath(index: number, testnet: boolean): string {
  return `m/84'/${testnet ? 1 : 0}'/0'/0/${index}`
}

export function bitcoinNetwork(testnet: boolean): typeof NETWORK {
  return testnet ? TEST_NETWORK : NETWORK
}

export function deriveBitcoinKey(
  root: HDKey,
  index: number,
  testnet: boolean
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const child = root.derive(bitcoinPath(index, testnet))
  if (!child.privateKey || !child.publicKey) throw new Error('Bitcoin derivation produced no key')
  return { privateKey: child.privateKey, publicKey: child.publicKey }
}

export function bitcoinAddressFromPublicKey(publicKey: Uint8Array, testnet: boolean): string {
  const address = p2wpkh(publicKey, bitcoinNetwork(testnet)).address
  if (!address) throw new Error('Bitcoin address encoding failed')
  return address
}

export function deriveBitcoinKeyFromMnemonic(
  mnemonic: string,
  index: number,
  testnet: boolean
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  return deriveBitcoinKey(HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic)), index, testnet)
}
