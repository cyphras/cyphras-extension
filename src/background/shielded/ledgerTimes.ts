// Close times of ledgers, from the network's Horizon, kept in storage since they never change. Only
// the ledgers at the edges of 4096-ledger windows, about six hours apart, are asked for, and a
// ledger's time is interpolated between them: the server learns which windows the wallet looks at,
// not which ledgers hold its payments.
const WINDOW = 4096

const storeKey = (networkId: string) => `cyphras_shielded_ledger_times_${networkId}`

interface HorizonLedger {
  sequence: number
  closed_at: string
}

async function fetchLedger(url: string): Promise<HorizonLedger | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const body = (await res.json()) as HorizonLedger & {
      _embedded?: { records?: HorizonLedger[] }
    }
    return body._embedded ? body._embedded.records?.[0] : body
  } catch {
    return undefined
  }
}

// Unix milliseconds for each ledger whose window the network can date; a ledger it cannot is left
// out, and its payment shows without a time.
export async function ledgerTimes(
  horizonUrl: string,
  networkId: string,
  ledgers: readonly number[]
): Promise<Map<number, number>> {
  const times = new Map<number, number>()
  if (ledgers.length === 0) return times
  const key = storeKey(networkId)
  const anchors = ((await chrome.storage.local.get(key))[key] ?? {}) as Record<string, number>
  const anchor = async (ledger: number): Promise<number | undefined> => {
    if (anchors[ledger] !== undefined) return anchors[ledger]
    const found = await fetchLedger(`${horizonUrl}/ledgers/${ledger}`)
    const time = found ? Date.parse(found.closed_at) : NaN
    if (!Number.isFinite(time)) return undefined
    anchors[ledger] = time
    return time
  }
  // A window that has not closed yet ends at the network's latest ledger.
  let head: HorizonLedger | undefined
  for (const ledger of new Set(ledgers)) {
    const start = Math.floor(ledger / WINDOW) * WINDOW
    const lo = Math.max(1, start)
    const loTime = await anchor(lo)
    head ??= await fetchLedger(`${horizonUrl}/ledgers?order=desc&limit=1`)
    let hi: { ledger: number; time: number } | undefined
    if (head && head.sequence < start + WINDOW) {
      hi = { ledger: head.sequence, time: Date.parse(head.closed_at) }
    } else {
      const time = await anchor(start + WINDOW)
      if (time !== undefined) hi = { ledger: start + WINDOW, time }
    }
    if (loTime === undefined || !hi) continue
    times.set(
      ledger,
      hi.ledger <= lo
        ? loTime
        : Math.round(loTime + ((hi.time - loTime) * (ledger - lo)) / (hi.ledger - lo))
    )
  }
  await chrome.storage.local.set({ [key]: anchors })
  return times
}
