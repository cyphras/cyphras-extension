// Single home for the Cyphras backend origin. Endpoints point at the
// versioned paths directly so calls never depend on the server's
// legacy-path redirects.
export const CYPHRAS_API = 'https://api.cyphras.com'
export const ASSETS_API = 'https://assets.cyphras.com'

// The v2 address-based API is live on production. Rolling back to v1 is a
// this-file-only change: set PRICES_VERSION to 'v1'; callers key results the
// same way in both modes. The /dev sandbox instance remains available by
// pointing PRICES_BASE at `${CYPHRAS_API}/dev`.
const PRICES_BASE = CYPHRAS_API
export const PRICES_VERSION: 'v1' | 'v2' = 'v2'

export const API_ENDPOINTS = {
  prices: `${PRICES_BASE}/${PRICES_VERSION}/prices`,
  analyticsEvent: `${CYPHRAS_API}/v1/analytics/event`,
} as const

// EVM privacy proxy: `${EVM_PROXY_BASE}/{caip2}/rpc` for JSON-RPC and
// `${EVM_PROXY_BASE}/{caip2}/activity` for indexed account history.
export const EVM_PROXY_BASE = `${CYPHRAS_API}/evm`

// Brand/UI images on the assets service. URLs are content-hashed, so a replaced asset gets a new
// URL here, which busts every cache down the line.
export const UI_ASSETS = {
  verifiedBadge: `${ASSETS_API}/i/badge-verified-fffd6059dd96.svg`,
} as const
