import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'

// Circle's own mark from its press brand kit, credited wherever CCTP moves funds.
export function CircleMark({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <img src="/brand/circle.svg" alt="Circle" className={`inline-block shrink-0 ${className}`} />
  )
}

export function CctpCredit({
  className = '',
  label = 'Circle CCTP',
}: {
  className?: string
  label?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <CircleMark />
      {label}
    </span>
  )
}

export function RoutePath({ codes }: { codes: string[] }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-0.5 font-medium text-foreground">
      {codes.map((code, i) => (
        <Fragment key={`${code}-${i}`}>
          {i > 0 && <ChevronRight size={11} className="shrink-0 text-muted-foreground" />}
          <span>{code}</span>
        </Fragment>
      ))}
    </span>
  )
}
