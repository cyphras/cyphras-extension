import { useState } from 'react'

// The badge ring is the disc's border, not a flex gap, so it stays an even width on every
// side; a parent on another surface sets --icon-ring so it reads as a cut-out of that surface.
const SIZES = {
  xs: { icon: 'h-8 w-8', disc: 'h-4 w-4', text: 'text-[10px]' },
  sm: { icon: 'h-10 w-10', disc: 'h-[21px] w-[21px]', text: 'text-xs' },
  lg: { icon: 'h-12 w-12', disc: 'h-[23px] w-[23px]', text: 'text-sm' },
} as const

export type AssetIconSize = keyof typeof SIZES

export function XlmIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="76 34 238 238"
      xmlns="http://www.w3.org/2000/svg"
      className={`flex-shrink-0 ${className}`}
    >
      <circle cx="195.1" cy="153.1" r="118.9" fill="black" />
      <path
        fill="white"
        d="M164.1,92.3c22.9-11.7,50.4-9.5,71.1,5.6l-1.7,0.9l-11.1,5.7c-17.3-9.7-38.4-9.4-55.5,0.6
 c-17.1,10-27.6,28.3-27.6,48.2c0,2.4,0.2,4.9,0.5,7.3l93.9-47.8l19.4-9.9l22.8-11.6v13.9l-23,11.7l-11.1,5.7l-99,50.4l-5.5,2.8
 l-5.6,2.9l-17.3,8.8v-13.9l5.9-3c4.5-2.3,7.1-7,6.7-12c-0.1-1.7-0.2-3.5-0.2-5.2C126.9,127.5,141.3,104,164.1,92.3z"
      />
      <path
        fill="white"
        d="M275.9,119v13.9l-5.9,3c-4.5,2.3-7.1,7-6.7,12c0.1,1.7,0.2,3.5,0.2,5.2c0,25.7-14.4,49.2-37.3,60.8
 s-50.4,9.5-71.1-5.6l12.1-6.2l0.7-0.4c17.3,9.7,38.5,9.5,55.6-0.5c17.1-10,27.7-28.4,27.7-48.2c0-2.5-0.2-4.9-0.5-7.3l-94,47.9
 l-19.4,9.9l-22.7,11.6v-13.9l22.9-11.7l11.1-5.7L275.9,119z"
      />
    </svg>
  )
}

interface AssetIconProps {
  code: string
  icon?: string
  chainIcons?: Array<string | undefined>
  size?: AssetIconSize
}

export function AssetIcon({ code, icon, chainIcons, size = 'sm' }: AssetIconProps) {
  const [imgError, setImgError] = useState(false)
  const s = SIZES[size]
  const badges = [...new Set((chainIcons ?? []).filter((c): c is string => !!c))]
  const chainCount = (chainIcons ?? []).length

  const base =
    code === 'XLM' ? (
      <XlmIcon className={s.icon} />
    ) : icon && !imgError ? (
      <img
        src={icon}
        alt={code}
        className={`${s.icon} rounded-full object-cover`}
        onError={() => setImgError(true)}
      />
    ) : (
      <div className={`${s.icon} rounded-full bg-muted flex items-center justify-center`}>
        <span className={`${s.text} font-bold text-muted-foreground`}>
          {code.slice(0, 2).toUpperCase()}
        </span>
      </div>
    )

  return (
    <div className="relative flex-shrink-0">
      {base}
      {chainCount > 1 ? (
        <span
          className={`absolute -bottom-1 -right-0.5 ${s.disc} flex items-center justify-center rounded-full border-[1.5px] border-[var(--icon-ring,var(--card))] transition-colors group-hover:border-[color-mix(in_oklab,var(--muted)_60%,var(--card))] bg-foreground text-[10px] font-bold leading-none text-background`}
        >
          {chainCount}
        </span>
      ) : badges[0] ? (
        <div
          className={`absolute -bottom-1 -right-0.5 ${s.disc} overflow-hidden rounded-full border-[1.5px] border-[var(--icon-ring,var(--card))] transition-colors group-hover:border-[color-mix(in_oklab,var(--muted)_60%,var(--card))]`}
        >
          <img src={badges[0]} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}
    </div>
  )
}
