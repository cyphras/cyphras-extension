import { useAppContext } from '@/hooks/useAppContext'

interface LayoutProps {
  children: React.ReactNode
  variant?: 'scroll' | 'centered'
  navbar?: React.ReactNode
  footer?: React.ReactNode
}

export function Layout({ children, variant = 'scroll', navbar, footer }: LayoutProps) {
  const ctx = useAppContext()

  if (ctx === 'tab') {
    if (variant === 'centered') {
      return (
        <div className="flex min-h-screen w-full flex-col items-center bg-background">
          <div className="w-full max-w-md flex flex-1 flex-col items-center justify-center px-6 py-16">
            {children}
          </div>
        </div>
      )
    }
    return (
      <div className="flex min-h-screen w-full flex-col items-center bg-background">
        {navbar && (
          <div className="sticky top-0 z-20 w-full max-w-md px-6 pt-5 pb-3 bg-background/95 backdrop-blur-sm border-b border-border/40">
            {navbar}
          </div>
        )}
        <div className="w-full max-w-md px-6 py-6">{children}</div>
      </div>
    )
  }

  if (variant === 'centered') {
    return (
      <div className="h-full flex flex-col bg-background">
        {navbar && (
          <div className="shrink-0 px-5 pt-5 pb-3 bg-background border-b border-border/40">
            {navbar}
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 w-full overflow-y-auto">
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {navbar && (
        <div className="shrink-0 px-5 pt-5 pb-3 bg-background border-b border-border/40">
          {navbar}
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0 px-5 py-5">{children}</div>
      {footer && <div className="shrink-0 border-t border-border px-5 py-4">{footer}</div>}
    </div>
  )
}
