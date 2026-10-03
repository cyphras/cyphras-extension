import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Check } from 'lucide-react'
import { usePreferences } from '@/context/PreferencesContext'
import { getChainIcons } from '@/lib/chainInfo'
import {
  BTC_EXPLORERS,
  EVM_EXPLORERS,
  STELLAR_EXPLORERS,
  type ExplorerOption,
} from '@/lib/explorers'
import { BTC_MAINNET_CHAIN } from '@constants/chains'

function ExplorerGroup<T extends string>({
  title,
  icon,
  options,
  value,
  onSelect,
}: {
  title: string
  icon?: string
  options: ExplorerOption<T>[]
  value: T
  onSelect: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="pixel-label flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        {icon && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full" />}
        {title}
      </p>
      <div className="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted"
          >
            <div className="flex flex-col gap-0.5">
              <p
                className={`text-sm ${value === opt.value ? 'font-medium text-primary' : 'text-foreground'}`}
              >
                {opt.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {opt.note ? `${opt.host}, ${opt.note.toLowerCase()}` : opt.host}
              </p>
            </div>
            {value === opt.value && <Check size={16} className="pop-enter text-primary" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SettingsPreferencesExplorer() {
  const navigate = useNavigate()
  const { explorer, setExplorer, evmExplorer, setEvmExplorer, btcExplorer, setBtcExplorer } =
    usePreferences()
  const [icons, setIcons] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    getChainIcons(['stellar:pubnet', 'eip155:1', BTC_MAINNET_CHAIN]).then(setIcons)
  }, [])

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
          <h2 className="text-lg font-bold text-foreground">Block Explorer</h2>
        </div>

        <ExplorerGroup
          title="Stellar"
          icon={icons.get('stellar:pubnet')}
          options={STELLAR_EXPLORERS}
          value={explorer}
          onSelect={setExplorer}
        />
        <ExplorerGroup
          title="Ethereum"
          icon={icons.get('eip155:1')}
          options={EVM_EXPLORERS}
          value={evmExplorer}
          onSelect={setEvmExplorer}
        />
        <ExplorerGroup
          title="Bitcoin"
          icon={icons.get(BTC_MAINNET_CHAIN)}
          options={BTC_EXPLORERS}
          value={btcExplorer}
          onSelect={setBtcExplorer}
        />
      </div>
    </Layout>
  )
}
