// @cyphras/private as if a release pinned the mainnet XLM vault: only the fields read before a
// wallet opens are mainnet's, the rest the testnet vault's.
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
