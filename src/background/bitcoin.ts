import { hex } from '@scure/base'
import { Address, OutScript, Transaction, selectUTXO } from '@scure/btc-signer'
import type { ChainActivity } from '@ext-types/index'
import { bitcoinNetwork } from './signers/bitcoin'

// Signals replaceability (BIP125), so a send stuck on a low fee can be bumped later.
const RBF_SEQUENCE = 0xfffffffd
// Dust limit of the most restrictive standard output (P2PKH); anything smaller will not relay.
export const BTC_MIN_SEND_SATS = 546n
// Far above any real market rate; a quote beyond it is a bug or a hostile upstream.
export const BTC_MAX_FEE_RATE = 1000
// Recipient output types a wallet can spend from; anything else (bare anchors, unknown
// witness versions) is refused because the coins could be taken by anyone or no one.
const SPENDABLE_OUTPUT_TYPES = new Set(['pkh', 'sh', 'wpkh', 'wsh', 'tr'])

export interface BtcUtxo {
  txid: string
  vout: number
  value: number
  status: { confirmed: boolean }
}

export interface BtcFeeRates {
  slow: number
  normal: number
  fast: number
}

export interface BtcPayment {
  tx: Transaction
  feeSats: bigint
  sendSats: bigint
  vsize: number
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Bitcoin network request failed (${res.status})`)
  return (await res.json()) as T
}

export function fetchBtcUtxos(apiUrl: string, address: string): Promise<BtcUtxo[]> {
  return getJson<BtcUtxo[]>(`${apiUrl}/address/${address}/utxo`)
}

export async function fetchBtcFeeRates(apiUrl: string): Promise<BtcFeeRates> {
  const r = await getJson<{ fastestFee: number; halfHourFee: number; hourFee: number }>(
    `${apiUrl}/fees`
  )
  const rates = [r.hourFee, r.halfHourFee, r.fastestFee]
  if (!rates.every((v) => Number.isFinite(v) && v > 0)) throw new Error('Fee data unavailable')
  // Sorted, so a scrambled response can never make "slow" the expensive tier.
  const [slow, normal, fast] = rates
    .map((v) => Math.min(Math.ceil(v), BTC_MAX_FEE_RATE))
    .sort((a, b) => a - b)
  return { slow, normal, fast }
}

/**
 * Checks each input's claimed amount and script against its source transaction, whose
 * hash the txid commits to. A segwit v0 signature commits only to its own input's amount,
 * so an upstream lying about amounts across two attempts could otherwise combine the
 * signatures into one valid transaction that pays the difference as fee.
 */
export async function verifyBtcInputs(apiUrl: string, tx: Transaction): Promise<void> {
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i)
    if (!input.txid || input.index === undefined || !input.witnessUtxo) {
      throw new Error('Malformed input')
    }
    const txid = hex.encode(input.txid)
    const res = await fetch(`${apiUrl}/tx/${txid}/hex`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`Could not verify an input (${res.status})`)
    const source = Transaction.fromRaw(hex.decode((await res.text()).trim()), {
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    })
    const out = source.id === txid ? source.getOutput(input.index) : undefined
    if (
      !out?.script ||
      out.amount !== input.witnessUtxo.amount ||
      !bytesEqual(out.script, input.witnessUtxo.script)
    ) {
      throw new Error('The Bitcoin network data did not check out. Nothing was sent.')
    }
  }
}

export async function broadcastBtcTx(apiUrl: string, rawHex: string): Promise<string> {
  const res = await fetch(`${apiUrl}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: rawHex,
    signal: AbortSignal.timeout(30000),
  })
  const text = (await res.text()).trim()
  if (!res.ok) throw new Error(text || `Broadcast failed (${res.status})`)
  return text
}

export function spendableSats(utxos: BtcUtxo[]): { confirmed: bigint; pending: bigint } {
  let confirmed = 0n
  let pending = 0n
  for (const u of utxos) {
    if (u.status.confirmed) confirmed += BigInt(u.value)
    else pending += BigInt(u.value)
  }
  return { confirmed, pending }
}

/**
 * Builds an unsigned P2WPKH payment from the wallet's confirmed UTXOs. `amount: 'max'`
 * sweeps them all to the recipient minus the fee; otherwise change returns to `from`.
 * Throws on a wrong-network or malformed recipient, dust, or insufficient funds.
 */
export function buildBtcPayment(params: {
  utxos: BtcUtxo[]
  from: string
  to: string
  amount: bigint | 'max'
  feeRate: number
  testnet: boolean
  // Outpoints ("txid:vout") of sends this wallet already broadcast, still listed by a lagging upstream.
  exclude?: Set<string>
}): BtcPayment {
  const { utxos, from, to, amount, feeRate, testnet, exclude } = params
  const network = bitcoinNetwork(testnet)
  if (!Number.isInteger(feeRate) || feeRate < 1 || feeRate > BTC_MAX_FEE_RATE) {
    throw new Error('Invalid fee rate')
  }
  let recipientScript: Uint8Array
  try {
    const decoded = Address(network).decode(to)
    if (!SPENDABLE_OUTPUT_TYPES.has(decoded.type)) throw new Error('unsupported output type')
    recipientScript = OutScript.encode(decoded)
  } catch {
    throw new Error(`Not a valid ${testnet ? 'testnet ' : ''}Bitcoin address`)
  }
  const ownScript = OutScript.encode(Address(network).decode(from))
  if (bytesEqual(recipientScript, ownScript)) throw new Error('This is your own Bitcoin address')

  // Unconfirmed coins from others can still be replaced or dropped, so only confirmed ones are spent.
  const inputs = utxos
    .filter((u) => u.status.confirmed && !exclude?.has(`${u.txid}:${u.vout}`))
    .map((u) => ({
      txid: hex.decode(u.txid),
      index: u.vout,
      witnessUtxo: { script: ownScript, amount: BigInt(u.value) },
      sequence: RBF_SEQUENCE,
    }))
  if (inputs.length === 0) throw new Error('No confirmed BTC to spend yet')

  const opts = { feePerByte: BigInt(feeRate), network, createTx: true, bip69: true }
  const selected =
    amount === 'max'
      ? selectUTXO(inputs, [], 'all', { ...opts, changeAddress: to })
      : selectUTXO(inputs, [{ address: to, amount }], 'default', { ...opts, changeAddress: from })
  if (!selected?.tx || selected.fee === undefined) {
    throw new Error('Not enough confirmed BTC for this amount and the network fee')
  }

  // Every output must be the recipient or our own change, and value must balance exactly.
  const inputSum = selected.inputs.reduce((sum, i) => sum + (i.witnessUtxo?.amount ?? 0n), 0n)
  let sendSats = 0n
  let outputSum = 0n
  for (let i = 0; i < selected.tx.outputsLength; i++) {
    const out = selected.tx.getOutput(i)
    if (!out.script || out.amount === undefined) throw new Error('Malformed output')
    outputSum += out.amount
    if (bytesEqual(out.script, recipientScript)) sendSats += out.amount
    else if (!bytesEqual(out.script, ownScript)) throw new Error('Unexpected output script')
  }
  if (outputSum + selected.fee !== inputSum) throw new Error('Inputs and outputs do not balance')
  if (amount !== 'max' && sendSats !== amount) throw new Error('Recipient amount mismatch')
  if (sendSats < BTC_MIN_SEND_SATS) throw new Error('Amount is below the Bitcoin dust limit')

  return {
    tx: selected.tx,
    feeSats: selected.fee,
    sendSats,
    vsize: Math.ceil(selected.weight / 4),
  }
}

export interface EsploraTx {
  txid: string
  fee: number
  status: { confirmed: boolean; block_time?: number }
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]
  vout: { scriptpubkey_address?: string; value: number }[]
}

function satsToBtc(sats: bigint): string {
  const whole = sats / 100_000_000n
  const frac = (sats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

/**
 * One address's view of a transaction: spent when any input was ours, and the amount
 * is what left to others (sent) or what arrived (received). Mempool txs have no block
 * time, so they sort as now.
 */
export function btcActivityOf(tx: EsploraTx, address: string, chain: string): ChainActivity {
  let ownIn = 0n
  let ownOut = 0n
  for (const i of tx.vin) {
    if (i.prevout?.scriptpubkey_address === address) ownIn += BigInt(i.prevout.value)
  }
  for (const o of tx.vout) if (o.scriptpubkey_address === address) ownOut += BigInt(o.value)
  const sent = ownIn > 0n
  const fee = BigInt(tx.fee)
  const amount = sent ? ownIn - ownOut - fee : ownOut
  const self = sent && amount <= 0n
  const other = sent
    ? tx.vout.find((o) => o.scriptpubkey_address && o.scriptpubkey_address !== address)
        ?.scriptpubkey_address
    : tx.vin.find(
        (i) => i.prevout?.scriptpubkey_address && i.prevout.scriptpubkey_address !== address
      )?.prevout?.scriptpubkey_address
  return {
    chain,
    hash: tx.txid,
    timestamp: new Date((tx.status.block_time ?? Date.now() / 1000) * 1000).toISOString(),
    from: sent ? address : (other ?? ''),
    to: sent ? (other ?? address) : address,
    direction: self ? 'self' : sent ? 'out' : 'in',
    status: tx.status.confirmed ? 'success' : 'pending',
    kind: 'native',
    amount: satsToBtc(self ? 0n : amount),
    code: 'BTC',
    fee: satsToBtc(fee),
    feeCode: 'BTC',
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// Outpoints of sends this wallet broadcast, kept until the upstream has surely caught up.
// Building from them again would double-spend our own pending payment (and, with RBF,
// silently replace it).
const SPENT_KEEP_MS = 24 * 60 * 60 * 1000

interface SpentRecord {
  txid: string
  outpoints: string[]
  at: number
}

function spentKey(networkId: string, publicKey: string): string {
  return `cyphras_btc_spent_${networkId}_${publicKey}`
}

async function readSpent(networkId: string, publicKey: string): Promise<SpentRecord[]> {
  const key = spentKey(networkId, publicKey)
  const list = (await chrome.storage.local.get(key))[key]
  const now = Date.now()
  return Array.isArray(list)
    ? (list as SpentRecord[]).filter((r) => now - r.at < SPENT_KEEP_MS)
    : []
}

export async function getSpentOutpoints(
  networkId: string,
  publicKey: string
): Promise<Set<string>> {
  return new Set((await readSpent(networkId, publicKey)).flatMap((r) => r.outpoints))
}

export async function recordSpent(
  networkId: string,
  publicKey: string,
  txid: string,
  outpoints: string[]
): Promise<void> {
  const list = await readSpent(networkId, publicKey)
  await chrome.storage.local.set({
    [spentKey(networkId, publicKey)]: [...list, { txid, outpoints, at: Date.now() }],
  })
}

export async function forgetSpent(
  networkId: string,
  publicKey: string,
  txid: string
): Promise<void> {
  const list = await readSpent(networkId, publicKey)
  await chrome.storage.local.set({
    [spentKey(networkId, publicKey)]: list.filter((r) => r.txid !== txid),
  })
}

export function outpointsOf(tx: Transaction): string[] {
  return Array.from({ length: tx.inputsLength }, (_, i) => {
    const input = tx.getInput(i)
    return `${hex.encode(input.txid!)}:${input.index}`
  })
}

// true when the upstream knows the tx, false when it definitely does not, and throws when
// it cannot say (network error), so a caller never mistakes "unknown" for "not sent".
export async function btcTxKnown(apiUrl: string, txid: string): Promise<boolean> {
  const res = await fetch(`${apiUrl}/tx/${txid}/status`, { signal: AbortSignal.timeout(30000) })
  if (res.ok) return true
  if (res.status === 400 || res.status === 404) return false
  throw new Error(`Status check failed (${res.status})`)
}
