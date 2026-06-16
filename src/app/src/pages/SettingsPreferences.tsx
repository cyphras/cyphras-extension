import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Sun,
  Globe2,
  EyeOff,
  PanelRight,
  Languages,
} from 'lucide-react'
import { usePreferences } from '@/context/PreferencesContext'
import { Toggle } from '@/components/ui/toggle'

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }
const EXPLORER_LABELS = { 'stellar.expert': 'Stellar.expert', stellarchain: 'StellarChain' }

export default function SettingsPreferences() {
  const navigate = useNavigate()
  const {
    currency,
    theme,
    explorer,
    hideSmallPayments,
    setHideSmallPayments,
    sidebarByDefault,
    setSidebarByDefault,
  } = usePreferences()

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
          <h2 className="text-lg font-bold text-foreground">Preferences</h2>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <button
            onClick={() => navigate('/settings/preferences/language')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Languages size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Language</p>
            <span className="text-xs text-muted-foreground mr-2">English</span>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/preferences/currency')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <DollarSign size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Currency</p>
            <span className="text-xs text-muted-foreground mr-2">{currency}</span>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/preferences/theme')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Sun size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Theme</p>
            <span className="text-xs text-muted-foreground mr-2">{THEME_LABELS[theme]}</span>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>

          <button
            onClick={() => navigate('/settings/preferences/explorer')}
            className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Globe2 size={16} className="text-primary" />
            </div>
            <p className="flex-1 text-sm font-medium text-foreground">Block Explorer</p>
            <span className="text-xs text-muted-foreground mr-2">{EXPLORER_LABELS[explorer]}</span>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <div className="flex w-full items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <PanelRight size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Open Side Panel by Default</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Open as side panel when clicking the extension icon
              </p>
            </div>
            <Toggle
              checked={sidebarByDefault}
              onChange={() => setSidebarByDefault(!sidebarByDefault)}
            />
          </div>

          <div className="flex w-full items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <EyeOff size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Hide Small Payments</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hide transactions with small amounts in history
              </p>
            </div>
            <Toggle
              checked={hideSmallPayments}
              onChange={() => setHideSmallPayments(!hideSmallPayments)}
            />
          </div>
        </div>
      </div>
    </Layout>
  )
}
