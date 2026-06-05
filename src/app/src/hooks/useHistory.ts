import { useState, useEffect, useCallback, useRef } from 'react'
import { useNetwork } from '@/context/NetworkContext'

export interface Operation {
  id: string
  type: string
  created_at: string
  transaction_hash: string
  transaction_successful?: boolean
  source_account?: string

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
      isInitialLoad.current = false
      setState({ operations: data._embedded.records, loading: false, error: null })
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
