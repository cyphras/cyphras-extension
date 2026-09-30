import type { ComponentType } from 'react'
import { ArrowLeftRight, Layers, Wallet } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/ui/button'

const ITEMS: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  body: string
}[] = [
  {
    icon: Wallet,
    title: 'Ethereum in the same wallet',
    body: 'Your recovery phrase now also opens an Ethereum address. Find it in Receive.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Bridge USDC',
    body: 'Move USDC between Stellar and Ethereum with Circle CCTP. Native USDC, never wrapped.',
  },
  {
    icon: Layers,
    title: 'One portfolio, every network',
    body: 'Balances and history from each network in one list, with a filter when you want one.',
  },
]

export function WhatsNewSheet({
  open,
  version,
  onClose,
  onShowAddress,
}: {
  open: boolean
  version: string
  onClose: () => void
  onShowAddress: () => void
}) {
  return (
    <BottomSheet open={open} title={`What's new in ${version}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3 rounded-xl bg-card px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon size={17} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="w-full" onClick={onShowAddress}>
            My EVM address
          </Button>
          <Button className="w-full" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
