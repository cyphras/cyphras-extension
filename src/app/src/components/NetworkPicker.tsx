import { useState } from 'react'
import { X, Check, Loader2, Plus } from 'lucide-react'
import { useNetwork } from '@/context/NetworkContext'
import { useNavigate } from 'react-router-dom'
import type { NetworkConfig } from '@constants/networks'

interface NetworkPickerProps {
  isOpen: boolean
  onClose: () => void
}

function networkDot(network: NetworkConfig) {
  if (network.id === 'mainnet') return 'bg-green-500'
  if (network.friendbotUrl) return 'bg-amber-400'
  return 'bg-blue-400'
}

export default function NetworkPicker({ isOpen, onClose }: NetworkPickerProps) {
  const navigate = useNavigate()
  const { networks, activeNetwork, setActiveNetwork } = useNetwork()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  async function handleSelect(networkId: string) {
    if (networkId === activeNetwork.id || switchingTo) return
    setSwitchingTo(networkId)
    await setActiveNetwork(networkId)
    setSwitchingTo(null)
    onClose()
  }

  function handleManage() {
    onClose()
    navigate('/settings/networks')
  }

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${isOpen ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <span className="text-sm font-semibold text-foreground">Network</span>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col px-3 pb-2">
          {networks.map((network) => {
            const isActive = network.id === activeNetwork.id
            const isSwitching = switchingTo === network.id
            return (
              <button
                key={network.id}
                disabled={isActive || !!switchingTo}
                onClick={() => handleSelect(network.id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors mb-1 ${
                  isActive
                    ? 'bg-primary/10 border border-primary/20 cursor-default'
                    : isSwitching
                      ? 'border border-transparent opacity-60 cursor-default'
                      : 'hover:bg-muted border border-transparent cursor-pointer'
                }`}
              >
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${networkDot(network)}`} />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}
                  >
                    {network.name}
                  </p>
                  {!network.isDefault && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {network.horizonUrl}
                    </p>
                  )}
                </div>
                {isSwitching ? (
                  <Loader2 size={14} className="text-muted-foreground animate-spin flex-shrink-0" />
                ) : isActive ? (
                  <Check size={14} className="text-primary flex-shrink-0" />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="px-3 pb-5">
          <button
            onClick={handleManage}
            className="cursor-pointer flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus size={14} />
            Add / Manage Networks
          </button>
        </div>
      </div>
    </div>
  )
}
