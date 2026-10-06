// A shielded pool as the UI shows it; JSON-safe so it survives chrome.storage. The vault, its
// services and the circuit pins live with the deployment the background opens it from.
export interface ShieldedConfig {
  poolId: string // UI key, distinct per pool
  deployment: string // private payments deployment name, e.g. 'testnet/xlm'
  label: string
  native: boolean
  assetCode?: string
  assetIssuer?: string
  decimals: number
}

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
  // Shielded (private-mode) pools. Testnet only; absent on mainnet so the gate refuses to prove.
  shielded?: ShieldedConfig[]
}

export const NETWORK_STORAGE_KEY = 'cyphras_networks'
export const ACTIVE_NETWORK_KEY = 'cyphras_active_network'

// Live testnet passphrase; the shielded gate refuses any network not on it.
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'

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
    passphrase: TESTNET_PASSPHRASE,
    friendbotUrl: 'https://friendbot.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    txTimeout: 90,
    isDefault: true,
    shielded: [
      {
        poolId: 'xlm',
        deployment: 'testnet/xlm',
        label: 'XLM',
        native: true,
        decimals: 7,
      },
    ],
  },
]
