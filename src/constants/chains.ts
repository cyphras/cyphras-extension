// Multichain foundation: a chain FAMILY fixes the code paths (signer, tx
// pipeline, dapp handlers); a CHAIN ENTRY fixes the configuration. Entries
// come from three sources merged in this order of authority: user custom
// chains, these shipped builtins, then the backend registry (display/config
// refresh only - the registry must never supply relayer/shielded fields,
// those stay shipped-only as the trust anchor).
export type ChainFamily = 'stellar' | 'evm' | 'bip122'

export interface ChainExplorer {
  tx: string
  account: string
  token?: string
}

export interface StellarChainConfig {
  horizonUrl: string
  sorobanRpcUrl: string
  passphrase: string
  friendbotUrl?: string
}

export interface EvmChainConfig {
  chainId: number
  rpcUrls: string[]
}

export interface ChainEntry {
  id: string // CAIP-2: 'stellar:pubnet', 'eip155:1', ...
  family: ChainFamily
  name: string
  icon?: string
  isTestnet: boolean
  enabled: boolean
  explorer: ChainExplorer
  nativeCurrency: { symbol: string; decimals: number }
  stellar?: StellarChainConfig
  evm?: EvmChainConfig
}

// Maps the legacy network ids that scope storage and backend headers to the
// CAIP-2 chain ids and back. Builtin Stellar networks keep their legacy ids
// internally (a full rename is not worth the migration risk); new chains use
// CAIP-2 ids natively.
export const LEGACY_NETWORK_TO_CHAIN: Record<string, string> = {
  mainnet: 'stellar:pubnet',
  testnet: 'stellar:testnet',
}

export const BUILTIN_CHAINS: ChainEntry[] = [
  {
    id: 'stellar:pubnet',
    family: 'stellar',
    name: 'Stellar',
    isTestnet: false,
    enabled: true,
    explorer: {
      tx: 'https://stellar.expert/explorer/public/tx/{hash}',
      account: 'https://stellar.expert/explorer/public/account/{address}',
      token: 'https://stellar.expert/explorer/public/asset/{token}',
    },
    nativeCurrency: { symbol: 'XLM', decimals: 7 },
    stellar: {
      horizonUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
      passphrase: 'Public Global Stellar Network ; September 2015',
    },
  },
  {
    id: 'stellar:testnet',
    family: 'stellar',
    name: 'Stellar Testnet',
    isTestnet: true,
    enabled: true,
    explorer: {
      tx: 'https://stellar.expert/explorer/testnet/tx/{hash}',
      account: 'https://stellar.expert/explorer/testnet/account/{address}',
    },
    nativeCurrency: { symbol: 'XLM', decimals: 7 },
    stellar: {
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
      friendbotUrl: 'https://friendbot.stellar.org',
    },
  },
  {
    id: 'eip155:1',
    family: 'evm',
    name: 'Ethereum',
    isTestnet: false,
    enabled: true,
    explorer: {
      tx: 'https://etherscan.io/tx/{hash}',
      account: 'https://etherscan.io/address/{address}',
      token: 'https://etherscan.io/token/{token}',
    },
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    // RPC goes through the Cyphras privacy proxy so third-party providers
    // never see user IP + address pairs; upstreams are managed server-side.
    evm: { chainId: 1, rpcUrls: ['https://api.cyphras.com/evm/eip155:1/rpc'] },
  },
  {
    id: 'eip155:11155111',
    family: 'evm',
    name: 'Sepolia',
    isTestnet: true,
    enabled: true,
    explorer: {
      tx: 'https://sepolia.etherscan.io/tx/{hash}',
      account: 'https://sepolia.etherscan.io/address/{address}',
      token: 'https://sepolia.etherscan.io/token/{token}',
    },
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    evm: { chainId: 11155111, rpcUrls: ['https://api.cyphras.com/evm/eip155:11155111/rpc'] },
  },
]

export const BTC_MAINNET_CHAIN = 'bip122:000000000019d6689c085ae165831e93'
// Testnet4 (BIP94): the id is the first 32 hex chars of its genesis block hash.
export const BTC_TESTNET_CHAIN = 'bip122:00000000da84f2bafbbc53dee25a72ae'

BUILTIN_CHAINS.push(
  {
    id: BTC_MAINNET_CHAIN,
    family: 'bip122',
    name: 'Bitcoin',
    isTestnet: false,
    enabled: true,
    explorer: {
      tx: 'https://mempool.space/tx/{hash}',
      account: 'https://mempool.space/address/{address}',
    },
    nativeCurrency: { symbol: 'BTC', decimals: 8 },
  },
  {
    id: BTC_TESTNET_CHAIN,
    family: 'bip122',
    name: 'Bitcoin Testnet4',
    isTestnet: true,
    enabled: true,
    explorer: {
      tx: 'https://mempool.space/testnet4/tx/{hash}',
      account: 'https://mempool.space/testnet4/address/{address}',
    },
    nativeCurrency: { symbol: 'BTC', decimals: 8 },
  }
)

// Pinned rather than read from the registry, so a compromised registry cannot
// point balance, UTXO or broadcast traffic at a hostile server.
export function bitcoinApiUrl(chainId: string): string {
  return `https://api.cyphras.com/btc/${chainId}`
}

export function chainById(id: string): ChainEntry | undefined {
  return BUILTIN_CHAINS.find((c) => c.id === id)
}

// The wallet's mainnet/testnet environment selects which chains take part in
// the unified portfolio; custom Stellar networks have no EVM counterpart.
export function evmChainsForEnv(envId: string): ChainEntry[] {
  if (envId !== 'mainnet' && envId !== 'testnet') return []
  return BUILTIN_CHAINS.filter(
    (c) => c.family === 'evm' && c.enabled && c.isTestnet === (envId === 'testnet')
  )
}

export function explorerUrl(template: string, value: string): string {
  return template.replace('{hash}', value).replace('{address}', value).replace('{token}', value)
}
