import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { useEvmWatchAssets } from '@/hooks/useEvmWatchAssets'
import { fetchAssetList, type AssetListItem } from '@/lib/assetList'
import { Reveal } from '@/components/Collapse'
import type { AssetBalance } from '@/hooks/useBalances'

const MAX_ROWS = 4

function dismissKey(networkId: string, publicKey: string): string {
  return `cyphras_suggest_dismissed_${networkId}_${publicKey}`
}

function sameIssuer(a: string, b: string): boolean {
  return a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Suggestions are opt-in per token, never automatic: a Stellar trustline locks 0.5 XLM.
export function SuggestedAssets({
  networkId,
  publicKey,
  balances,
  isFunded,
  chainFilter,
  chainIcons,
  chainNames,
  onAdded,
}: {
  networkId: string
  publicKey: string
  balances: AssetBalance[]
  isFunded: boolean
  chainFilter: string | null
  chainIcons: Map<string, string>
  chainNames: Map<string, string>
  onAdded: () => void
}) {
  const navigate = useNavigate()
  const [list, setList] = useState<AssetListItem[]>([])
  const [dismissed, setDismissed] = useState(true)
  const { assets: watched, addAsset } = useEvmWatchAssets(networkId, publicKey)

  useEffect(() => {
    let cancelled = false
    fetchAssetList(networkId, ['stellar', 'evm']).then((items) => {
      if (!cancelled) setList(items)
    })
    const key = dismissKey(networkId, publicKey)
    chrome.storage.local.get(key, (r) => {
      if (!cancelled) setDismissed(r[key] === true)
    })
    return () => {
      cancelled = true
    }
  }, [networkId, publicKey])

  // Only chains the wallet already shows, so a disabled chain never gets suggested.
  const activeChains = new Set(balances.map((b) => b.chain))
  // Tokens the user already holds on another chain lead, e.g. BTC on Stellar for a BTC holder.
  const heldElsewhere = (a: AssetListItem) =>
    balances.some((b) => b.chain !== a.chain && b.code === a.code && parseFloat(b.balance) > 0)
  const items = list
    .filter((a) => a.verified && a.issuer && a.chain && activeChains.has(a.chain))
    .filter((a) => !chainFilter || a.chain === chainFilter)
    .filter((a) => !a.chain?.startsWith('eip155') || a.decimals !== undefined)
    .filter(
      (a) =>
        !balances.some(
          (b) => b.chain === a.chain && b.code === a.code && sameIssuer(b.issuer, a.issuer)
        ) && !watched.some((w) => w.chain === a.chain && sameIssuer(w.address, a.issuer))
    )
    .sort((x, y) => Number(heldElsewhere(y)) - Number(heldElsewhere(x)))
    .slice(0, MAX_ROWS)

  const hasStellar = items.some((a) => a.chain?.startsWith('stellar'))

  // Home's column gap, so dismissing the card closes the space it held too.
  return (
    <Reveal show={!dismissed && items.length > 0} gap={16}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <p className="pixel-label text-[10px] text-muted-foreground">Suggested</p>
          <button
            onClick={() => {
              setDismissed(true)
              chrome.storage.local.set({ [dismissKey(networkId, publicKey)]: true })
            }}
            aria-label="Hide suggestions"
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
        <div className="flex flex-col gap-1 rounded-xl bg-card p-1">
          {items.map((a) => {
            const stellar = a.chain?.startsWith('stellar') ?? false
            const locked = stellar && !isFunded
            const chainName = (a.chain && chainNames.get(a.chain)) ?? (stellar ? 'Stellar' : 'EVM')
            return (
              <div
                key={`${a.chain}:${a.code}:${a.issuer}`}
                className="flex items-center gap-3 px-3 py-2"
              >
                <AssetIcon
                  code={a.code}
                  icon={a.icon}
                  chainIcons={[a.chain ? chainIcons.get(a.chain) : undefined]}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    <span className="truncate">{a.code}</span>
                    <VerifiedBadge />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.name && a.name !== a.code ? `${a.name} on ${chainName}` : `on ${chainName}`}
                  </span>
                </span>
                <button
                  disabled={locked}
                  onClick={async () => {
                    if (stellar) {
                      navigate('/assets/add', { state: { code: a.code, issuer: a.issuer } })
                      return
                    }
                    await addAsset({
                      chain: a.chain as string,
                      address: a.issuer,
                      symbol: a.code,
                      decimals: a.decimals as number,
                    })
                    onAdded()
                  }}
                  className="shrink-0 cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
                >
                  Add
                </button>
              </div>
            )
          })}
        </div>
        {hasStellar && !isFunded && (
          <p className="px-1 text-[11px] text-muted-foreground">
            Stellar tokens need an activated account, since each one reserves 0.5 XLM.
          </p>
        )}
      </div>
    </Reveal>
  )
}
