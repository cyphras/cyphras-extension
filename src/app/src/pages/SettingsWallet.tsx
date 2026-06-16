import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft } from 'lucide-react'

export default function SettingsWallet() {
  const navigate = useNavigate()
  const { lockWallet } = useWallet()

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
          <h2 className="text-lg font-bold text-foreground">Wallet</h2>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Session
          </p>
          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            onClick={lockWallet}
          >
            Lock wallet
          </Button>
        </div>
      </div>
    </Layout>
  )
}
