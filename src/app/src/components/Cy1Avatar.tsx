import { useMemo } from 'react'

// cy1 identicon: 7x7 horizontally-symmetric grid, byte[0] picks the color and the rest drive the mirrored pattern
const GRID = 7
const HALF = Math.ceil(GRID / 2)

// FNV-1a seed expanded with xorshift into n deterministic bytes for one cy1 string.
function bytesFromString(s: string, n: number): Uint8Array {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const out = new Uint8Array(n)
  let x = h || 1
  for (let i = 0; i < n; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    out[i] = x & 0xff
  }
  return out
}

// Same HSV->RGB + saturation/value as stellar-identicon-js, so the palette matches.
function hsvToRgb(hue: number, s: number, v: number): string {
  const i = Math.floor(hue * 6)
  const f = hue * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r: number
  let g: number
  let b: number
  switch (i % 6) {
    case 0:
      r = v
      g = t
      b = p
      break
    case 1:
      r = q
      g = v
      b = p
      break
    case 2:
      r = p
      g = v
      b = t
      break
    case 3:
      r = p
      g = q
      b = v
      break
    case 4:
      r = t
      g = p
      b = v
      break
    default:
      r = v
      g = p
      b = q
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function getBit(position: number, bytes: Uint8Array): boolean {
  return (bytes[Math.floor(position / 8)] & (1 << (7 - (position % 8)))) !== 0
}

export function Cy1Avatar({
  address,
  size = 22,
  className = '',
}: {
  address: string
  size?: number
  className?: string
}) {
  const { color, cells } = useMemo(() => {
    const bytes = bytesFromString(address, 8)
    const c = hsvToRgb(bytes[0] / 255, 0.7, 0.8)
    const pattern = bytes.slice(1)
    const out: Array<[number, number]> = []
    for (let col = 0; col < HALF; col++) {
      for (let row = 0; row < GRID; row++) {
        if (getBit(col + row * HALF, pattern)) {
          out.push([row, col])
          const mirror = GRID - col - 1
          if (mirror !== col) out.push([row, mirror])
        }
      }
    }
    return { color: c, cells: out }
  }, [address])

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      className={`rounded-sm shrink-0 ${className}`}
      aria-hidden
    >
      {cells.map(([row, col], i) => (
        <rect key={i} x={col} y={row} width={1.02} height={1.02} fill={color} />
      ))}
    </svg>
  )
}
