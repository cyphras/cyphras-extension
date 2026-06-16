import { Children, cloneElement, isValidElement } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface AutoSkeletonProps {
  loading: boolean
  children: React.ReactNode
  className?: string
}

function skeletonFromElement(element: React.ReactElement): React.ReactNode {
  const type = element.type
  const props = element.props as Record<string, unknown>
  const className = (props.className as string) ?? ''

  if (
    type === 'p' ||
    type === 'span' ||
    type === 'h1' ||
    type === 'h2' ||
    type === 'h3' ||
    type === 'h4'
  ) {
    return <Skeleton className={`h-4 w-3/4 rounded ${className}`} />
  }

  if (
    type === 'button' ||
    (typeof type === 'function' && (type as React.FC).displayName === 'Button')
  ) {
    return <Skeleton className={`h-9 w-full rounded-lg ${className}`} />
  }

  if (type === 'img') {
    // Mirror the image's own size classes (avatars range ~14-40px) so the skeleton does not jump to a
    // fixed size and shift the layout; fall back only when the element carries no sizing.
    return <Skeleton className={className ? `rounded-full ${className}` : 'h-10 w-10 rounded-full'} />
  }

  if (type === 'input' || type === 'textarea') {
    return <Skeleton className={`h-10 w-full rounded-lg ${className}`} />
  }

  if (props.children) {
    const cloned = cloneElement(element, {
      ...props,
      children: skeletonChildren(props.children as React.ReactNode),
    } as Record<string, unknown>)
    return cloned
  }

  return <Skeleton className={`h-4 w-full rounded ${className}`} />
}

function skeletonChildren(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    return skeletonFromElement(child as React.ReactElement)
  })
}

export function AutoSkeleton({ loading, children, className }: AutoSkeletonProps) {
  if (!loading) return <>{children}</>

  return <div className={`animate-pulse ${className ?? ''}`}>{skeletonChildren(children)}</div>
}
