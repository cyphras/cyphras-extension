// @cyphras/private as a release that also pins the mainnet XLM vault would give it. Only the
// fields the extension reads before it opens a wallet are mainnet's; the rest are the testnet
// vault's.
import { PINNED_DEPLOYMENTS as PINNED } from '@cyphras/private'

export * from '@cyphras/private'

export const PINNED_DEPLOYMENTS = Object.freeze({
  ...PINNED,
  'mainnet/xlm': Object.freeze({
    ...PINNED['testnet/xlm'],
    id: 'mainnet/xlm',
    network: 'mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    recommendSecondRpc: true,
  }),
})
