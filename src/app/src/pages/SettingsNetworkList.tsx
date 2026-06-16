import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNetwork } from '@/context/NetworkContext'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Layout } from '@/components/Layout'
import { ChevronLeft, ChevronRight, ChevronsUpDown, Check, Plus, Globe, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NetworkConfig } from '@constants/networks'

function NetworkIcon({ network, size = 14 }: { network: NetworkConfig; size?: number }) {
  if (network.id === 'mainnet') {
    return <Globe size={size} className="text-green-500" />
  }
  if (network.friendbotUrl) {
    return <Globe size={size} className="text-amber-400" />
  }
  return <Server size={size} className="text-blue-400" />
}

export default function SettingsNetworkList() {
  const navigate = useNavigate()
  const { networks, activeNetwork, setActiveNetwork } = useNetwork()
  const [open, setOpen] = useState(false)

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
          <h2 className="text-lg font-bold text-foreground">Networks</h2>
        </div>

        {/* Active network combobox */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Active Network
          </p>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                role="combobox"
                aria-expanded={open}
                className="cursor-pointer flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 hover:bg-muted transition-colors text-left"
              >
                <NetworkIcon network={activeNetwork} size={16} />
                <span className="flex-1 text-sm font-medium text-foreground">
                  {activeNetwork.name}
                </span>
                <ChevronsUpDown size={14} className="text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandList>
                  <CommandEmpty>No networks found.</CommandEmpty>
                  <CommandGroup>
                    {networks.map((n) => (
                      <CommandItem
                        key={n.id}
                        value={n.id}
                        onSelect={() => {
                          setActiveNetwork(n.id)
                          setOpen(false)
                        }}
                      >
                        <NetworkIcon network={n} size={14} />
                        <span
                          className={cn(
                            'flex-1 text-sm',
                            n.id === activeNetwork.id ? 'font-semibold' : 'font-medium'
                          )}
                        >
                          {n.name}
                        </span>
                        <Check
                          size={14}
                          className={cn(
                            'text-primary',
                            n.id === activeNetwork.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Network list */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            All Networks
          </p>
          <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
            {networks.map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(`/settings/network/view/${n.id}`)}
                className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
              >
                <NetworkIcon network={n} size={16} />
                <p className="flex-1 text-sm font-medium text-foreground">{n.name}</p>
                <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate('/settings/network/add')}
        >
          <Plus size={16} />
          Add network
        </Button>
      </div>
    </Layout>
  )
}
