import { cn } from 'src/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-busy="true"
      data-slot="skeleton"
      className={cn('relative overflow-hidden rounded-2xl bg-muted', className)}
      {...props}
    >
      <span className="skeleton-sweep absolute inset-0" aria-hidden="true" />
    </div>
  )
}

export { Skeleton }
