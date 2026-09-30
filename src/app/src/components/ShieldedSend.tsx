import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Send as SendIcon,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddTrustlineSheet, type PendingAsset } from '@/components/AddTrustlineSheet'
import { Cy1Avatar } from '@/components/Cy1Avatar'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse } from '@ext-types/index'

export type ShieldedAction = 'send' | 'shield' | 'unshield'

interface ShieldedSendProps {
  action: ShieldedAction | null
  shieldedBalance: string | null
  // Sum of the two largest unspent notes; amount over (maxSpendable - fee) auto-splits into 2-note chunks.
  maxSpendable?: string | null
  // Unspent note count; full balance moves in ceil(noteCount/2) relayed chunks. null when unknown.
  noteCount?: string | null
  poolId: string
  assetLabel: string
  decimals: number
  assetCode?: string
  assetIssuer?: string
  assetIcon?: string
  native?: boolean
  publicBalance?: string | null
  subentryCount?: number
  hasTrustline: boolean
  horizonUrl: string
  networkPassphrase: string
  onTrustlineAdded: () => void
  onChangeAsset?: () => void
  onClose: () => void
  onDone: () => void
}

const TITLES: Record<ShieldedAction, string> = {
  send: 'Private send',
  shield: 'Shield',
  unshield: 'Unshield',
}

// In-progress button labels per action.
const BUSY: Record<ShieldedAction, string> = {
  send: 'Sending...',
  shield: 'Shielding...',
  unshield: 'Unshielding...',
}

const ACTION_ICONS: Record<ShieldedAction, typeof SendIcon> = {
  send: SendIcon,
  shield: ArrowDownToLine,
  unshield: ArrowUpFromLine,
}

// Fee reserve kept back on a native Shield max/fraction: a shield is a Soroban call that
// verifies a ZK proof, far pricier than a classic payment, so 1 XLM keeps Max from
// failing at submit. Whatever the fee does not use stays in the account.
const SHIELD_FEE_HEADROOM_STROOPS = 10_000_000n

// Sentinel doneHash for an auto-split spend, which has no single tx hash to show.
const SPLIT_DONE = 'split-done'

function XlmIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="76 34 238 238"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <circle cx="195.1" cy="153.1" r="118.9" fill="black" />
      <path
        fill="white"
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}

function AssetIcon({ icon, code, size = 22 }: { icon?: string; code: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (code === 'XLM') {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full overflow-hidden bg-black shrink-0 flex items-center justify-center"
      >
        <XlmIcon size={size} />
      </div>
    )
  }
  if (icon && !err) {
    return (
      <img
        src={icon}
        alt={code}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-muted shrink-0 flex items-center justify-center"
    >
      <span className="text-xs font-bold text-muted-foreground">{code.slice(0, 2)}</span>
    </div>
  )
}

function toStroops(amount: string, decimals: number): bigint | null {
  if (!/^\d*\.?\d*$/.test(amount) || amount === '' || amount === '.') return null
  const [whole, frac = ''] = amount.split('.')
  if (frac.length > decimals) return null
  const padded = frac.padEnd(decimals, '0')
  try {
    const v = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
    return v > 0n ? v : null
  } catch {
    return null
  }
}

function fromStroops(stroops: string, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const v = BigInt(stroops)
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${v / base}.${frac}` : (v / base).toString()
}

// Decimal string -> stroops for a display balance; accepts zero and returns 0n when unparseable.
function decimalToStroops(amount: string, decimals: number): bigint {
  if (!/^\d*\.?\d*$/.test(amount) || amount === '' || amount === '.') return 0n
  const [whole, frac = ''] = amount.split('.')
  try {
    return (
      BigInt(whole || '0') * 10n ** BigInt(decimals) +
      BigInt(frac.slice(0, decimals).padEnd(decimals, '0') || '0')
    )
  } catch {
    return 0n
  }
}

export default function ShieldedSend({
  action,
  shieldedBalance,
  maxSpendable = null,
  noteCount = null,
  poolId,
  assetLabel,
  decimals,
  assetCode,
  assetIssuer,
  assetIcon,
  native = false,
  publicBalance = null,
  subentryCount = 0,
  hasTrustline,
  horizonUrl,
  networkPassphrase,
  onTrustlineAdded,
  onChangeAsset,
  onClose,
  onDone,
}: ShieldedSendProps) {
  const subtitles: Record<ShieldedAction, string> = {
    send: `Send shielded ${assetLabel} to a private address`,
    shield: `Move public ${assetLabel} into your private balance`,
    unshield: `Move private ${assetLabel} back to your public balance`,
  }

  const [recipient, setRecipient] = useState('')
  const [recipientFocused, setRecipientFocused] = useState(false)
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneHash, setDoneHash] = useState<string | null>(null)
  // Cumulative stroops delivered across auto-split chunks for the "X/Y" progress; null on single-tx spends.
  const [sentProgress, setSentProgress] = useState<string | null>(null)
  const [trustlineSheetOpen, setTrustlineSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Keep the last non-null action so content stays visible during the close slide.
  const lastActionRef = useRef<ShieldedAction | null>(null)
  if (action) lastActionRef.current = action
  const a = action ?? lastActionRef.current
  const open = action !== null

  useEffect(() => {
    if (!open) return
    setRecipient('')
    setRecipientFocused(false)
    setAmount('')
    setError(null)
    setDoneHash(null)
    setSubmitting(false)
    setSentProgress(null)
    setTrustlineSheetOpen(false)
  }, [open, action])

  // The relayer fee applies to relayed spends (send + unshield); a shield is self-signed and free.
  useEffect(() => {
    if (!open || a === 'shield') {
      setFee(null)
      return
    }
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_QUOTE, poolId },
      (r: ServiceResponse) => {
        if (chrome.runtime.lastError || r?.error) return
        if (r?.shieldedQuote) setFee(r.shieldedQuote.fee)
      }
    )
  }, [open, a, poolId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      // The trustline sheet layers above this one, so its clicks land outside sheetRef; ignore them.
      if (trustlineSheetOpen) return
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (trustlineSheetOpen) return
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose, trustlineSheetOpen])

  const chipCode = native ? 'XLM' : (assetCode ?? assetLabel)

  // Shield spends the public balance; send/unshield spend the private balance.
  const balanceStr =
    a === 'shield'
      ? publicBalance
      : shieldedBalance !== null
        ? fromStroops(shieldedBalance, decimals)
        : null
  const hasBalance = balanceStr !== null

  // Spendable stroops for the active action, used by the % buttons and the exceeds gate.
  const spendableStroops = (() => {
    if (a === 'shield') {
      if (publicBalance === null) return 0n
      const bal = decimalToStroops(publicBalance, decimals)
      if (!native) return bal
      const reserve = (2n + BigInt(subentryCount)) * 5_000_000n
      const headroom = reserve + SHIELD_FEE_HEADROOM_STROOPS
      return bal > headroom ? bal - headroom : 0n
    }
    // Send/unshield reserve one fee per relayed 2-note chunk; Max is balance minus that, floored at 0.
    if (shieldedBalance === null) return 0n
    const bal = BigInt(shieldedBalance)
    const feeStroops = fee !== null ? BigInt(fee) : 0n
    const notes = noteCount !== null ? BigInt(noteCount) : 1n
    const chunks = notes > 0n ? (notes + 1n) / 2n : 1n
    const feeReserve = feeStroops * chunks
    return bal > feeReserve ? bal - feeReserve : 0n
  })()

  function fillFraction(fraction: number) {
    const portion = (spendableStroops * BigInt(Math.round(fraction * 100))) / 100n
    setAmount(portion > 0n ? fromStroops(portion.toString(), decimals) : '0')
  }

  function fillMax() {
    setAmount(spendableStroops > 0n ? fromStroops(spendableStroops.toString(), decimals) : '0')
  }

  const stroops = toStroops(amount, decimals)
  const exceedsBalance = stroops !== null && stroops > spendableStroops

  const recipientValid = a !== 'send' || recipient.trim().toLowerCase().startsWith('cy1')
  // Unshield lands on the user's public account, so a non-native pool needs its trustline first.
  const needsTrustline = a === 'unshield' && !!assetCode && !hasTrustline
  const canSubmit =
    !submitting && stroops !== null && !exceedsBalance && recipientValid && !needsTrustline

  // Open the shared confirmation sheet only when both asset code and issuer exist.
  const trustlineAsset: PendingAsset | null =
    trustlineSheetOpen && assetCode && assetIssuer ? { code: assetCode, issuer: assetIssuer } : null

  // Signs change_trust via the same background handler the public Add-Asset flow uses.
  const confirmTrustline = useCallback(
    (): Promise<{ txHash?: string; error?: string }> =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: SERVICE_TYPES.ADD_TRUSTLINE,
            trustline: { assetCode, assetIssuer },
            horizonUrl,
            networkPassphrase,
          },
          (r: ServiceResponse) => {
            if (chrome.runtime.lastError) {
              resolve({ error: 'Extension error' })
              return
            }
            resolve({ txHash: r?.txHash, error: r?.error })
          }
        )
      }),
    [assetCode, assetIssuer, horizonUrl, networkPassphrase]
  )

  // One relayed chunk of the auto-split loop; resolves with the chunk result or an error string.
  const spendChunk = useCallback(
    (
      chunkAction: 'send' | 'unshield',
      remaining: bigint
    ): Promise<{ done: boolean; remaining: string; sent: string } | { error: string }> =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: SERVICE_TYPES.SHIELDED_SPEND_CHUNK,
            poolId,
            action: chunkAction,
            recipient: chunkAction === 'send' ? recipient.trim() : null,
            remaining: remaining.toString(),
          },
          (r: ServiceResponse) => {
            if (chrome.runtime.lastError) {
              resolve({ error: 'Extension error' })
              return
            }
            if (r?.error) {
              resolve({ error: r.error })
              return
            }
            if (r?.shieldedSpendChunk) {
              resolve(r.shieldedSpendChunk)
              return
            }
            resolve({ error: 'Chunk failed' })
          }
        )
      }),
    [poolId, recipient]
  )

  const submit = useCallback(() => {
    // Guard against a concurrent submit starting a parallel auto-split loop that double-spends notes.
    if (submitting || !a || stroops === null) return
    setSubmitting(true)
    setError(null)

    // Shield and any send/unshield within (maxSpendable - fee) clear in one tx; larger falls to auto-split.
    const feeStroops = fee !== null ? BigInt(fee) : 0n
    const singleCap = maxSpendable !== null ? BigInt(maxSpendable) - feeStroops : spendableStroops
    const singleTx = a === 'shield' || stroops <= singleCap

    if (singleTx) {
      const msg =
        a === 'send'
          ? {
              type: SERVICE_TYPES.SHIELDED_SEND,
              poolId,
              recipient: recipient.trim(),
              amount: stroops.toString(),
            }
          : a === 'shield'
            ? { type: SERVICE_TYPES.SHIELDED_SHIELD, poolId, amount: stroops.toString() }
            : { type: SERVICE_TYPES.SHIELDED_UNSHIELD, poolId, amount: stroops.toString() }
      chrome.runtime.sendMessage(msg, (r: ServiceResponse) => {
        setSubmitting(false)
        if (chrome.runtime.lastError) {
          setError('Extension error')
          return
        }
        if (r?.error) {
          setError(r.error)
          return
        }
        if (r?.shieldedSend) {
          setDoneHash(r.shieldedSend.hash)
          onDone()
        }
      })
      return
    }

    // Auto-split: deliver the amount in successive relayed 2-note chunks until the backend reports done.
    const total = stroops
    setSentProgress('0')
    const run = async () => {
      let remaining = total
      const chunkAction = a === 'send' ? 'send' : 'unshield'
      while (remaining > 0n) {
        const res = await spendChunk(chunkAction, remaining)
        if ('error' in res) {
          setSubmitting(false)
          setSentProgress(null)
          setError(res.error)
          return
        }
        remaining = BigInt(res.remaining)
        setSentProgress((total - remaining).toString())
        if (res.done) break
      }
      setSubmitting(false)
      setSentProgress(null)
      // No single tx hash spans the split; SPLIT_DONE tells the success screen to omit the hash line.
      setDoneHash(SPLIT_DONE)
      onDone()
    }
    run()
  }, [
    submitting,
    a,
    stroops,
    recipient,
    poolId,
    onDone,
    fee,
    maxSpendable,
    spendableStroops,
    spendChunk,
  ])

  const Icon = a ? ACTION_ICONS[a] : SendIcon

  // During auto-split the button shows chunk progress; otherwise the single-tx gerund or action title.
  const submitLabel = (() => {
    if (!a) return ''
    if (submitting && sentProgress !== null) {
      if (a === 'unshield') return 'Unshielding chunk...'
      const total = stroops !== null ? fromStroops(stroops.toString(), decimals) : '0'
      return `Sending ${fromStroops(sentProgress, decimals)}/${total}`
    }
    if (submitting) return BUSY[a]
    return TITLES[a]
  })()

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {a && (
          <>
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Icon size={16} className="text-primary" />
                </div>
                <div className="flex flex-col">
                  <p className="text-lg font-bold text-foreground leading-tight">{TITLES[a]}</p>
                  <p className="text-xs text-muted-foreground">{subtitles[a]}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="cursor-pointer rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 pb-5 flex flex-col gap-4 [&>*]:shrink-0">
              {doneHash ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
                    <CheckCircle2 size={24} className="text-green-500" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {a === 'send'
                      ? 'Private send submitted'
                      : a === 'shield'
                        ? 'Shielded into your private balance'
                        : 'Unshielded to your public balance'}
                  </p>
                  {doneHash !== SPLIT_DONE && (
                    <p className="break-all font-mono text-xs text-muted-foreground">{doneHash}</p>
                  )}
                  <Button className="mt-2 w-full" onClick={onClose}>
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div
                    className={`rounded-xl bg-card p-4 flex flex-col gap-3 transition-colors ${exceedsBalance ? 'ring-1 ring-destructive/60' : ''}`}
                  >
                    <button
                      onClick={onChangeAsset}
                      aria-label="Change asset"
                      className="cursor-pointer self-start flex items-center gap-2 rounded-xl bg-muted px-3 py-2 hover:bg-muted/70 transition-colors"
                    >
                      <AssetIcon icon={assetIcon} code={chipCode} size={22} />
                      <span className="text-sm font-semibold text-foreground">{chipCode}</span>
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>

                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="text-4xl font-bold bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground min-w-0 truncate">
                        {hasBalance ? `Balance: ${balanceStr} ${chipCode}` : 'Balance: -'}
                      </p>
                      {hasBalance && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => fillFraction(0.25)}
                            aria-label="Set amount to 25 percent of balance"
                            className="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted/70 transition-colors"
                          >
                            25%
                          </button>
                          <button
                            onClick={() => fillFraction(0.5)}
                            aria-label="Set amount to 50 percent of balance"
                            className="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted/70 transition-colors"
                          >
                            50%
                          </button>
                          <button
                            onClick={fillMax}
                            aria-label="Set amount to maximum spendable balance"
                            className="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary hover:bg-muted/70 transition-colors"
                          >
                            Max
                          </button>
                        </div>
                      )}
                    </div>
                    {exceedsBalance && <p className="text-xs text-destructive">Exceeds balance</p>}
                  </div>

                  {a === 'send' && (
                    <div className="rounded-xl bg-card px-4 py-3 flex flex-col gap-1.5">
                      <p className="text-xs text-muted-foreground">To</p>
                      {recipientValid && recipient.trim().length >= 20 && !recipientFocused ? (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setRecipientFocused(true)}
                            className="cursor-pointer flex items-center gap-2 min-w-0"
                          >
                            <Cy1Avatar address={recipient.trim()} size={22} />
                            <span className="text-sm font-mono text-foreground">
                              {`${recipient.trim().slice(0, 8)}...${recipient.trim().slice(-6)}`}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRecipient('')
                              setRecipientFocused(true)
                            }}
                            aria-label="Clear recipient"
                            className="cursor-pointer shrink-0 p-1 ml-2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <input
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          onFocus={() => setRecipientFocused(true)}
                          onBlur={() => setRecipientFocused(false)}
                          placeholder="cy1..."
                          spellCheck={false}
                          autoCapitalize="none"
                          className="bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none w-full"
                        />
                      )}
                      {recipient.trim() !== '' && !recipientValid && (
                        <p className="text-xs text-destructive">Private addresses start with cy1</p>
                      )}
                    </div>
                  )}

                  {a !== 'shield' && (
                    <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
                      <span className="text-sm text-muted-foreground">Fee</span>
                      <span className="text-sm font-medium text-foreground tabular-nums">
                        {fee !== null ? `${fromStroops(fee, decimals)} ${assetLabel}` : '...'}
                      </span>
                    </div>
                  )}

                  {needsTrustline && (
                    <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        Your account needs a {assetLabel} trustline to unshield.
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setTrustlineSheetOpen(true)}
                      >
                        {`Add ${assetLabel} trustline`}
                      </Button>
                    </div>
                  )}

                  {error && (
                    <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">
                      {error}
                    </p>
                  )}

                  <Button className="w-full" disabled={!canSubmit} onClick={submit}>
                    {submitLabel}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <AddTrustlineSheet
        asset={trustlineAsset}
        onConfirm={confirmTrustline}
        onClose={() => setTrustlineSheetOpen(false)}
        onDone={() => {
          setTrustlineSheetOpen(false)
          // Balances refresh upstream flips hasTrustline, which re-enables the submit.
          onTrustlineAdded()
        }}
      />
    </>
  )
}
