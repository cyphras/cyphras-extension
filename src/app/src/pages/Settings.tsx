import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import {
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Globe,
  Lock,
  AppWindow,
  Info,
  ExternalLink,
  MessageSquare,
  X,
} from 'lucide-react'

const VERSION = __APP_VERSION__

const LINKS = [
  { label: 'Terms of Service', url: 'https://cyphras.com/terms' },
  { label: 'Privacy Policy', url: 'https://cyphras.com/privacy' },
  { label: 'Visit Website', url: 'https://cyphras.com' },
]

const FEEDBACK_URL = 'https://cyphras.com/feedback'

interface GroupRowProps {
  icon: React.ElementType
  title: string
  subtitle?: string
  onClick: () => void
  variant?: 'default' | 'destructive'
}

function GroupRow({ icon: Icon, title, subtitle, onClick, variant = 'default' }: GroupRowProps) {
  const isDestructive = variant === 'destructive'
  return (
    <button
      onClick={onClick}
      className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
    >
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0 ${isDestructive ? 'bg-destructive/10' : 'bg-primary/10'}`}
      >
        <Icon size={16} className={isDestructive ? 'text-destructive' : 'text-primary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${isDestructive ? 'text-destructive' : 'text-foreground'}`}
        >
          {title}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <ChevronRight
        size={16}
        className={`flex-shrink-0 ${isDestructive ? 'text-destructive/50' : 'text-muted-foreground'}`}
      />
    </button>
  )
}

function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${open ? '' : 'pointer-events-none'}`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">About Cyphras</p>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-8 flex flex-col items-center gap-1 text-center">
          <img
            src="/icon.svg"
            alt="Cyphras"
            className="h-12 w-12 mb-3 rounded-xl"
            draggable={false}
          />
          <img src="/logo.svg" alt="Cyphras" className="h-5 w-auto dark:invert" draggable={false} />
          <p className="text-sm text-muted-foreground mt-0.5">Version {VERSION}</p>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-2">
          {LINKS.map(({ label, url }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl bg-card px-4 py-3.5 hover:bg-muted transition-colors"
            >
              <span className="text-sm font-medium text-foreground">{label}</span>
              <ExternalLink size={14} className="text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { lockWallet } = useWallet()
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <Layout
      footer={
        <Button
          variant="outline"
          className="w-full text-destructive hover:text-destructive border-destructive/20 hover:bg-destructive/5"
          onClick={lockWallet}
        >
          <Lock size={15} className="mr-2" />
          Lock Wallet
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Settings</h2>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <GroupRow
            icon={SlidersHorizontal}
            title="Preferences"
            onClick={() => navigate('/settings/preferences')}
          />
          <GroupRow
            icon={Lock}
            title="Security & Privacy"
            onClick={() => navigate('/settings/security')}
          />
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <GroupRow icon={Globe} title="Networks" onClick={() => navigate('/settings/networks')} />
          <GroupRow
            icon={AppWindow}
            title="Connected Apps"
            onClick={() => navigate('/settings/connected-apps')}
          />
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          <GroupRow
            icon={MessageSquare}
            title="Send Feedback"
            onClick={() => window.open(FEEDBACK_URL, '_blank', 'noopener,noreferrer')}
          />
          <GroupRow icon={Info} title="About Cyphras" onClick={() => setAboutOpen(true)} />
        </div>
      </div>

      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Layout>
  )
}
