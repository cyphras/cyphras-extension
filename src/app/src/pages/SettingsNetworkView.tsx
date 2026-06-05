import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useNetwork } from '@/context/NetworkContext'
import { Layout } from '@/components/Layout'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronLeft, Copy, Check, Pencil, Trash2, Globe, Server, MoreVertical } from 'lucide-react'
import type { NetworkConfig } from '@constants/networks'

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

  if (!network) {
    navigate('/settings/networks')
    return null
  }

  function handleRemove() {
    removeNetwork(network!.id)
    navigate('/settings/networks')
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate('/settings/networks')}
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
                    onClick={handleRemove}
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
      </div>
    </Layout>
  )
}
