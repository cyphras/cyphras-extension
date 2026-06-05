import { useMemo } from 'react'
import createStellarIdenticon from 'stellar-identicon-js'

interface StellarAvatarProps {
  publicKey: string
  size?: number
  className?: string
}

export function StellarAvatar({ publicKey, size = 32, className = '' }: StellarAvatarProps) {
  const src = useMemo(() => {
    try {
      // size*7 = one canvas px per grid cell at display scale - crisp with pixelated rendering
      const res = size * 7
      return createStellarIdenticon(publicKey, { width: res, height: res }).toDataURL()
    } catch {
      return ''
    }
  }, [publicKey, size])

  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      className={`flex-shrink-0 ${className}`}
    />
  )
}
