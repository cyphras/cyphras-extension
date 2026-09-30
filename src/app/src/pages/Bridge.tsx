import { useEffect, useRef, useState } from 'react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { Collapse } from '@/components/Collapse'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronDown,
  AlertTriangle,
  ExternalLink,
  ArrowLeftRight,
  ArrowRight,
} from 'lucide-react'
import { CctpCredit, CircleMark } from '@/components/BrandMarks'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useBalances } from '@/hooks/useBalances'
import {
  useCctpJobs,
  quoteCctp,
  startCctp,
  type CctpDirection,
  type CctpSpeed,
} from '@/hooks/useCctpJobs'
import { Button } from '@/components/ui/button'
import WalletNavbar from '@/components/WalletNavbar'
import { Layout } from '@/components/Layout'
import { BridgeProgress } from '@/components/BridgeProgress'
import { BottomSheet } from '@/components/BottomSheet'
import { AssetPickerSheet } from '@/components/AssetPickerSheet'
import { chainById } from '@constants/chains'
import { shortAddr } from '@/lib/cctp'
import { getChainIcons } from '@/lib/chainInfo'
import { formatFiat } from '@/lib/activity'
import {
  SideCard,
  AmountInput,
  AmountValue,
  QuickFillChips,
  FlipButton,
} from '@/components/PairCard'
import { AssetIcon } from '@/components/token/AssetIcon'
import {
  formatUnits,
  fractionUnits,
  formatBalanceText,
  formatSignificant,
  spendableUnits,
} from '@/lib/amount'
import type { CctpJobInfo, CctpFeeBreakdown } from '@ext-types/index'

// CCTP moves USDC with 6 decimals on every chain; a 7-decimal Stellar
// balance is floored to that and the dust stays in the wallet.
const CCTP_DECIMALS = 6
const CIRCLE_USDC_FAUCET = 'https://faucet.circle.com'
const SEPOLIA_ETH_FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia'

type Step = 'form' | 'confirm' | 'progress'

const NON_TERMINAL_STATUSES: CctpJobInfo['status'][] = [
  'created',
  'approving',
  'burn_submitted',
  'burned',
  'attested',
  'mint_submitted',
  'blocked_trustline',
  'blocked_gas',
]

function ChainLabel({ name, icon }: { name: string; icon?: string }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {icon && <img src={icon} alt="" className="h-5 w-5 rounded-full object-cover" />}
      {name}
    </span>
  )
}

export default function Bridge() {
  const navigate = useNavigate()
  const location = useLocation()
  const { status, accounts } = useWallet()
  const { activeNetwork } = useNetwork()
  const isTestnet = activeNetwork.id === 'testnet'

  const account = accounts.find((a) => a.publicKey === status.publicKey)
  const evmAddress = account?.addresses?.evm
  const evmChain = chainById(isTestnet ? 'eip155:11155111' : 'eip155:1')
  const evmName = evmChain?.name ?? 'Ethereum'
  const stellarChain = chainById(isTestnet ? 'stellar:testnet' : 'stellar:pubnet')

  const initialDirection =
    (location.state as { direction?: CctpDirection } | null)?.direction ?? 'stellar-to-evm'
  const [direction, setDirection] = useState<CctpDirection>(initialDirection)
  // Fast only helps the Ethereum->Stellar leg: a Stellar burn finalizes in ~5s
  // at either tier. Circle's docs do not confirm Fast with Stellar as destination.
  const [speed, setSpeed] = useState<CctpSpeed>('standard')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [quote, setQuote] = useState<{ maxFee: string; breakdown?: CctpFeeBreakdown } | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const { balances } = useBalances(status.publicKey)
  const { jobs } = useCctpJobs(status.publicKey ?? '')
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let cancelled = false
    getChainIcons([stellarChain?.id, evmChain?.id].filter((id): id is string => !!id)).then(
      (icons) => {
        if (!cancelled) setChainIcons(icons)
      }
    )
    return () => {
      cancelled = true
    }
  }, [stellarChain?.id, evmChain?.id])
  const stellarIcon = stellarChain ? chainIcons.get(stellarChain.id) : undefined
  const evmIcon = evmChain ? chainIcons.get(evmChain.id) : undefined

  const stellarUsdc = balances.find((b) => b.chain === stellarChain?.id && b.code === 'USDC')
  const evmUsdc = balances.find((b) => b.chain === evmChain?.id && b.code === 'USDC')
  const stellarNative = balances.find((b) => b.chain === stellarChain?.id && b.isNative)
  const evmNative = balances.find((b) => b.chain === evmChain?.id && b.isNative)
  const sourceBalance = direction === 'stellar-to-evm' ? stellarUsdc : evmUsdc

  // Start from whichever side actually holds USDC, once, unless the caller
  // asked for a direction; saves the flip most users would otherwise make.
  const autoPicked = useRef(false)
  useEffect(() => {
    if (autoPicked.current || balances.length === 0) return
    autoPicked.current = true
    if ((location.state as { direction?: CctpDirection } | null)?.direction) return
    const stellarHas = parseFloat(stellarUsdc?.balance ?? '0') > 0
    const evmHas = parseFloat(evmUsdc?.balance ?? '0') > 0
    if (!stellarHas && evmHas) setDirection('evm-to-stellar')
  }, [balances.length, stellarUsdc, evmUsdc, location.state])

  const existingJob = jobs.find(
    (j) => j.direction === direction && NON_TERMINAL_STATUSES.includes(j.status)
  )
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? existingJob ?? null

  useEffect(() => {
    if (existingJob && step === 'form') {
      setActiveJobId(existingJob.id)
      setStep('progress')
    }
  }, [existingJob, step])

  // Fast is only offered Ethereum->Stellar; reset it on a direction change so
  // a stale 'fast' never silently carries over to the other leg.
  useEffect(() => {
    if (direction !== 'evm-to-stellar') setSpeed('standard')
  }, [direction])

  // Fees are always quoted live (debounced), never assumed to be zero.
  useEffect(() => {
    setQuote(null)
    setQuoteError('')
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) return
    setQuoting(true)
    const t = setTimeout(() => {
      quoteCctp(direction, amount, speed, status.publicKey).then((res) => {
        setQuoting(false)
        if (res.error) setQuoteError(res.error)
        else if (res.maxFee !== undefined)
          setQuote({ maxFee: res.maxFee, breakdown: res.breakdown })
      })
    }, 500)
    return () => {
      clearTimeout(t)
      setQuoting(false)
    }
  }, [amount, direction, speed, status.publicKey])

  const destAddress = direction === 'stellar-to-evm' ? evmAddress : status.publicKey
  const amountNum = parseFloat(amount)
  const hasAmount = !isNaN(amountNum) && amountNum > 0
  const decimalsOk = /^\d+(\.\d{1,6})?$/.test(amount.trim())
  // Stellar USDC held as open-offer liabilities cannot be burned.
  const bridgeableUnits = sourceBalance
    ? spendableUnits(sourceBalance.balance, CCTP_DECIMALS, sourceBalance.locked)
    : 0n
  const balanceNum = parseFloat(formatUnits(bridgeableUnits, CCTP_DECIMALS))
  const fillFraction = (fraction: number) =>
    setAmount(formatUnits(fractionUnits(bridgeableUnits, fraction), CCTP_DECIMALS))

  const etaShort =
    direction === 'stellar-to-evm' ? '~1 min' : speed === 'fast' ? '~1-5 min' : '~15-20 min'
  const eta =
    direction === 'stellar-to-evm'
      ? '~1 minute'
      : speed === 'fast'
        ? '~seconds to a few minutes (experimental)'
        : '~15-20 minutes'

  const handleConfirm = async () => {
    if (!status.publicKey) return
    setSubmitting(true)
    setSubmitError('')
    const res = await startCctp(status.publicKey, direction, amount, speed)
    setSubmitting(false)
    if (res.error) {
      setSubmitError(res.error)
      return
    }
    if (res.jobId) {
      setActiveJobId(res.jobId)
      setStep('progress')
    }
  }

  const startOver = () => {
    setActiveJobId(null)
    setAmount('')
    setStep('form')
  }

  const fromName = direction === 'stellar-to-evm' ? 'Stellar' : evmName
  const toName = direction === 'stellar-to-evm' ? evmName : 'Stellar'
  const fromIcon = direction === 'stellar-to-evm' ? stellarIcon : evmIcon
  const toIcon = direction === 'stellar-to-evm' ? evmIcon : stellarIcon
  const fromChainId = direction === 'stellar-to-evm' ? stellarChain?.id : evmChain?.id
  const toChainId = direction === 'stellar-to-evm' ? evmChain?.id : stellarChain?.id
  const sourceNative = direction === 'stellar-to-evm' ? stellarNative : evmNative
  const destNative = direction === 'stellar-to-evm' ? evmNative : stellarNative

  const breakdown = quote?.breakdown
  const circleFeeNum = quote ? parseFloat(quote.maxFee) : NaN
  const feeText = quoting
    ? 'Fetching quote...'
    : quoteError || !quote
      ? '-'
      : circleFeeNum === 0
        ? 'Free'
        : `up to ${quote.maxFee} USDC`
  const legFiat = (leg: CctpFeeBreakdown['source'] | undefined, chainId?: string) => {
    const price = balances.find((b) => b.chain === chainId && b.isNative)?.usdPrice ?? null
    return leg && price !== null ? parseFloat(leg.amount) * price : null
  }
  const legText = (leg: CctpFeeBreakdown['source'] | undefined) =>
    leg
      ? `~${formatSignificant(leg.amount)} ${leg.code}${leg.estimated ? ' (est.)' : ''}`
      : quoting
        ? '...'
        : '-'
  const sourceFiat = legFiat(breakdown?.source, fromChainId)
  const destFiat = legFiat(breakdown?.destination, toChainId)
  // USDC is the unit of account here, so the Circle fee counts as dollars.
  const totalFiat =
    sourceFiat !== null && destFiat !== null && !isNaN(circleFeeNum)
      ? sourceFiat + destFiat + circleFeeNum
      : null

  // Checked up front so nothing pauses the job midway: source gas for approve +
  // burn, destination gas for the mint, and a Stellar USDC trustline to mint into.
  // XLM counts only above the account reserve, as the processor checks before a mint.
  const freeNative = (b: typeof sourceNative) =>
    b ? parseFloat(formatUnits(spendableUnits(b.balance, b.decimals, b.locked), b.decimals)) : 0
  // An EVM source signs approve + burn at gasLimit x 1.2 and maxFee = 2 x gas
  // price, and the node wants that ceiling in the balance up front.
  const sourceIsEvm = direction === 'evm-to-stellar'
  const sourceGasNeed = breakdown
    ? parseFloat(breakdown.source.amount) * (sourceIsEvm ? 2.5 : 1)
    : 0
  const destGasNeed = breakdown
    ? parseFloat(breakdown.destination.reserveHint ?? breakdown.destination.amount)
    : 0
  const sourceGasShort = !!breakdown && freeNative(sourceNative) < sourceGasNeed
  const destGasShort = !!breakdown && freeNative(destNative) < destGasNeed
  const needsTrustline = direction === 'evm-to-stellar' && !stellarUsdc
  const destGasCode =
    breakdown?.destination.code ?? (direction === 'stellar-to-evm' ? 'ETH' : 'XLM')
  const sourceGasCode =
    breakdown?.source.code ??
    (direction === 'stellar-to-evm' ? 'XLM' : (evmChain?.nativeCurrency.symbol ?? 'ETH'))

  const cta: { label: string; enabled: boolean; onClick?: () => void } = !destAddress
    ? { label: `No ${toName} address on this account`, enabled: false }
    : existingJob
      ? { label: 'A bridge is already in progress', enabled: false }
      : !hasAmount
        ? { label: 'Enter an amount', enabled: false }
        : !decimalsOk
          ? { label: 'At most 6 decimal places', enabled: false }
          : amountNum > balanceNum
            ? { label: `Insufficient USDC on ${fromName}`, enabled: false }
            : needsTrustline
              ? {
                  label: 'Add USDC on Stellar first',
                  enabled: true,
                  onClick: () => navigate('/assets/add'),
                }
              : quoting || (!quote && !quoteError)
                ? { label: 'Getting quote...', enabled: false }
                : quoteError
                  ? { label: 'Quote unavailable', enabled: false }
                  : sourceGasShort
                    ? {
                        label: `Not enough ${breakdown?.source.code} on ${fromName} for fees`,
                        enabled: false,
                      }
                    : destGasShort
                      ? { label: `Need ${destGasNeed} ${destGasCode} on ${toName}`, enabled: false }
                      : { label: 'Review bridge', enabled: true, onClick: () => setStep('confirm') }

  // Every cost on both chains, so nothing surfaces later as a pause or a short arrival.
  const feeRows = (
    <>
      <DetailRow
        label="Bridge fee (Circle)"
        value={feeText}
        note={
          circleFeeNum === 0
            ? 'Circle charges nothing for this transfer'
            : 'Taken from the USDC being bridged'
        }
      />
      <DetailRow
        icon={fromIcon}
        label={`${fromName} network fee`}
        value={legText(breakdown?.source)}
        fiat={sourceFiat !== null ? formatFiat(sourceFiat) : undefined}
      />
      <DetailRow
        icon={toIcon}
        label={`${toName} network fee (mint)`}
        value={legText(breakdown?.destination)}
        fiat={destFiat !== null ? formatFiat(destFiat) : undefined}
        note={
          breakdown?.destination
            ? `Paid from your ${breakdown.destination.code} on ${toName}${
                breakdown.destination.reserveHint
                  ? `; keep at least ${breakdown.destination.reserveHint} ${breakdown.destination.code} there`
                  : ''
              }`
            : undefined
        }
      />
      <DetailRow label="Estimated time" value={eta} />
    </>
  )
  const summaryLine = quoting
    ? 'Getting the best quote...'
    : totalFiat !== null
      ? `~${formatFiat(totalFiat)} fees, ${etaShort}`
      : breakdown
        ? `Arrives in ${etaShort}`
        : `Arrives in ${etaShort}`
  const receiveSummary = (
    <div className="flex items-center gap-3">
      <AssetIcon
        code="USDC"
        icon={(sourceBalance ?? stellarUsdc ?? evmUsdc)?.icon}
        chainIcons={[toIcon]}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">You receive on {toName}</p>
        <p className="text-lg font-bold tabular-nums text-foreground">
          {breakdown ? `${breakdown.receiveMin} USDC` : hasAmount ? '...' : '0 USDC'}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">{summaryLine}</p>
      </div>
    </div>
  )

  const usdcIcon = (stellarUsdc ?? evmUsdc)?.icon
  const destUsdc = direction === 'stellar-to-evm' ? evmUsdc : stellarUsdc
  const destBalanceText = destUsdc
    ? formatBalanceText(destUsdc.balance, 'USDC', CCTP_DECIMALS)
    : direction === 'evm-to-stellar'
      ? 'No USDC trustline yet'
      : 'Balance: 0 USDC'
  const usdcPrice = (sourceBalance ?? destUsdc)?.usdPrice ?? null
  const receiveFiat =
    breakdown && usdcPrice !== null ? parseFloat(breakdown.receiveMin) * usdcPrice : null
  const flip = () =>
    setDirection((d) => (d === 'stellar-to-evm' ? 'evm-to-stellar' : 'stellar-to-evm'))
  // One row per place the token can sit; picking a side the other card
  // already holds swaps the direction instead of making a same-chain route.
  const routeSides = [
    { side: 'stellar' as const, name: 'Stellar', icon: stellarIcon, balance: stellarUsdc?.balance },
    { side: 'evm' as const, name: evmName, icon: evmIcon, balance: evmUsdc?.balance },
  ]
  const pickSide = (which: 'from' | 'to', side: 'stellar' | 'evm') => {
    const fromStellar = which === 'from' ? side === 'stellar' : side !== 'stellar'
    setDirection(fromStellar ? 'stellar-to-evm' : 'evm-to-stellar')
    setPicker(null)
  }

  const flowFooter =
    step !== 'progress' ? (
      <Button className="w-full" disabled={!cta.enabled} onClick={cta.onClick}>
        {cta.label}
      </Button>
    ) : undefined

  return (
    <Layout navbar={<WalletNavbar />} footer={flowFooter}>
      <div className="flex flex-col">
        <div className="relative mb-3 flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="cursor-pointer absolute left-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center leading-tight">
            <h2 className="text-lg font-bold text-foreground">Bridge USDC</h2>
            <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              {stellarIcon && <img src={stellarIcon} alt="" className="h-3 w-3 rounded-full" />}
              Stellar
              <ArrowLeftRight size={11} className="mx-0.5 text-muted-foreground/70" />
              {evmIcon && <img src={evmIcon} alt="" className="h-3 w-3 rounded-full" />}
              {evmName}
            </p>
          </div>
        </div>

        {step !== 'progress' && (
          <div className="flex flex-col gap-2.5">
            <div className="relative flex flex-col gap-1.5">
              <SideCard
                label="From"
                corner={
                  sourceBalance
                    ? formatBalanceText(sourceBalance.balance, 'USDC', CCTP_DECIMALS)
                    : 'Balance: 0'
                }
                chip={{
                  code: 'USDC',
                  verified: true,
                  icon: usdcIcon,
                  chainIcon: fromIcon,
                  subLabel: fromName,
                  onPick: () => setPicker('from'),
                  ariaLabel: 'Select asset',
                }}
                value={<AmountInput value={amount} onChange={setAmount} />}
                footAmount={
                  usdcPrice !== null ? formatFiat(hasAmount ? amountNum * usdcPrice : 0) : ''
                }
                footAsset={
                  bridgeableUnits > 0n ? (
                    <QuickFillChips onFill={fillFraction} />
                  ) : isTestnet ? (
                    <a
                      href={CIRCLE_USDC_FAUCET}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      Get test USDC <ExternalLink size={11} />
                    </a>
                  ) : (
                    <button
                      onClick={() =>
                        navigate('/receive', {
                          state: { chain: direction === 'stellar-to-evm' ? 'stellar' : 'evm' },
                        })
                      }
                      className="cursor-pointer font-semibold text-primary hover:underline"
                    >
                      Receive USDC
                    </button>
                  )
                }
                error={amount !== '' && !decimalsOk ? 'At most 6 decimal places' : null}
              />

              <FlipButton onClick={flip} />

              <SideCard
                label="To (you)"
                corner={
                  <span className={`font-mono ${destAddress ? '' : 'text-destructive'}`}>
                    {destAddress ? shortAddr(destAddress) : 'No address yet'}
                  </span>
                }
                chip={{
                  code: 'USDC',
                  verified: true,
                  icon: usdcIcon,
                  chainIcon: toIcon,
                  subLabel: toName,
                  onPick: () => setPicker('to'),
                  ariaLabel: 'Select destination',
                }}
                value={
                  <AmountValue
                    text={breakdown ? breakdown.receiveMin : quoting ? '...' : '0'}
                    muted={!breakdown}
                  />
                }
                footAmount={usdcPrice !== null ? formatFiat(receiveFiat ?? 0) : ''}
                footAsset={destBalanceText}
              />
            </div>

            <div className="rounded-xl bg-card">
              {direction === 'evm-to-stellar' && (
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
                  <span className="text-xs text-muted-foreground">
                    Speed
                    {speed === 'fast' && <span className="text-amber-500"> (experimental)</span>}
                  </span>
                  <div className="flex rounded-lg bg-muted p-0.5">
                    {(['standard', 'fast'] as const).map((sp) => (
                      <button
                        key={sp}
                        onClick={() => setSpeed(sp)}
                        className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          speed === sp
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {sp === 'standard' ? 'Standard ~15m' : 'Fast ~1m'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {hasAmount ? (
                <>
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    aria-expanded={showDetails}
                    className="cursor-pointer flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
                  >
                    <span className="min-w-0 text-xs">
                      <span className="block font-medium text-foreground">{summaryLine}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        Both chains included, via <CctpCredit className="align-[-2px]" />
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
                      Details
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </button>
                  <Collapse open={showDetails}>
                    <div className="flex flex-col divide-y divide-border/60 border-t border-border/60 px-4">
                      {feeRows}
                      {direction === 'evm-to-stellar' && speed === 'fast' && (
                        <p className="py-2.5 text-[11px] leading-relaxed text-amber-500">
                          Circle has not documented Fast Transfer into Stellar yet. If it does not
                          deliver, the bridge still completes via Standard.
                        </p>
                      )}
                    </div>
                  </Collapse>
                  {quoteError && <p className="px-4 pb-3 text-xs text-destructive">{quoteError}</p>}
                </>
              ) : (
                // No amount yet: still show what the trip costs and takes.
                <>
                  <div className="flex flex-col divide-y divide-border/60 px-4">
                    <DetailRow label="Via Circle CCTP" icon="/brand/circle.svg" value={eta} />
                    <DetailRow
                      label="Network fees"
                      value={`${sourceGasCode} on ${fromName}, ${destGasCode} on ${toName}`}
                    />
                  </div>
                  {destNative && freeNative(destNative) === 0 && (
                    <div className="mx-4 mb-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2">
                      <AlertTriangle size={12} className="mt-px shrink-0 text-amber-500" />
                      <p className="text-[11px] leading-snug text-foreground">
                        The mint on {toName} is paid in {destGasCode}, and you have none there yet.{' '}
                        <button
                          onClick={() =>
                            navigate('/receive', {
                              state: { chain: direction === 'stellar-to-evm' ? 'evm' : 'stellar' },
                            })
                          }
                          className="cursor-pointer font-semibold text-primary hover:underline"
                        >
                          Receive {destGasCode}
                        </button>
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {hasAmount && destGasShort && !sourceGasShort && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle size={14} className="mt-px shrink-0 text-amber-500" />
                <p className="text-[11px] leading-snug text-foreground">
                  The mint needs {destGasNeed} {destGasCode} on {toName}, or the bridge pauses
                  halfway.{' '}
                  <button
                    onClick={() =>
                      navigate('/receive', {
                        state: { chain: direction === 'stellar-to-evm' ? 'evm' : 'stellar' },
                      })
                    }
                    className="cursor-pointer font-semibold text-primary hover:underline"
                  >
                    Receive {destGasCode}
                  </button>
                  {isTestnet && destGasCode === 'ETH' && (
                    <>
                      {' or '}
                      <a
                        href={SEPOLIA_ETH_FAUCET}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-primary hover:underline"
                      >
                        use a faucet
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {step === 'progress' && activeJob && (
          <BridgeProgress
            job={activeJob}
            fromChainId={
              activeJob.direction === 'stellar-to-evm'
                ? (stellarChain?.id ?? '')
                : (evmChain?.id ?? '')
            }
            toChainId={
              activeJob.direction === 'stellar-to-evm'
                ? (evmChain?.id ?? '')
                : (stellarChain?.id ?? '')
            }
            onDone={startOver}
          />
        )}
      </div>

      <AssetPickerSheet
        open={picker !== null}
        title={picker === 'to' ? 'Bridge to' : 'Bridge from'}
        note="Only USDC bridges, via Circle CCTP. Swap other Stellar assets to USDC first"
        items={routeSides.map((r) => {
          const bal = r.side === 'stellar' ? stellarUsdc : evmUsdc
          const otherSideIsThis =
            picker === 'to'
              ? (r.side === 'stellar') === (direction === 'stellar-to-evm')
              : (r.side === 'evm') === (direction === 'stellar-to-evm')
          return {
            key: r.side,
            code: 'USDC',
            name: 'USD Coin',
            icon: usdcIcon,
            chainName: r.name,
            chainIcon: r.icon,
            balance: r.balance
              ? parseFloat(r.balance).toLocaleString('en-US', { maximumFractionDigits: 6 })
              : '0',
            fiat: bal?.usdValue != null ? formatFiat(bal.usdValue) : null,
            verified: bal?.verified ?? true,
            hint: otherSideIsThis ? (picker === 'to' ? 'Now sending' : 'Now receiving') : undefined,
          }
        })}
        selectedKey={
          picker === 'to'
            ? direction === 'stellar-to-evm'
              ? 'evm'
              : 'stellar'
            : direction === 'stellar-to-evm'
              ? 'stellar'
              : 'evm'
        }
        onSelect={(key) => picker && pickSide(picker, key as 'stellar' | 'evm')}
        onClose={() => setPicker(null)}
      />

      {/* review in place: one tap to open, one to confirm, no page change */}
      <BottomSheet open={step === 'confirm'} title="Review bridge" onClose={() => setStep('form')}>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-card p-5 text-center">
            <p className="text-3xl font-bold text-foreground">
              {amount} <span className="text-lg font-medium text-muted-foreground">USDC</span>
              <VerifiedBadge className="ml-1 inline-block h-5 w-5 align-[-2px]" />
            </p>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <ChainLabel name={fromName} icon={fromIcon} />
              <ArrowRight size={14} className="text-muted-foreground/70" />
              <ChainLabel name={toName} icon={toIcon} />
            </p>
          </div>

          <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
            <div className="py-3">{receiveSummary}</div>
            <DetailRow
              label="Recipient (you)"
              value={destAddress ? shortAddr(destAddress) : ''}
              mono
            />
            {feeRows}
            {direction === 'evm-to-stellar' && (
              <DetailRow
                label="Speed"
                value={speed === 'fast' ? 'Fast (experimental)' : 'Standard'}
              />
            )}
          </div>

          <div className="rounded-xl bg-card px-4 py-3">
            <p className="pixel-label mb-2 text-[10px] text-muted-foreground">What happens</p>
            <ol className="flex flex-col gap-2 text-xs">
              <HappensStep
                n={1}
                title={`Approve and burn on ${fromName}`}
                detail="Signed now, from this wallet"
              />
              <HappensStep n={2} title="Circle attests the burn" detail={eta} />
              <HappensStep
                n={3}
                title={`Mint on ${toName}`}
                detail={`Automatic, paid in ${destGasCode} from your account there`}
              />
            </ol>
          </div>

          <p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <CircleMark className="mt-px h-3.5 w-3.5" />
            Native USDC via Circle CCTP: burned on {fromName} and minted on {toName}, never wrapped.
            Bridging links your Stellar and {evmName} addresses on public chains.
          </p>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
          <Button className="w-full" disabled={submitting || !quote} onClick={handleConfirm}>
            {submitting ? 'Starting...' : `Bridge ${amount} USDC`}
          </Button>
        </div>
      </BottomSheet>
    </Layout>
  )
}

function HappensStep({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
        {n}
      </span>
      <span>
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}

function DetailRow({
  label,
  value,
  note,
  fiat,
  icon,
  mono = false,
}: {
  label: string
  value: string
  note?: string
  fiat?: string
  icon?: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />}
          {label}
        </span>
        <span className="text-right">
          <span className={`block font-medium text-foreground ${mono ? 'font-mono' : ''}`}>
            {value}
          </span>
          {fiat && <span className="block text-[11px] text-muted-foreground">{fiat}</span>}
        </span>
      </div>
      {note && <p className="text-[11px] leading-snug text-muted-foreground/80">{note}</p>}
    </div>
  )
}
