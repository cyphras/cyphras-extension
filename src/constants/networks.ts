export interface NetworkConfig {
  id: string
  name: string
  horizonUrl: string
  sorobanRpcUrl: string
  passphrase: string
  friendbotUrl: string
  explorerUrl?: string // custom explorer base URL - if omitted, falls back to stellar.expert
  txTimeout: number // transaction timeout in seconds (default 90)
  isDefault: boolean
}

export const NETWORK_STORAGE_KEY = 'cyphras_networks'
export const ACTIVE_NETWORK_KEY = 'cyphras_active_network'

export const DEFAULT_NETWORKS: NetworkConfig[] = [
  {
    id: 'mainnet',
    name: 'Mainnet',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
    passphrase: 'Public Global Stellar Network ; September 2015',
    friendbotUrl: '',
    explorerUrl: 'https://stellar.expert/explorer/public',
    txTimeout: 90,
    isDefault: true,
  },
  {
    id: 'testnet',
    name: 'Testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015',
    friendbotUrl: 'https://friendbot.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    txTimeout: 90,
    isDefault: true,
  },
]
