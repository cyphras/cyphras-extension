import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { useVerifiedAssets } from '@/hooks/useVerifiedAssets'

export function VerifiedMark({
  code,
  issuer,
  className = 'h-3.5 w-3.5',
}: {
  code: string
  issuer?: string
  className?: string
}) {
  const isVerified = useVerifiedAssets()
  if (!isVerified(code, issuer)) return null
  return <VerifiedBadge className={`inline-block shrink-0 align-[-2px] ${className}`} />
}
