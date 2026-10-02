import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { EVM_PATH_PREFIX, evmAddressFromPrivateKey } from './evm'
import { bitcoinAddressFromPublicKey, deriveBitcoinKey } from './bitcoin'

/**
 * Every non-Stellar address of one HD account. The seed is derived once: PBKDF2
 * over the mnemonic is the slow part, the per-chain paths are cheap.
 */
export function deriveAccountAddresses(
  mnemonic: string,
  index: number
): { evm: string; bitcoin: string; bitcoinTestnet: string } {
  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic))
  const evmKey = root.derive(`${EVM_PATH_PREFIX}${index}`).privateKey
  if (!evmKey) throw new Error('EVM derivation produced no key')
  return {
    evm: evmAddressFromPrivateKey(evmKey),
    bitcoin: bitcoinAddressFromPublicKey(deriveBitcoinKey(root, index, false).publicKey, false),
    bitcoinTestnet: bitcoinAddressFromPublicKey(
      deriveBitcoinKey(root, index, true).publicKey,
      true
    ),
  }
}
