import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { usePreferences } from '@/context/PreferencesContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { BottomSheet } from '@/components/BottomSheet'
import { XlmIcon } from '@/components/token/AssetIcon'
import { Copy, Check, ChevronLeft, ExternalLink, QrCode } from 'lucide-react'
import WalletNavbar from '@/components/WalletNavbar'
import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { BUILTIN_CHAINS, explorerUrl, type ChainEntry } from '@constants/chains'
import { getRegistryChains } from '@bg/chainRegistry'
import { getChainIcons } from '@/lib/chainInfo'

type ReceiveChain = 'stellar' | 'evm'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

// The whole address in one run (it must copy without spaces), with the first
// and last four characters emphasized: those are what people actually compare,
// and what address-poisoning fakes. "0x" is a prefix, not part of the key.
function FullAddress({ address }: { address: string }) {
  const prefix = address.startsWith('0x') ? '0x' : ''
  const body = address.slice(prefix.length)
  return (
    <p className="w-full break-all text-center font-mono text-[12px] leading-relaxed text-muted-foreground">
      {prefix}
      <span className="font-semibold text-foreground">{body.slice(0, 4)}</span>
      {body.slice(4, -4)}
      <span className="inline-block font-semibold text-foreground">{body.slice(-4)}</span>
    </p>
  )
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      // clipboard denied; the address stays visible to copy by hand
    }
  }
  return { copied, copy }
}

export default function Receive() {
  const navigate = useNavigate()
  const location = useLocation()
  const { status, accounts } = useWallet()
  const { activeNetwork } = useNetwork()
  const { getExplorerAccountUrl, getExplorerName } = usePreferences()
  // Arriving with a chain (e.g. Bridge's "Receive ETH") goes straight to its code.
  const [qrFor, setQrFor] = useState<ReceiveChain | null>(
    (location.state as { chain?: ReceiveChain } | null)?.chain ?? null
  )
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [chains, setChains] = useState<ChainEntry[]>(BUILTIN_CHAINS)
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  const { copied, copy } = useCopy()

  const account = accounts.find((a) => a.publicKey === status.publicKey)
  const stellarAddress = status.publicKey
  const evmAddress = account?.addresses?.evm

  // One derived EVM address serves every EVM chain of the environment, so
  // its row lists all of them (registry first, so admin-panel chains show too).
  const evmChains = useMemo(() => {
    if (activeNetwork.id !== 'mainnet' && activeNetwork.id !== 'testnet') return []
    const isTestnet = activeNetwork.id === 'testnet'
    return chains.filter((c) => c.family === 'evm' && c.enabled && c.isTestnet === isTestnet)
  }, [chains, activeNetwork.id])

  useEffect(() => {
    let cancelled = false
    getRegistryChains().then((c) => {
      if (!cancelled && c.length > 0) setChains(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const stellarChainId = activeNetwork.id === 'testnet' ? 'stellar:testnet' : 'stellar:pubnet'

  useEffect(() => {
    let cancelled = false
    getChainIcons([stellarChainId, ...evmChains.map((c) => c.id)]).then((icons) => {
      if (!cancelled) setChainIcons(icons)
    })
    return () => {
      cancelled = true
    }
  }, [evmChains, stellarChainId])

  const evmNames = evmChains.map((c) => c.name)
  const evmTitle = evmChains.length === 1 ? evmChains[0].name : 'EVM networks'
  const qrAddress = qrFor === 'stellar' ? stellarAddress : qrFor === 'evm' ? evmAddress : undefined

  useEffect(() => {
    setQrDataUrl(null)
    if (!qrAddress) return
    QRCode.toDataURL(qrAddress, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [qrAddress])

  const evmUnavailable =
    account && account.index < 0
      ? 'Secret-key accounts are Stellar-only'
      : 'Unlock to derive this address'

  return (
    <Layout navbar={<WalletNavbar />}>
      <div className="flex flex-col gap-4">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Receive</h2>
        </div>

        <p className="pixel-label text-[10px] text-muted-foreground">Your addresses</p>

        <div className="flex flex-col gap-2">
          <AddressRow
            icon={
              chainIcons.get(stellarChainId) ? (
                <img
                  src={chainIcons.get(stellarChainId)}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <XlmIcon className="h-10 w-10" />
              )
            }
            title="Stellar"
            subtitle={stellarAddress ? shortAddress(stellarAddress) : ''}
            copied={copied === 'stellar'}
            onCopy={stellarAddress ? () => copy('stellar', stellarAddress) : undefined}
            onQr={stellarAddress ? () => setQrFor('stellar') : undefined}
          />
          {evmChains.length > 0 && (
            <AddressRow
              icon={<ChainStack icons={evmChains.map((c) => chainIcons.get(c.id))} />}
              title={evmTitle}
              subtitle={evmAddress ? shortAddress(evmAddress) : evmUnavailable}
              caption={evmChains.length > 1 ? evmNames.join(', ') : undefined}
              copied={copied === 'evm'}
              onCopy={evmAddress ? () => copy('evm', evmAddress) : undefined}
              onQr={evmAddress ? () => setQrFor('evm') : undefined}
            />
          )}
        </div>

        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Each network has its own address. Share the one that matches the network the sender uses.
        </p>
      </div>

      <BottomSheet
        open={qrFor !== null && !!qrAddress}
        title={qrFor === 'stellar' ? 'Receive on Stellar' : `Receive on ${evmTitle}`}
        onClose={() => setQrFor(null)}
      >
        {qrAddress && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Address QR code"
                  width={188}
                  height={188}
                  className="block"
                />
              ) : (
                <div className="h-[188px] w-[188px] animate-pulse rounded-lg bg-neutral-200" />
              )}
            </div>

            <FullAddress address={qrAddress} />

            <div className="grid w-full grid-cols-2 gap-2">
              <Button className="w-full" onClick={() => copy(`sheet-${qrFor}`, qrAddress)}>
                {copied === `sheet-${qrFor}` ? <Check size={14} /> : <Copy size={14} />}
                {copied === `sheet-${qrFor}` ? 'Copied' : 'Copy'}
              </Button>
              {qrFor === 'stellar' ? (
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={getExplorerAccountUrl(qrAddress, activeNetwork.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5"
                  >
                    {getExplorerName()} <ExternalLink size={13} />
                  </a>
                </Button>
              ) : (
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={
                      evmChains[0]
                        ? explorerUrl(evmChains[0].explorer.account, qrAddress)
                        : undefined
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5"
                  >
                    Explorer <ExternalLink size={13} />
                  </a>
                </Button>
              )}
            </div>

            {qrFor === 'evm' && evmChains.length > 1 && (
              <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
                {evmChains.map((c) => (
                  <a
                    key={c.id}
                    href={explorerUrl(c.explorer.account, qrAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-muted"
                  >
                    {chainIcons.get(c.id) && (
                      <img
                        src={chainIcons.get(c.id)}
                        alt=""
                        className="h-3.5 w-3.5 rounded-full object-cover"
                      />
                    )}
                    {c.name}
                  </a>
                ))}
              </div>
            )}

            <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-center text-[11px] leading-relaxed text-foreground">
              {qrFor === 'stellar'
                ? 'Only send Stellar assets to this address. Assets from other networks may be lost for good.'
                : `Only send assets on ${evmNames.join(', ') || 'EVM networks'} to this address. Assets from other networks may be lost for good.`}
            </p>
          </div>
        )}
      </BottomSheet>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Address copied to clipboard' : ''}
      </span>
    </Layout>
  )
}

function ChainStack({ icons }: { icons: Array<string | undefined> }) {
  const shown = icons.slice(0, 3)
  if (shown.length === 1) {
    return shown[0] ? (
      <img src={shown[0]} alt="" className="h-10 w-10 rounded-full object-cover" />
    ) : (
      <span className="h-10 w-10 rounded-full bg-muted" />
    )
  }
  // Overlapping discs: one address, several networks.
  return (
    <span className="relative flex h-10 w-10 items-center">
      {shown.map((src, i) => (
        <span
          key={i}
          className="absolute h-7 w-7 overflow-hidden rounded-full border-2 border-card bg-muted"
          style={{ left: i * 7, top: i % 2 === 0 ? 2 : 10 }}
        >
          {src && <img src={src} alt="" className="h-full w-full object-cover" />}
        </span>
      ))}
    </span>
  )
}

function AddressRow({
  icon,
  title,
  subtitle,
  caption,
  copied,
  onCopy,
  onQr,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  caption?: string
  copied: boolean
  onCopy?: () => void
  onQr?: () => void
}) {
  const available = !!onCopy
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p
          className={`truncate text-xs ${available ? 'font-mono text-muted-foreground' : 'text-muted-foreground'}`}
        >
          {subtitle}
        </p>
        {caption && <p className="truncate text-[11px] text-muted-foreground/80">{caption}</p>}
      </div>
      {available && (
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={onQr}
            aria-label={`Show ${title} QR code`}
            className="cursor-pointer rounded-full bg-muted p-2 text-foreground transition-colors hover:bg-muted/70"
          >
            <QrCode size={16} />
          </button>
          <button
            onClick={onCopy}
            aria-label={`Copy ${title} address`}
            className={`cursor-pointer rounded-full p-2 transition-colors ${
              copied
                ? 'bg-green-500/15 text-green-600'
                : 'bg-muted text-foreground hover:bg-muted/70'
            }`}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      )}
    </div>
  )
}
