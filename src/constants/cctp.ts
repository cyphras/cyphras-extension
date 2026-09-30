// Circle CCTP V2 trust anchors, compiled in and never sourced from the registry or a backend,
// so a compromised backend cannot redirect a burn or mint.

export const CCTP_DOMAIN_ETHEREUM = 0
export const CCTP_DOMAIN_STELLAR = 27

export interface CctpStellarAnchors {
  tokenMessengerMinter: string
  messageTransmitter: string
  cctpForwarder: string
  usdcAsset: { code: string; issuer: string }
  usdcSac: string
}

export interface CctpEvmAnchors {
  chainId: number
  tokenMessengerV2: string
  messageTransmitterV2: string
  usdc: string
}

export interface CctpEnvAnchors {
  stellar: CctpStellarAnchors
  evm: CctpEvmAnchors
}

export const CCTP_MAINNET: CctpEnvAnchors = {
  stellar: {
    tokenMessengerMinter: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
    messageTransmitter: 'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
    cctpForwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    usdcAsset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
    // Asset.contractId(networkPassphrase) of usdcAsset, so it can be re-derived and checked.
    usdcSac: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  },
  evm: {
    chainId: 1,
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
}

export const CCTP_TESTNET: CctpEnvAnchors = {
  stellar: {
    tokenMessengerMinter: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
    messageTransmitter: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
    cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    usdcAsset: { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
    usdcSac: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  },
  evm: {
    chainId: 11155111,
    tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
}

// envId is the wallet's Stellar network id; a custom network has no CCTP anchors.
export function cctpAnchorsForEnv(envId: string): CctpEnvAnchors | null {
  if (envId === 'mainnet') return CCTP_MAINNET
  if (envId === 'testnet') return CCTP_TESTNET
  return null
}

// Cyphras backend proxy in front of Circle's Iris API (fees and attestations).
export function cctpProxyBase(envId: 'mainnet' | 'testnet'): string {
  return `https://api.cyphras.com/cctp/${envId}`
}

// Built from the pinned chainId, never getRegistryChains(), so a compromised or misconfigured
// registry cannot redirect a CCTP transaction's gas quotes or broadcast.
export function cctpEvmRpcUrl(anchors: CctpEnvAnchors): string {
  return `https://api.cyphras.com/evm/eip155:${anchors.evm.chainId}/rpc`
}

// Client-side cap on a quoted burn/mint fee, on top of the `amount > maxFee` check, so a
// compromised or buggy backend cannot quote an inflated fee.
export const CCTP_MAX_FEE_BPS_CEILING = 100n // 1%

// CCTP protocol values: Standard waits for source-chain hard finality (free), Fast accepts an
// earlier allowance-backed confirmation for a fee. Fast to Stellar is not explicitly documented.
export const CCTP_FINALITY_STANDARD = 2000
export const CCTP_FINALITY_FAST = 1000
export type CctpSpeed = 'standard' | 'fast'

// Caps for the unattended background mint signer: receiveMessage has a bounded cost, so these
// limit the ETH a compromised or broken gas quote source can burn.
export const CCTP_MINT_GAS_LIMIT_CEILING = 300_000n
export const CCTP_MINT_MAX_FEE_PER_GAS_CEILING = 200_000_000_000n // 200 gwei
export const CCTP_MINT_MAX_PRIORITY_FEE_PER_GAS_CEILING = 10_000_000_000n // 10 gwei
