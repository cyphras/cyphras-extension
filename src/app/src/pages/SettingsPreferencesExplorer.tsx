import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Check } from 'lucide-react'
import { usePreferences, type Explorer } from '@/context/PreferencesContext'

const OPTIONS: { value: Explorer; label: string; sub: string }[] = [
  { value: 'stellar.expert', label: 'Stellar.expert', sub: 'stellar.expert' },
  { value: 'stellarchain', label: 'StellarChain', sub: 'stellarchain.io' },
]

export default function SettingsPreferencesExplorer() {
  const navigate = useNavigate()
  const { explorer, setExplorer } = usePreferences()

  function handleSelect(value: Explorer) {
    setExplorer(value)
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
          <h2 className="text-lg font-bold text-foreground">Block Explorer</h2>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className="cursor-pointer flex w-full items-center justify-between px-4 py-3 hover:bg-muted transition-colors text-left"
            >
              <div className="flex flex-col gap-0.5">
                <p
                  className={`text-sm ${explorer === opt.value ? 'font-medium text-primary' : 'text-foreground'}`}
                >
                  {opt.label}
                </p>
                <p className="text-xs text-muted-foreground">{opt.sub}</p>
              </div>
              {explorer === opt.value && <Check size={16} className="text-primary" />}
            </button>
          ))}
        </div>
      </div>
    </Layout>
  )
}
