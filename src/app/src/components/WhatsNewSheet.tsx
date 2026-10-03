import type { ComponentType } from 'react'
import { ArrowLeftRight, Layers, ShieldCheck, Wallet } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/ui/button'

const ITEMS: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  body: string
}[] = [
  {
    icon: Wallet,
    title: 'Bitcoin and Ethereum in one wallet',
    body: 'Your recovery phrase now also opens Bitcoin and Ethereum addresses. Find them in Receive.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Bring USDC to Stellar',
    body: 'Move USDC from Ethereum to Stellar, and back, with Circle CCTP. Native USDC, never wrapped.',
  },
  {
    icon: ShieldCheck,
    title: 'Safer swaps',
    body: 'A warning before a swap or bridge loses value, and the quote you review is the one you sign.',
  },
  {
    icon: Layers,
    title: 'One portfolio, every network',
    body: 'Balances and history from each network in one list, with a filter and your pick of block explorer.',
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
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3 rounded-xl bg-card px-4 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon size={16} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        {/* pinned to the bottom of the sheet, so closing never needs a scroll first */}
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-background pt-1">
          <Button variant="outline" className="w-full" onClick={onShowAddress}>
            My addresses
          </Button>
          <Button className="w-full" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
