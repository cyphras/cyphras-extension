import { useState, useEffect, useCallback, useRef } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import type { PhaseInfo } from '@/lib/phase'
import type { PrivateNote } from '@ext-types/index'

// SAC transfers Horizon reports on invoke_host_function ops; used to recognise a private receive
// (a pool contract crediting this account).
export interface AssetBalanceChange {
  type: string
  from?: string
  to?: string
  amount?: string
  asset_type?: string
  asset_code?: string
  asset_issuer?: string
}

// Fallback credit from the effects stream for invoke ops where Horizon omits asset_balance_changes.
// The effect does not reveal the source contract, so it is only trusted when the in-band list is missing.
export interface CreditedEffect {
  amount: string
  asset_type?: string
  asset_code?: string
}

// Attached by the private-payment enrichment, not by Horizon. Marks an op (or a synthetic grouped
// sender row) as a Cyphras private payment so the history renders it as a real send/receive.
export interface CyphrasPrivate {
  direction: 'in' | 'out'
  amount: string // display units; what actually left the wallet (intended minus splits that never deposited)
  // What the chain confirms actually left the wallet, and what reached the recipient. Shown against
  // amount so the row never claims more was sent than the chain verifies.
  committedAmount?: string
  deliveredAmount?: string
  // Raw splits of this send, for the live delivery bar that time-interpolates scheduled splits.
  notes?: PrivateNote[]
  asset: string
  recipient?: string
  splits?: number
  phase?: PhaseInfo // drives the colored label, icon, and ETA in the UI
  splitsDetail?: { amount: string; status: string; scheduledFor?: string; revealTxHash?: string }[]
  failedCounters?: number[] // failed splits WITH a leaf on-chain (in the pool), for recover/deliver-again
  unsentCounters?: number[] // failed splits with no leaf: never deposited, funds still in the wallet
  reclaimableCounters?: number[] // committed (leaf on-chain) splits past the stuck window, for self-reclaim
  retryableCounters?: number[] // splits whose deposit never landed (no leaf); re-committed automatically
}

export interface Operation {
  id: string
  type: string
  created_at: string
  transaction_hash: string
  transaction_successful?: boolean
  source_account?: string
  asset_balance_changes?: AssetBalanceChange[]
  credited_effect?: CreditedEffect
  cyphras_private?: CyphrasPrivate

  // payment
  from?: string
  to?: string
  amount?: string
  asset_code?: string
  asset_issuer?: string
  asset_type?: string

  // create_account
  funder?: string
  account?: string
  starting_balance?: string

  // change_trust
  trustor?: string
  trustee?: string
  limit?: string

  // path_payment
  source_amount?: string
  source_asset_code?: string
  source_asset_issuer?: string
  source_asset_type?: string
  destination_min?: string

  // manage offer
  price?: string
  offer_id?: string
  buying_asset_code?: string
  buying_asset_issuer?: string
  buying_asset_type?: string
  selling_asset_code?: string
  selling_asset_issuer?: string
  selling_asset_type?: string

  // account_merge
  into?: string

  // invoke_host_function
  function?: string

  // claim_claimable_balance
  balance_id?: string
  claimant?: string

  // create_claimable_balance - asset is a compound string: "native" | "CODE:ISSUER"
  asset?: string

  // set_options / manage_data
  name?: string
}

export interface HistoryState {
  operations: Operation[]
  loading: boolean
  error: string | null
}

interface EffectRecord {
  type: string
  amount?: string
  asset_type?: string
  asset_code?: string
  _links?: { operation?: { href?: string } }
}

// Maps op id -> credit so an invoke op with no asset_balance_changes can still be shown as a receive.
// The op id is the trailing path segment of the effect's operation href. A failed fetch returns empty.
async function fetchCreditedEffects(
  horizonUrl: string,
  publicKey: string
): Promise<Map<string, CreditedEffect>> {
  const out = new Map<string, CreditedEffect>()
  try {
    const res = await fetch(`${horizonUrl}/accounts/${publicKey}/effects?order=desc&limit=100`)
    if (!res.ok) return out
    const body = (await res.json()) as { _embedded: { records: EffectRecord[] } }
    for (const e of body._embedded.records) {
      if (e.type !== 'account_credited') continue
      const href = e._links?.operation?.href
      if (!href) continue
      const opId = href.slice(href.lastIndexOf('/') + 1)
      if (!opId) continue
      out.set(opId, {
        amount: e.amount ?? '0',
        asset_type: e.asset_type,
        asset_code: e.asset_code,
      })
    }
  } catch {
    return out
  }
  return out
}

export function useHistory(publicKey: string | undefined): HistoryState & { refresh: () => void } {
  const { activeNetwork } = useNetwork()
  const [state, setState] = useState<HistoryState>({
    operations: [],
    loading: true,
    error: null,
  })
  const isInitialLoad = useRef(true)

  const fetchHistory = useCallback(async () => {
    if (!publicKey) {
      setState((prev) => ({ ...prev, loading: false }))
      return
    }

    if (!isInitialLoad.current) {
      setState((prev) => ({ ...prev, error: null }))
    } else {
      setState((prev) => ({ ...prev, loading: true, error: null }))
    }

    try {
      const res = await fetch(
        `${activeNetwork.horizonUrl}/accounts/${publicKey}/operations?order=desc&limit=100&include_failed=false`
      )

      if (res.status === 404) {
        isInitialLoad.current = false
        setState({ operations: [], loading: false, error: null })
        return
      }

      if (!res.ok) throw new Error(`Horizon error: ${res.status}`)

      const data = (await res.json()) as { _embedded: { records: Operation[] } }
      const records = data._embedded.records
      const creditedByOpId = await fetchCreditedEffects(activeNetwork.horizonUrl, publicKey)
      for (const op of records) {
        const credit = creditedByOpId.get(op.id)
        if (credit) op.credited_effect = credit
      }
      isInitialLoad.current = false
      setState({ operations: records, loading: false, error: null })
    } catch {
      isInitialLoad.current = false
      setState((prev) => ({ ...prev, loading: false, error: 'Failed to fetch history' }))
    }
  }, [publicKey, activeNetwork.horizonUrl])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return { ...state, refresh: fetchHistory }
}
