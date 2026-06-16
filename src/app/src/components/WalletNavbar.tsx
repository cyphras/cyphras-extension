import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useWindowMode } from '@/hooks/useWindowMode'
import { StellarAvatar } from '@/components/StellarAvatar'
import AccountSwitcher from '@/components/AccountSwitcher'
import NetworkPicker from '@/components/NetworkPicker'
import { Settings, ChevronDown, PanelRight, PanelRightClose } from 'lucide-react'

function networkDotColor(networkId: string, hasFriendbot: boolean) {
  if (networkId === 'mainnet') return 'bg-green-500'
  if (hasFriendbot) return 'bg-amber-400'
  return 'bg-blue-400'
}

export default function WalletNavbar() {
  const navigate = useNavigate()
  const { status, accounts } = useWallet()
  const { activeNetwork } = useNetwork()
  const { isSidePanelOpen, openSidePanel, closeSidePanel } = useWindowMode()
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false)
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false)

  const activeAccount = accounts.find((a) => a.publicKey === status.publicKey)
  const hasCustomLabel = !!activeAccount?.label
  const dotColor = networkDotColor(activeNetwork.id, !!activeNetwork.friendbotUrl)

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <button
            onClick={() => accounts.length > 0 && setAccountSwitcherOpen(true)}
            aria-label="Switch account"
            aria-haspopup="dialog"
            aria-expanded={accountSwitcherOpen}
            className={`flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors min-w-0 ${
              accounts.length > 0 ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
            }`}
          >
            {status.publicKey && (
              <StellarAvatar publicKey={status.publicKey} size={24} className="shrink-0" />
            )}
            <div className="flex flex-col items-start min-w-0">
              <div className="flex items-center gap-1 max-w-full">
                {hasCustomLabel ? (
                  <span className="text-sm font-semibold text-foreground leading-tight truncate max-w-[140px]">
                    {activeAccount.label}
                  </span>
                ) : (
                  <img
                    src="/logo.svg"
                    alt="Cyphras"
                    className="h-[18px] w-auto dark:invert"
                    draggable={false}
                  />
                )}
                {accounts.length > 0 && (
                  <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setNetworkPickerOpen(true)
                }}
                aria-label={`Network: ${activeNetwork.name}. Change network`}
                aria-haspopup="dialog"
                aria-expanded={networkPickerOpen}
                className="cursor-pointer flex items-center gap-1.5 rounded-md px-0.5 -mx-0.5 hover:bg-muted transition-colors"
              >
                <div className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
                <span className="text-xs text-muted-foreground">{activeNetwork.name}</span>
              </button>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={isSidePanelOpen ? closeSidePanel : openSidePanel}
            aria-label={isSidePanelOpen ? 'Close side panel' : 'Open side panel'}
            aria-pressed={isSidePanelOpen}
            className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {isSidePanelOpen ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
          </button>
        </div>
      </div>

      <AccountSwitcher isOpen={accountSwitcherOpen} onClose={() => setAccountSwitcherOpen(false)} />
      <NetworkPicker isOpen={networkPickerOpen} onClose={() => setNetworkPickerOpen(false)} />
    </>
  )
}
