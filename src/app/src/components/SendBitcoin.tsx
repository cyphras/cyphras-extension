import { useEffect, useState } from 'react'
import { usePreferences } from '@/context/PreferencesContext'
import { Reveal } from '@/components/Collapse'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { SideCard, AmountInput, QuickFillChips } from '@/components/PairCard'
import { RecipientRow } from '@/components/RecipientRow'
import { BottomSheet } from '@/components/BottomSheet'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import {
  AddressValue,
  CopyValue,
  DetailRow,
  NetworkValue,
  TxResultHero,
  TokenStatusIcon,
} from '@/components/TxDetailParts'
import { Button } from '@/components/ui/button'
import { formatUnits, fractionUnits, formatSignificant } from '@/lib/amount'
import { formatFiat } from '@/lib/activity'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { SERVICE_TYPES } from '@constants/services'
import { chainById, explorerUrl } from '@constants/chains'
import type { AssetBalance } from '@/hooks/useBalances'
import type { ServiceResponse } from '@ext-types/index'

type Tier = 'slow' | 'normal' | 'fast'
type Quote = NonNullable<ServiceResponse['btcQuote']>

const TIERS: { id: Tier; label: string; eta: string }[] = [
  { id: 'slow', label: 'Slow', eta: 'about an hour' },
  { id: 'normal', label: 'Normal', eta: 'about 30 minutes' },
  { id: 'fast', label: 'Fast', eta: 'about 10 minutes' },
]

function send<T extends object>(payload: Record<string, unknown>): Promise<T & ServiceResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (r?: ServiceResponse) =>
      resolve(
        (chrome.runtime.lastError || !r ? { error: 'Extension error' } : r) as T & ServiceResponse
      )
    )
  })
}

const btc = (sats: string | bigint) => formatUnits(BigInt(sats), 8)

// sat/vB above which the confirm step flags the fee, whatever the amount.
const HIGH_FEE_RATE = 200

export function SendBitcoin({
  asset,
  chainName,
  chainIcon,
  onPickAsset,
  initialDestination,
  recipientLabel,
  onSent,
  onBack,
}: {
  asset: AssetBalance
  chainName: string
  chainIcon?: string
  onPickAsset: () => void
  initialDestination: string
  recipientLabel?: string
  onSent?: (destination: string) => void
  onBack: () => void
}) {
  const navigate = useNavigate()
  const { status, accounts } = useWallet()
  const chain = chainById(asset.chain)
  const account = accounts.find((a) => a.publicKey === status.publicKey)
  const fromAddress = chain?.isTestnet
    ? account?.addresses?.bitcoinTestnet
    : account?.addresses?.bitcoin
  const destination = initialDestination

  const [rates, setRates] = useState<Record<Tier, number> | null>(null)
  const [tier, setTier] = useState<Tier>('normal')
  const [amount, setAmount] = useState('')
  const [isMax, setIsMax] = useState(false)
  // The largest sendable amount at the chosen fee, which also drives the quick fills.
  const [maxQuote, setMaxQuote] = useState<Quote | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoting, setQuoting] = useState(false)

  const [step, setStep] = useState<'form' | 'confirm' | 'result'>('form')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [sent, setSent] = useState<Quote | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const feeRate = rates?.[tier]

  useEffect(() => {
    send<object>({
      type: SERVICE_TYPES.FETCH_BTC_FEES,
      publicKey: status.publicKey,
      chain: asset.chain,
    }).then((r) => {
      if (r.btcFees) setRates(r.btcFees)
      else setQuoteError(r.error ?? 'Could not load network fees')
    })
  }, [status.publicKey, asset.chain])

  useEffect(() => {
    if (!feeRate) return
    let cancelled = false
    send<object>({
      type: SERVICE_TYPES.BTC_QUOTE,
      publicKey: status.publicKey,
      chain: asset.chain,
      to: destination,
      amount: 'max',
      feeRate,
    }).then((r) => {
      if (!cancelled) setMaxQuote(r.btcQuote ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [feeRate, status.publicKey, asset.chain, destination])

  // The quote is the real transaction the send would build, so its fee is what gets paid.
  useEffect(() => {
    setQuote(null)
    setQuoteError('')
    if (!feeRate || (!isMax && !(parseFloat(amount) > 0))) return
    let cancelled = false
    setQuoting(true)
    const t = setTimeout(() => {
      send<object>({
        type: SERVICE_TYPES.BTC_QUOTE,
        publicKey: status.publicKey,
        chain: asset.chain,
        to: destination,
        amount: isMax ? 'max' : amount,
        feeRate,
      }).then((r) => {
        if (cancelled) return
        setQuoting(false)
        if (r.btcQuote) setQuote(r.btcQuote)
        else setQuoteError(r.error ?? 'Could not prepare this payment')
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
      setQuoting(false)
    }
  }, [amount, isMax, feeRate, status.publicKey, asset.chain, destination])

  useEffect(() => {
    if (!txHash || confirmed) return
    let polls = 0
    const timer = setInterval(() => {
      polls += 1
      if (polls > 60) {
        clearInterval(timer)
        return
      }
      send<object>({
        type: SERVICE_TYPES.BTC_TX_STATUS,
        publicKey: status.publicKey,
        chain: asset.chain,
        hash: txHash,
      }).then((r) => {
        if (r.status === 'success') setConfirmed(true)
      })
    }, 30000)
    return () => clearInterval(timer)
  }, [txHash, confirmed, status.publicKey, asset.chain])

  const maxSendSats = maxQuote ? BigInt(maxQuote.sendSats) : 0n
  const fillFraction = (fraction: number) => {
    setIsMax(false)
    setAmount(formatUnits(fractionUnits(maxSendSats, fraction), 8))
  }
  const fillMax = () => {
    setIsMax(true)
    setAmount(btc(maxSendSats))
  }

  const shownAmount = quote ? btc(quote.sendSats) : amount
  const amountNum = parseFloat(shownAmount)
  const fiat = (value: number) =>
    asset.usdPrice !== null ? formatFiat(value * asset.usdPrice) : null
  const fiatText = fiat(!isNaN(amountNum) && amountNum > 0 ? amountNum : 0)
  const feeBtc = quote ? btc(quote.feeSats) : null
  const pendingSats = maxQuote ? BigInt(maxQuote.pendingSats) : 0n
  const tierInfo = TIERS.find((t) => t.id === tier)!
  // A fee this large is almost never intended; it must be seen, not scrolled past.
  const highFee =
    !!quote &&
    (BigInt(quote.feeSats) * 20n > BigInt(quote.sendSats) || (feeRate ?? 0) > HIGH_FEE_RATE)
  const recipientText = recipientLabel ?? `${destination.slice(0, 6)}...${destination.slice(-4)}`
  const { chainExplorer } = usePreferences()
  const explorerLink = chain && txHash ? explorerUrl(chainExplorer(chain).tx, txHash) : null

  const submit = () => {
    if (!quote || !feeRate) return
    setSending(true)
    setError('')
    send<object>({
      type: SERVICE_TYPES.SIGN_AND_SUBMIT_BTC_PAYMENT,
      publicKey: status.publicKey,
      chain: asset.chain,
      to: destination,
      amount: isMax ? 'max' : amount,
      feeRate,
      maxFeeSats: quote.feeSats,
      sendSats: quote.sendSats,
    }).then((r) => {
      setSending(false)
      if (r.error || !r.txHash) {
        setError(r.error ?? 'Bitcoin send failed')
        return
      }
      setSent(r.btcQuote ?? quote)
      setTxHash(r.txHash)
      setStep('result')
      onSent?.(destination)
    })
  }

  const closeSheet = () => {
    if (sending) return
    if (step === 'result') navigate('/')
    else {
      setStep('form')
      setError('')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5">
        <div className="flex flex-col gap-3 py-5">
          <div className="relative flex items-center justify-center">
            <button
              onClick={onBack}
              aria-label="Go back"
              className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Send</h2>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
            <span className="pixel-label text-[10px] text-muted-foreground">To</span>
            <RecipientRow
              address={destination}
              label={recipientLabel}
              networkName={chainName}
              chainIcon={chainIcon}
              onChange={onBack}
            />
          </div>

          <SideCard
            label="You send"
            corner={
              maxQuote
                ? `Available: ${btc(maxQuote.spendableSats)} BTC`
                : `Balance: ${asset.balance} BTC`
            }
            chip={{
              code: asset.code,
              issuer: asset.issuer,
              icon: asset.icon,
              chainIcon,
              subLabel: chainName,
              onPick: onPickAsset,
              ariaLabel: 'Select asset',
            }}
            value={
              <AmountInput
                value={isMax ? btc(maxSendSats) : amount}
                onChange={(v) => {
                  setIsMax(false)
                  setAmount(v)
                }}
              />
            }
            footAsset={
              maxSendSats > 0n ? (
                <QuickFillChips onFill={(f) => (f === 1 ? fillMax() : fillFraction(f))} />
              ) : null
            }
            footAmount={fiatText ?? ''}
            error={quoteError || null}
          />

          <Reveal show={pendingSats > 0n} gap={12}>
            <p className="px-1 text-[11px] text-muted-foreground">
              {btc(pendingSats)} BTC is still waiting for its first confirmation and can be sent
              once it confirms.
            </p>
          </Reveal>

          <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
            <span className="pixel-label text-[10px] text-muted-foreground">Network fee</span>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTier(t.id)}
                  className={`cursor-pointer rounded-lg px-2 py-2 text-center transition-colors ${
                    tier === t.id
                      ? 'bg-primary/10 ring-1 ring-primary/40'
                      : 'bg-muted hover:bg-muted/70'
                  }`}
                >
                  <span className="block text-xs font-medium text-foreground">{t.label}</span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                    {rates ? `${rates[t.id]} sat/vB` : '...'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {feeBtc
                ? `${formatSignificant(feeBtc)} BTC${fiat(parseFloat(feeBtc)) ? ` (${fiat(parseFloat(feeBtc))})` : ''}, confirms in ${tierInfo.eta}`
                : `Confirms in ${tierInfo.eta}`}
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 px-5 py-4">
        <Button className="w-full" disabled={!quote || quoting} onClick={() => setStep('confirm')}>
          {!isMax && !(parseFloat(amount) > 0)
            ? 'Enter an amount'
            : quoting
              ? 'Calculating fee...'
              : quote
                ? 'Review send'
                : 'Check the amount'}
        </Button>
      </div>

      <BottomSheet
        open={step !== 'form'}
        onClose={closeSheet}
        title={
          step === 'confirm' ? 'Confirm send' : confirmed ? 'Payment confirmed' : 'Payment sent'
        }
      >
        {step === 'result' && sent ? (
          <div className="flex flex-col gap-4">
            <TxResultHero
              state={confirmed ? 'success' : 'pending'}
              amountText={`-${btc(sent.sendSats)}`}
              code={asset.code}
              icon={asset.icon}
              chainIcon={chainIcon}
              subtitle={`to ${recipientText}`}
              note={
                confirmed
                  ? undefined
                  : `Broadcast to ${chainName}. The first confirmation usually comes in ${tierInfo.eta}; you can close this, History keeps tracking it.`
              }
            />
            <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
              <DetailRow label="Network">
                <NetworkValue name={chainName} icon={chainIcon} />
              </DetailRow>
              <DetailRow label="To">
                <AddressValue address={destination} />
              </DetailRow>
              <DetailRow label="Network fee">
                <span className="tabular-nums">{formatSignificant(btc(sent.feeSats))} BTC</span>
              </DetailRow>
              <DetailRow label="Transaction">
                <CopyValue value={txHash} />
              </DetailRow>
            </div>
            <div className="flex gap-3">
              {explorerLink && (
                <Button variant="outline" className="flex-1" asChild>
                  <a href={explorerLink} target="_blank" rel="noreferrer">
                    View on explorer <ExternalLink size={14} className="ml-1.5" />
                  </a>
                </Button>
              )}
              <Button className="flex-1" onClick={() => navigate('/')}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          quote && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4">
                {sending ? (
                  <TokenStatusIcon
                    state="pending"
                    code={asset.code}
                    icon={asset.icon}
                    chainIcon={chainIcon}
                    size="sm"
                    className="-m-1"
                  />
                ) : (
                  <AssetIcon code={asset.code} icon={asset.icon} chainIcons={[chainIcon]} />
                )}
                <div className="min-w-0">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {btc(quote.sendSats)}{' '}
                    <span className="text-base font-medium text-muted-foreground">
                      {asset.code}
                    </span>
                    <VerifiedMark
                      code={asset.code}
                      issuer={asset.issuer}
                      className="ml-1 h-4 w-4"
                    />
                  </p>
                  {fiatText && <p className="text-xs text-muted-foreground">{fiatText}</p>}
                </div>
              </div>
              <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
                <DetailRow label="From">
                  <AddressValue address={fromAddress} />
                </DetailRow>
                <DetailRow label="To">
                  <span className="inline-flex flex-col items-end">
                    {recipientLabel && <span className="font-medium">{recipientLabel}</span>}
                    <AddressValue address={destination} />
                  </span>
                </DetailRow>
                <DetailRow label="Network">
                  <NetworkValue name={chainName} icon={chainIcon} />
                </DetailRow>
                <DetailRow label="Network fee">
                  <span className="inline-flex flex-col items-end tabular-nums">
                    <span>
                      {formatSignificant(btc(quote.feeSats))} BTC
                      {fiat(parseFloat(btc(quote.feeSats))) && (
                        <span className="ml-1 text-muted-foreground">
                          {fiat(parseFloat(btc(quote.feeSats)))}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {feeRate} sat/vB, {quote.vsize} vB, {tierInfo.label.toLowerCase()}
                    </span>
                  </span>
                </DetailRow>
              </div>
              {highFee && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-snug text-foreground">
                  This network fee is unusually high for the amount. Check it before sending.
                </p>
              )}
              <Reveal show={!!error} gap={16}>
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              </Reveal>
              <Reveal show={sending} gap={16}>
                <p className="text-center text-xs text-muted-foreground">
                  Signing and broadcasting to {chainName}...
                </p>
              </Reveal>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={sending}
                  onClick={closeSheet}
                >
                  Cancel
                </Button>
                <Button className="flex-1" disabled={sending} onClick={submit}>
                  {sending ? 'Sending...' : `Send ${btc(quote.sendSats)} BTC`}
                </Button>
              </div>
            </div>
          )
        )}
      </BottomSheet>
    </div>
  )
}
