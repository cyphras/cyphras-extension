import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Globe, Trash2 } from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'

export default function ConnectedApps() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [error, setError] = useState('')

  function fetchApps() {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_CONNECTED_APPS }, (response) => {
      if (chrome.runtime.lastError) {
        setError('Could not load connected apps.')
        setLoading(false)
        return
      }
      setError('')
      setApps(response?.connectedApps ?? [])
      setLoading(false)
    })
  }

  useEffect(() => {
    fetchApps()
  }, [])

  function handleRevoke(origin: string) {
    setRevoking(origin)
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.REVOKE_ACCESS, origin }, () => {
      setRevoking(null)
      fetchApps()
    })
  }

  function handleRevokeAll() {
    setRevoking('all')
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.REVOKE_ALL_ACCESS }, () => {
      setRevoking(null)
      fetchApps()
    })
  }

  return (
    <Layout>
      <div className="flex flex-col gap-4">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Connected Apps</h2>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => {
                setLoading(true)
                fetchApps()
              }}
              className="mt-1 cursor-pointer text-xs text-destructive underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && apps.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Globe size={32} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No connected apps</p>
            <p className="text-xs text-muted-foreground">Sites you connect to will appear here</p>
          </div>
        )}

        {!loading && apps.length > 0 && (
          <div className="flex flex-col gap-2">
            {apps.map((origin) => {
              const domain = (() => {
                try {
                  return new URL(origin).host
                } catch {
                  return origin
                }
              })()
              return (
                <div
                  key={origin}
                  className="flex items-center justify-between rounded-xl bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted flex-shrink-0">
                      <Globe size={14} className="text-muted-foreground" />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-sm font-medium text-foreground">{domain}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {origin}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(origin)}
                    disabled={revoking === origin}
                    aria-label={`Revoke access for ${domain}`}
                    className="cursor-pointer rounded p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}

            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleRevokeAll}
              disabled={revoking === 'all'}
            >
              {revoking === 'all' ? 'Disconnecting...' : 'Disconnect all'}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  )
}
