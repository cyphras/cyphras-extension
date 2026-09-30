// Network-wide constants shared by every pool.
export const RPC_URL = 'https://soroban-testnet.stellar.org'
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const FRIENDBOT = 'https://friendbot.stellar.org'
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
// Offline fallback; wallet fetches live GET /quote per pool.
export const FEE = 360000n

// One vault bound to one Stellar asset. Wallet can hold several pools; the
// private receiving address is the same across pools (it is the account keys),
// notes are tracked per pool.
export interface Pool {
  id: string // note-storage + UI key
  label: string
  vaultId: string // Soroban vault contract
  domain: bigint // proof domain separation, distinct per pool
  indexerUrl: string
  relayerUrl: string
  relayerAddress: string // tx source for relayed spends
  native: boolean // true = native XLM, false = classic asset (needs trustline)
  assetCode?: string
  assetIssuer?: string
  decimals: number // Stellar assets use 7
  maxDeposit: bigint // vault max_deposit cap
  swapMinRatePpm?: bigint // slippage floor (asset per XLM, x1e6)
}

// Offchain host for the per-pool indexer and relayer endpoints.
const BASE = 'https://private.cyphras.com'

export const POOLS: Pool[] = [
  {
    id: 'xlm',
    label: 'XLM',
    vaultId: 'CBXDPTG342GIJ5JMSXNLJGOPZ2KUO32NY6JD6352A3QTFI67BKXKANCM',
    domain: 67890n,
    indexerUrl: `${BASE}/indexer`,
    relayerUrl: `${BASE}/relayer`,
    relayerAddress: 'GBERJHL7M6RYGJSPATGEJHNWIWVAXBCDVJPMTWN5KC7QQN7K6BVCS5KF',
    native: true,
    decimals: 7,
    maxDeposit: 1_000_000_000n,
  },
  {
    id: 'usdc',
    label: 'USDC',
    vaultId: 'CA4LFR3TYDARWQ3YHUD72X6ZKVXL3BJWA7ZLDVSMOHAVEOQXU7ESOBBQ',
    domain: 67891n,
    indexerUrl: `${BASE}/usdc/indexer`,
    relayerUrl: `${BASE}/usdc/relayer`,
    relayerAddress: 'GASOF6NKJJWYE4AB2SFXK6RD26VBYGWNK2KL7TLZT2S3YRS3NRQWH4UQ',
    native: false,
    assetCode: 'USDC',
    assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    decimals: 7,
    maxDeposit: 100_000_000_000n,
  },
]

export const poolById = (id: string): Pool => POOLS.find((p) => p.id === id) ?? POOLS[0]

// bigint fields as strings so the pool survives JSON chrome.runtime messaging
export interface SerializedPool extends Omit<Pool, 'domain' | 'maxDeposit' | 'swapMinRatePpm'> {
  domain: string
  maxDeposit: string
  swapMinRatePpm?: string
}

export function serializePool(pool: Pool): SerializedPool {
  return {
    ...pool,
    domain: pool.domain.toString(),
    maxDeposit: pool.maxDeposit.toString(),
    swapMinRatePpm: pool.swapMinRatePpm?.toString(),
  }
}

export function deserializePool(s: SerializedPool): Pool {
  return {
    ...s,
    domain: BigInt(s.domain),
    maxDeposit: BigInt(s.maxDeposit),
    swapMinRatePpm: s.swapMinRatePpm !== undefined ? BigInt(s.swapMinRatePpm) : undefined,
  }
}
