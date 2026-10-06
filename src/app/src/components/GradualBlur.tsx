type Curve = 'linear' | 'bezier' | 'ease-in' | 'ease-out'

const CURVES: Record<Curve, (p: number) => number> = {
  linear: (p) => p,
  bezier: (p) => p * p * (3 - 2 * p),
  'ease-in': (p) => p * p,
  'ease-out': (p) => 1 - Math.pow(1 - p, 2),
}

interface GradualBlurProps {
  visible?: boolean
  height?: string
  strength?: number
  divCount?: number
  curve?: Curve
  exponential?: boolean
  opacity?: number
  zIndex?: number
}

export function GradualBlur({
  visible = false,
  height = '4rem',
  strength = 1.3,
  divCount = 5,
  curve = 'bezier',
  exponential = false,
  opacity = 1,
  zIndex = 30,
}: GradualBlurProps) {
  const increment = 100 / divCount
  const curveFn = CURVES[curve]

  const layers = Array.from({ length: divCount }, (_, idx) => {
    const i = idx + 1
    const progress = curveFn(i / divCount)
    const blur = exponential
      ? Math.pow(2, progress * 4) * 0.0625 * strength
      : 0.0625 * (progress * divCount + 1) * strength

    const p1 = Math.round((increment * i - increment) * 10) / 10
    const p2 = Math.round(increment * i * 10) / 10
    const p3 = Math.round((increment * i + increment) * 10) / 10
    const p4 = Math.round((increment * i + increment * 2) * 10) / 10

    let gradient = `transparent ${p1}%, black ${p2}%`
    if (p3 <= 100) gradient += `, black ${p3}%`
    if (p4 <= 100) gradient += `, transparent ${p4}%`
    const mask = `linear-gradient(to bottom, ${gradient})`

    const radius = visible ? `blur(${blur.toFixed(3)}rem)` : 'blur(0.02px)'

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          inset: 0,
          maskImage: mask,
          WebkitMaskImage: mask,
          backdropFilter: radius,
          WebkitBackdropFilter: radius,
          opacity,
          transition: 'backdrop-filter 0.35s ease',
        }}
      />
    )
  })

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        zIndex,
        pointerEvents: 'none',
        isolation: 'isolate',
      }}
    >
      {layers}
    </div>
  )
}
