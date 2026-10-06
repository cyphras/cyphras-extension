import { BadgeCheck } from 'lucide-react'
import { useUiAsset } from '@/hooks/useUiAsset'

// The curated-asset checkmark, served from the admin panel's media library;
// the bundled lucide glyph covers the moment before its first download.
export function VerifiedBadge({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  const src = useUiAsset('verifiedBadge')

  if (src) return <img src={src} alt="Verified asset" className={className} />
  return <BadgeCheck className={`${className} text-primary`} aria-label="Verified asset" />
}
