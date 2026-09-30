// Shielded pool config; JSON-safe so it survives chrome.storage, testnet only.
export interface ShieldedConfig {
  poolId: string // note-storage + UI key, distinct per pool
  label: string
  vaultId: string
  domain: string // proof domain separation, distinct per pool
  indexerUrl: string
  relayerUrl: string
  relayerAddress: string // tx source for relayed spends
  native: boolean // true = native XLM, false = classic asset (needs trustline)
  assetCode?: string
  assetIssuer?: string
  decimals: number
  maxDeposit: string // vault max_deposit cap, stroops
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
  // Trust anchor for pool validation; ships with the extension, never sourced from the relayer.
  privatePoolFactory?: string
  relayerUrl?: string
  // The token decides which asset a commit moves, so it ships here rather than from the relayer.
  // issuer (classic-wrapped SACs like USDC) lets the sender verify the recipient trustline; XLM omits it.
  privateAssets?: { asset: string; token: string; decimals: number; issuer?: string }[]
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
    privatePoolFactory: 'CBMBKXI7YNMJYLLHP7CVKMRWUMVPJ4MTVOEP3UKDMA7FIPTD3QLJQ227',
    relayerUrl: 'https://api.cyphras.com',
    privateAssets: [
      {
        asset: 'XLM',
        token: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
        decimals: 7,
      },
    ],
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
    privatePoolFactory: 'CD23YL7MCHT6IIGH3MUIG6Y7VY2EKF3KA2DONWULOXESE67AQEVE6GRR',
    relayerUrl: 'https://api.cyphras.com',
    privateAssets: [
      {
        asset: 'XLM',
        token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        decimals: 7,
      },
      {
        asset: 'USDC',
        token: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        decimals: 7,
        issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      },
    ],
    shielded: [
      {
        poolId: 'xlm',
        label: 'XLM',
        vaultId: 'CBXDPTG342GIJ5JMSXNLJGOPZ2KUO32NY6JD6352A3QTFI67BKXKANCM',
        domain: '67890',
        indexerUrl: 'https://private.cyphras.com/indexer',
        relayerUrl: 'https://private.cyphras.com/relayer',
        relayerAddress: 'GBERJHL7M6RYGJSPATGEJHNWIWVAXBCDVJPMTWN5KC7QQN7K6BVCS5KF',
        native: true,
        decimals: 7,
        maxDeposit: '1000000000',
      },
      {
        poolId: 'usdc',
        label: 'USDC',
        vaultId: 'CA4LFR3TYDARWQ3YHUD72X6ZKVXL3BJWA7ZLDVSMOHAVEOQXU7ESOBBQ',
        domain: '67891',
        indexerUrl: 'https://private.cyphras.com/usdc/indexer',
        relayerUrl: 'https://private.cyphras.com/usdc/relayer',
        relayerAddress: 'GASOF6NKJJWYE4AB2SFXK6RD26VBYGWNK2KL7TLZT2S3YRS3NRQWH4UQ',
        native: false,
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        decimals: 7,
        maxDeposit: '100000000000',
      },
    ],
  },
]
