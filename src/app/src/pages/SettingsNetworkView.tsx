import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useNetwork } from '@/context/NetworkContext'
import { Layout } from '@/components/Layout'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronLeft, Copy, Check, Pencil, Trash2, Globe, Server, MoreVertical } from 'lucide-react'
import type { NetworkConfig } from '@constants/networks'
import { Button } from '@/components/ui/button'

function NetworkIcon({ network }: { network: NetworkConfig }) {
  if (network.id === 'mainnet') return <Globe size={16} className="text-green-500" />
  if (network.friendbotUrl) return <Globe size={16} className="text-amber-400" />
  return <Server size={16} className="text-blue-400" />
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xs font-mono text-foreground break-all">{value}</p>
      </div>
      <button
        onClick={handleCopy}
        className="cursor-pointer mt-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

export default function SettingsNetworkView() {
  const navigate = useNavigate()
  const { networkId } = useParams<{ networkId: string }>()
  const { networks, removeNetwork } = useNetwork()

  const network = networks.find((n) => n.id === networkId)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  // Redirect as an effect, not during render, so a removed/unknown network does not update routing
  // state while rendering.
  useEffect(() => {
    if (!network) navigate('/settings/networks', { replace: true })
  }, [network, navigate])

  if (!network) return null

  async function handleRemove() {
    if (!network) return
    setRemoving(true)
    const result = await removeNetwork(network.id)
    setRemoving(false)
    if (result.error) {
      setError(result.error)
      setConfirming(false)
      return
    }
    navigate(-1)
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <NetworkIcon network={network} />
            <h2 className="text-lg font-bold text-foreground">{network.name}</h2>
          </div>
          {!network.isDefault && (
            <div className="absolute right-0">
              <Popover>
                <PopoverTrigger asChild>
                  <button className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  <button
                    onClick={() => navigate(`/settings/network/edit/${network.id}`)}
                    className="cursor-pointer flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <Pencil size={14} className="text-muted-foreground" />
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirming(true)}
                    className="cursor-pointer flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <ConfigRow label="Horizon URL" value={network.horizonUrl} />
          <ConfigRow label="Soroban RPC" value={network.sorobanRpcUrl} />
          <ConfigRow label="Passphrase" value={network.passphrase} />
          {network.friendbotUrl && <ConfigRow label="Friendbot" value={network.friendbotUrl} />}
          {network.explorerUrl && <ConfigRow label="Explorer" value={network.explorerUrl} />}
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirming(false)} />
          <div className="relative w-full max-w-xs rounded-2xl bg-background p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">Remove network?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {network.name} will be removed from your networks.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={removing}
                onClick={handleRemove}
              >
                {removing ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
