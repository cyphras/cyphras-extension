// EVM sends broadcast by this wallet, kept until the indexer reports them: the indexer lags a
// block or more, and a reverted or stuck send would otherwise never surface in History.

export interface PendingEvmTx {
  chain: string // CAIP-2
  hash: string
  from: string
  to: string
  kind: 'native' | 'erc20'
  amount: string // display units
  code: string
  tokenAddress?: string
  feeCode: string
  submittedAt: number
  status: 'pending' | 'success' | 'failed'
  fee?: string // display units, known once mined
}

// Long enough for any indexer to catch up; a tx the chain never mined by
// then was dropped (replaced or evicted) and should stop showing as pending.
const KEEP_MS = 3 * 24 * 60 * 60 * 1000

function pendingKey(networkId: string, publicKey: string): string {
  return `cyphras_evm_pending_${networkId}_${publicKey}`
}

export async function getPendingEvmTxs(
  networkId: string,
  publicKey: string
): Promise<PendingEvmTx[]> {
  const key = pendingKey(networkId, publicKey)
  const stored = await chrome.storage.local.get(key)
  const list = stored[key]
  return Array.isArray(list) ? (list as PendingEvmTx[]) : []
}

async function savePendingEvmTxs(
  networkId: string,
  publicKey: string,
  list: PendingEvmTx[]
): Promise<void> {
  const now = Date.now()
  await chrome.storage.local.set({
    [pendingKey(networkId, publicKey)]: list.filter((t) => now - t.submittedAt < KEEP_MS),
  })
}

export async function recordPendingEvmTx(
  networkId: string,
  publicKey: string,
  tx: PendingEvmTx
): Promise<void> {
  const list = await getPendingEvmTxs(networkId, publicKey)
  await savePendingEvmTxs(networkId, publicKey, [tx, ...list.filter((t) => t.hash !== tx.hash)])
}

export async function updatePendingEvmTx(
  networkId: string,
  publicKey: string,
  hash: string,
  patch: Partial<PendingEvmTx>
): Promise<void> {
  const list = await getPendingEvmTxs(networkId, publicKey)
  await savePendingEvmTxs(
    networkId,
    publicKey,
    list.map((t) => (t.hash === hash ? { ...t, ...patch } : t))
  )
}

// The indexer now has these; its record (with the real block time) wins.
export async function dropIndexedEvmTxs(
  networkId: string,
  publicKey: string,
  indexed: Set<string>
): Promise<void> {
  const list = await getPendingEvmTxs(networkId, publicKey)
  const kept = list.filter((t) => !indexed.has(t.hash.toLowerCase()))
  if (kept.length !== list.length) await savePendingEvmTxs(networkId, publicKey, kept)
}

/** Null while the tx is not mined yet; feeWei is what was actually paid, not the quoted max. */
export async function fetchEvmReceipt(
  rpcUrl: string,
  hash: string
): Promise<{ status: 'success' | 'failed'; feeWei: bigint } | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [hash],
    }),
    signal: AbortSignal.timeout(10000),
  })
  const data = (await res.json()) as {
    result?: { status?: string; gasUsed?: string; effectiveGasPrice?: string } | null
  }
  const r = data.result
  if (!r || !r.status) return null
  const feeWei =
    r.gasUsed && r.effectiveGasPrice ? BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice) : 0n
  return { status: r.status === '0x1' ? 'success' : 'failed', feeWei }
}
