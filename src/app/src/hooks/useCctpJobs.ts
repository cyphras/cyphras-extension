import { useCallback, useEffect, useState } from 'react'
import { SERVICE_TYPES } from '@constants/services'
import type { CctpJobInfo, CctpFeeBreakdown } from '@ext-types/index'

export type CctpDirection = 'stellar-to-evm' | 'evm-to-stellar'
export type CctpSpeed = 'standard' | 'fast'

function sendMessage<T extends object>(
  payload: Record<string, unknown>
): Promise<T & { error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (r) => {
      if (chrome.runtime.lastError || !r)
        resolve({ error: 'Extension error' } as T & { error?: string })
      else resolve(r as T & { error?: string })
    })
  })
}

export async function quoteCctp(
  direction: CctpDirection,
  amount: string,
  speed: CctpSpeed = 'standard',
  publicKey?: string
): Promise<{ maxFee?: string; breakdown?: CctpFeeBreakdown; error?: string }> {
  return sendMessage({ type: SERVICE_TYPES.CCTP_QUOTE, direction, amount, speed, publicKey })
}

export async function startCctp(
  publicKey: string,
  direction: CctpDirection,
  amount: string,
  speed: CctpSpeed = 'standard'
): Promise<{ jobId?: string; error?: string }> {
  return sendMessage({ type: SERVICE_TYPES.CCTP_START, publicKey, direction, amount, speed })
}

const NON_TERMINAL: CctpJobInfo['status'][] = [
  'created',
  'approving',
  'burn_submitted',
  'burned',
  'attested',
  'mint_submitted',
  'blocked_trustline',
  'blocked_gas',
]

// While a job is in flight, nudge the background processor and re-poll every 4s: its alarm
// only fires once a minute. storage.onChanged picks up job writes between polls.
export function useCctpJobs(publicKey: string) {
  const [jobs, setJobs] = useState<CctpJobInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setJobs([])
      setLoading(false)
      return
    }
    const res = await sendMessage<{ jobs?: CctpJobInfo[] }>({
      type: SERVICE_TYPES.CCTP_LIST_JOBS,
      publicKey,
    })
    setJobs(res.jobs ?? [])
    setLoading(false)
  }, [publicKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if (Object.keys(changes).some((k) => k.startsWith('cyphras_cctp_jobs_'))) void refresh()
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [refresh])

  const hasInFlight = jobs.some((j) => NON_TERMINAL.includes(j.status))
  useEffect(() => {
    if (!hasInFlight) return
    const id = setInterval(() => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.CCTP_PROCESS },
        () => void chrome.runtime.lastError
      )
      void refresh()
    }, 4000)
    return () => clearInterval(id)
  }, [hasInFlight, refresh])

  return { jobs, loading, refresh, hasInFlight }
}
