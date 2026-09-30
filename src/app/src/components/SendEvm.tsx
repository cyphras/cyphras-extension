import { useEffect, useState } from 'react'
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
} from '@/components/TxDetailParts'
import { Button } from '@/components/ui/button'
import {
  parseUnits,
  formatUnits,
  fractionUnits,
  formatBalanceText,
  formatSignificant,
  truncateDecimals,
  evmGasCeilingWei,
} from '@/lib/amount'
import { formatFiat } from '@/lib/activity'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { SERVICE_TYPES } from '@constants/services'
import { chainById, explorerUrl } from '@constants/chains'
import type { AssetBalance } from '@/hooks/useBalances'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Gas reserve for a native Max send until the live gas price loads; the same
// 0.002 floor the bridge keeps for an EVM mint, generous on purpose.
const NATIVE_GAS_HEADROOM = '0.002'

export function SendEvm({
  asset,
  chainName,
  onPickAsset,
  initialDestination = '',
  onSent,
  onBack,
  chainIcon,
  recipientLabel,
  nativeBalance,
  nativePrice = null,
}: {
  asset: AssetBalance
  chainName: string
  onPickAsset: () => void
  initialDestination?: string
  onSent?: (destination: string) => void
  onBack?: () => void
  chainIcon?: string
  recipientLabel?: string
  // The chain's native balance, which pays gas for a token send.
  nativeBalance?: string
  nativePrice?: number | null
}) {
  const navigate = useNavigate()
  const { status, accounts } = useWallet()
  const fromAddress = accounts.find((a) => a.publicKey === status.publicKey)?.addresses?.evm
  const chain = chainById(asset.chain)

  const [destination, setDestination] = useState(initialDestination)
  const [destinationTouched, setDestinationTouched] = useState(initialDestination !== '')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'form' | 'confirm' | 'result'>('form')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  // Broadcast is not delivery: the result screen follows the receipt until
  // the chain has mined the tx or reverted it.
  const [txState, setTxState] = useState<'pending' | 'success' | 'failed'>('pending')
  const [paidFee, setPaidFee] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!txHash || txState !== 'pending') return
    let polls = 0
    const timer = setInterval(() => {
      polls += 1
      // Five minutes of pending is a stuck fee, not a slow block; History keeps watching.
      if (polls > 100) {
        setGaveUp(true)
        clearInterval(timer)
        return
      }
      chrome.runtime.sendMessage(
        {
          type: SERVICE_TYPES.EVM_TX_STATUS,
          publicKey: status.publicKey,
          chain: asset.chain,
          hash: txHash,
        },
        (r?: { status?: 'pending' | 'success' | 'failed'; fee?: string }) => {
          if (chrome.runtime.lastError || !r?.status || r.status === 'pending') return
          setTxState(r.status)
          if (r.fee) setPaidFee(r.fee)
        }
      )
    }, 3000)
    return () => clearInterval(timer)
  }, [txHash, txState, status.publicKey, asset.chain])

  // Same price and tip the background signs with: the fee shown is price x gas, but
  // the balance check uses the worst-case signing ceiling (evmGasCeilingWei).
  const [gas, setGas] = useState<{ price: bigint; tip: bigint } | null>(null)
  useEffect(() => {
    let cancelled = false
    const rpcUrl = chain?.evm?.rpcUrls[0]
    if (!rpcUrl) return
    const rpc = (method: string) =>
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
        signal: AbortSignal.timeout(8000),
      })
        .then((r) => r.json())
        .then((d: { result?: string }) => (d.result ? BigInt(d.result) : null))
    Promise.all([rpc('eth_gasPrice'), rpc('eth_maxPriorityFeePerGas').catch(() => null)])
      .then(([price, tip]) => {
        // 1.5 gwei is the background's own fallback tip when a node lacks the method.
        if (!cancelled && price !== null) setGas({ price, tip: tip ?? 1_500_000_000n })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [chain])

  const gasUnits = asset.isNative ? 21_000n : 65_000n
  const feeEstimate = gas ? formatUnits(gas.price * gasUnits, 18) : null
  const gasCeilingWei = gas ? evmGasCeilingWei(gasUnits, gas.price, gas.tip) : null
  const nativeUnits = parseUnits(truncateDecimals(nativeBalance ?? '0', 18), 18) ?? 0n
  const gasShort = !asset.isNative && gasCeilingWei !== null && nativeUnits < gasCeilingWei

  const amountNum = parseFloat(amount)
  const destinationInvalid =
    destinationTouched && destination !== '' && !EVM_ADDRESS_RE.test(destination)

  // Native sends keep the signing gas ceiling back so a Max send is never
  // refused for "insufficient funds"; ERC-20 sends can spend the whole token
  // balance since gas is paid in the native asset (checked as gasShort).
  const balanceUnits =
    parseUnits(truncateDecimals(asset.balance, asset.decimals), asset.decimals) ?? 0n
  const gasReserveUnits = asset.isNative
    ? (gasCeilingWei ?? parseUnits(NATIVE_GAS_HEADROOM, asset.decimals) ?? 0n)
    : 0n
  const spendableUnits = balanceUnits > gasReserveUnits ? balanceUnits - gasReserveUnits : 0n
  const amountUnits =
    parseUnits(truncateDecimals(amount || '0', asset.decimals), asset.decimals) ?? 0n
  const exceedsBalance = amountUnits > 0n && amountUnits > spendableUnits
  const canContinue =
    EVM_ADDRESS_RE.test(destination) && amountUnits > 0n && !exceedsBalance && !gasShort
  const fillFraction = (fraction: number) =>
    setAmount(formatUnits(fractionUnits(spendableUnits, fraction), asset.decimals))
  const fillMax = () => setAmount(formatUnits(spendableUnits, asset.decimals))
  const fiatText =
    asset.usdPrice !== null
      ? formatFiat(!isNaN(amountNum) && amountNum > 0 ? amountNum * asset.usdPrice : 0)
      : null

  const submit = () => {
    setSending(true)
    setError('')
    chrome.runtime.sendMessage(
      {
        type: SERVICE_TYPES.SIGN_AND_SUBMIT_EVM_PAYMENT,
        publicKey: status.publicKey,
        chain: asset.chain,
        to: destination,
        amount,
        code: asset.code,
        token: asset.isNative ? undefined : { address: asset.issuer, decimals: asset.decimals },
      },
      (response) => {
        setSending(false)
        if (chrome.runtime.lastError || !response) {
          setError('Extension error')
          return
        }
        if (response.error) {
          setError(String(response.error))
          return
        }
        setTxState('pending')
        setPaidFee(null)
        setGaveUp(false)
        setTxHash(String(response.txHash ?? ''))
        setStep('result')
        onSent?.(destination)
      }
    )
  }

  const explorerLink = chain && txHash ? explorerUrl(chain.explorer.tx, txHash) : null

  const goBack = () => {
    if (sending) return
    if (onBack) {
      onBack()
    } else {
      navigate(-1)
    }
  }
  // A recipient picked on the first step is shown as a person, not a field;
  // "Change" goes back to that step instead of editing hex in place.
  const pickedRecipient =
    !!onBack && EVM_ADDRESS_RE.test(initialDestination) && destination === initialDestination

  const nativeCode = chain?.nativeCurrency.symbol ?? 'ETH'
  const feeFiat =
    feeEstimate && nativePrice !== null ? formatFiat(parseFloat(feeEstimate) * nativePrice) : null
  const maxFee = gasCeilingWei ? formatUnits(gasCeilingWei, 18) : null
  const recipientText = recipientLabel ?? `${destination.slice(0, 6)}...${destination.slice(-4)}`
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
              onClick={goBack}
              aria-label="Go back"
              className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">Send</h2>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
            <span className="pixel-label text-[10px] text-muted-foreground">To</span>
            {pickedRecipient ? (
              <RecipientRow
                address={destination}
                label={recipientLabel}
                networkName={chainName}
                chainIcon={chainIcon}
                onChange={onBack}
              />
            ) : (
              <>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="0x..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  onBlur={() => setDestinationTouched(true)}
                  className={`w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50 ${destinationInvalid ? 'text-destructive' : ''}`}
                />
                {destinationInvalid && (
                  <p className="text-xs text-destructive">Enter a valid 0x address.</p>
                )}
              </>
            )}
          </div>

          <SideCard
            label="You send"
            corner={formatBalanceText(asset.balance, asset.code, asset.decimals)}
            chip={{
              code: asset.code,
              issuer: asset.issuer,
              icon: asset.icon,
              chainIcon,
              subLabel: chainName,
              onPick: onPickAsset,
              ariaLabel: 'Select asset',
            }}
            value={<AmountInput value={amount} onChange={setAmount} />}
            footAsset={<QuickFillChips onFill={(f) => (f === 1 ? fillMax() : fillFraction(f))} />}
            footAmount={fiatText ?? ''}
            error={exceedsBalance ? 'Exceeds balance' : null}
          />

          <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4 text-xs">
            <DetailRow label="Network">
              <NetworkValue name={chainName} icon={chainIcon} />
            </DetailRow>
            <DetailRow label="Network fee">
              <span className="tabular-nums">
                {feeEstimate ? `~${formatSignificant(feeEstimate)} ${nativeCode}` : '-'}
                {feeFiat && <span className="ml-1 text-muted-foreground">{feeFiat}</span>}
              </span>
            </DetailRow>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 px-5 py-4">
        <Button className="w-full" disabled={!canContinue} onClick={() => setStep('confirm')}>
          {!amount || !(amountNum > 0)
            ? 'Enter an amount'
            : exceedsBalance
              ? asset.isNative && amountUnits <= balanceUnits
                ? `Leave some ${asset.code} for gas`
                : `Insufficient ${asset.code}`
              : gasShort
                ? `Not enough ${nativeCode} for gas`
                : 'Review send'}
        </Button>
      </div>

      <BottomSheet
        open={step !== 'form'}
        onClose={closeSheet}
        title={
          step === 'confirm'
            ? 'Confirm send'
            : txState === 'success'
              ? 'Payment sent'
              : txState === 'failed'
                ? 'Payment failed'
                : 'Sending'
        }
      >
        {step === 'result' ? (
          <div className="flex flex-col gap-4">
            <TxResultHero
              state={txState}
              amountText={`-${amount}`}
              code={asset.code}
              issuer={asset.issuer}
              subtitle={`to ${recipientText}`}
              note={
                txState === 'failed'
                  ? `The transaction reverted on ${chainName}. Your ${asset.code} did not move; the network fee was still paid.`
                  : txState === 'pending'
                    ? gaveUp
                      ? 'Still waiting for the network. History keeps tracking it.'
                      : `Waiting for ${chainName} to confirm, usually under a minute.`
                    : undefined
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
                <span className="tabular-nums">
                  {paidFee
                    ? `${formatSignificant(paidFee)} ${nativeCode}`
                    : txState === 'pending'
                      ? 'Pending'
                      : '-'}
                </span>
              </DetailRow>
              {txHash && (
                <DetailRow label="Transaction">
                  <CopyValue value={txHash} />
                </DetailRow>
              )}
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
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4">
              <AssetIcon code={asset.code} icon={asset.icon} chainIcons={[chainIcon]} />
              <div className="min-w-0">
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {amount}{' '}
                  <span className="text-base font-medium text-muted-foreground">{asset.code}</span>
                  <VerifiedMark code={asset.code} issuer={asset.issuer} className="ml-1 h-4 w-4" />
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
                    {feeEstimate ? `~${formatSignificant(feeEstimate)} ${nativeCode}` : '-'}
                    {feeFiat && <span className="ml-1 text-muted-foreground">{feeFiat}</span>}
                  </span>
                  {maxFee && (
                    <span className="text-[11px] text-muted-foreground">
                      up to {formatSignificant(maxFee)} {nativeCode}
                    </span>
                  )}
                </span>
              </DetailRow>
            </div>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={sending} onClick={closeSheet}>
                Cancel
              </Button>
              <Button className="flex-1" disabled={sending} onClick={submit}>
                {sending ? 'Sending...' : `Send ${amount} ${asset.code}`}
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
