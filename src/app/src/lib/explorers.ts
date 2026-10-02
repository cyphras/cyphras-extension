import {
  BTC_MAINNET_CHAIN,
  BTC_TESTNET_CHAIN,
  type ChainEntry,
  type ChainExplorer,
} from '@constants/chains'

export type StellarExplorer = 'stellar.expert' | 'soroscan' | 'stellarchain'
export type EvmExplorer = 'etherscan' | 'blockscout'
export type BtcExplorer = 'mempool' | 'emzy' | 'blockstream'

export interface ExplorerOption<T extends string> {
  value: T
  label: string
  host: string
  note?: string
}

export const STELLAR_EXPLORERS: ExplorerOption<StellarExplorer>[] = [
  { value: 'stellar.expert', label: 'Stellar.expert', host: 'stellar.expert' },
  { value: 'soroscan', label: 'Soroscan', host: 'soroscan.io' },
  { value: 'stellarchain', label: 'StellarChain', host: 'stellarchain.io' },
]

export const EVM_EXPLORERS: ExplorerOption<EvmExplorer>[] = [
  { value: 'etherscan', label: 'Etherscan', host: 'etherscan.io' },
  { value: 'blockscout', label: 'Blockscout', host: 'blockscout.com' },
]

export const BTC_EXPLORERS: ExplorerOption<BtcExplorer>[] = [
  { value: 'mempool', label: 'mempool.space', host: 'mempool.space' },
  { value: 'emzy', label: 'mempool (emzy.de)', host: 'mempool.emzy.de' },
  { value: 'blockstream', label: 'Blockstream', host: 'blockstream.info', note: 'Mainnet only' },
]

function evmLinks(base: string): ChainExplorer {
  return {
    tx: `${base}/tx/{hash}`,
    account: `${base}/address/{address}`,
    token: `${base}/token/{token}`,
  }
}

function btcLinks(base: string): ChainExplorer {
  return { tx: `${base}/tx/{hash}`, account: `${base}/address/{address}` }
}

const EVM_PRESETS: Record<EvmExplorer, Partial<Record<string, ChainExplorer>>> = {
  etherscan: {
    'eip155:1': evmLinks('https://etherscan.io'),
    'eip155:11155111': evmLinks('https://sepolia.etherscan.io'),
  },
  blockscout: {
    'eip155:1': evmLinks('https://eth.blockscout.com'),
    'eip155:11155111': evmLinks('https://eth-sepolia.blockscout.com'),
  },
}

const BTC_PRESETS: Record<BtcExplorer, Partial<Record<string, ChainExplorer>>> = {
  mempool: {
    [BTC_MAINNET_CHAIN]: btcLinks('https://mempool.space'),
    [BTC_TESTNET_CHAIN]: btcLinks('https://mempool.space/testnet4'),
  },
  emzy: {
    [BTC_MAINNET_CHAIN]: btcLinks('https://mempool.emzy.de'),
    [BTC_TESTNET_CHAIN]: btcLinks('https://mempool.emzy.de/testnet4'),
  },
  blockstream: {
    [BTC_MAINNET_CHAIN]: btcLinks('https://blockstream.info'),
  },
}

/**
 * The links for an EVM or Bitcoin chain under the user's picks. The chain's
 * own (registry) links stand in when the pick does not cover it: a chain added
 * from the admin panel, or a mainnet-only explorer while on testnet.
 */
export function pickChainExplorer(
  chain: ChainEntry,
  picks: { evm: EvmExplorer; btc: BtcExplorer }
): ChainExplorer {
  const preset =
    chain.family === 'evm'
      ? EVM_PRESETS[picks.evm][chain.id]
      : chain.family === 'bip122'
        ? BTC_PRESETS[picks.btc][chain.id]
        : undefined
  return preset ?? chain.explorer
}
