import { AlertTriangle, RefreshCw } from 'lucide-react'

interface AlertProps {
  message: string
  onRetry?: () => void
  retrying?: boolean
}

export function Alert({ message, onRetry, retrying }: AlertProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 px-3.5 py-3">
      <AlertTriangle size={14} className="text-destructive mt-0.5 shrink-0" />
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <p className="text-xs text-destructive">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="cursor-pointer flex items-center gap-1.5 self-start rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
