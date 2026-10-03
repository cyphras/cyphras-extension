import { useNavigate } from 'react-router-dom'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { useAssetList } from '@/hooks/useAssetList'
import type { AssetBalance } from '@/hooks/useBalances'

// A token held on another chain can also exist on Stellar as its own issued
// token. Offered, never added: holding it needs a trustline that locks 0.5 XLM.
export function StellarCounterpart({
  code,
  balances,
  isFunded,
  chainIcons,
}: {
  code: string
  balances: AssetBalance[]
  isFunded: boolean
  chainIcons?: Map<string, string>
}) {
  const navigate = useNavigate()
  const { assets } = useAssetList()
  const matches = assets.filter(
    (a) =>
      a.verified &&
      a.code === code &&
      !balances.some((b) => b.chain === a.chain && b.code === a.code && b.issuer === a.issuer)
  )

  if (matches.length === 0) return null

  return (
    <div className="rounded-xl bg-card mb-4">
      <p className="pixel-label text-[10px] px-4 pt-3 pb-1 text-muted-foreground">
        Also on Stellar
      </p>
      {matches.map((a) => (
        <div key={`${a.code}:${a.issuer}`} className="flex items-center gap-3 px-4 py-2">
          <AssetIcon
            code={a.code}
            icon={a.icon}
            chainIcons={[a.chain ? chainIcons?.get(a.chain) : undefined]}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-medium text-foreground">
              <span className="truncate">{a.name ?? a.code}</span>
              <VerifiedBadge />
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {a.domain ? `Issued by ${a.domain}` : `${a.code} on Stellar`}
            </span>
          </span>
          <button
            disabled={!isFunded}
            onClick={() => navigate('/assets/add', { state: { code: a.code, issuer: a.issuer } })}
            className="shrink-0 cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
          >
            Add
          </button>
        </div>
      ))}
      <p className="px-4 pt-1 pb-3 text-[11px] text-muted-foreground">
        {isFunded
          ? 'A separate token on Stellar. Adding it opens a trustline, which reserves 0.5 XLM.'
          : 'A separate token on Stellar. Activate your Stellar account first, since its trustline reserves 0.5 XLM.'}
      </p>
    </div>
  )
}
