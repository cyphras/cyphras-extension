import { ArrowDownToLine, ArrowUpFromLine, Hourglass } from 'lucide-react'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { Button } from '@/components/ui/button'

// The mainnet vault's limits, stated without reading the vault; the confirm step shows live ones.
const ITEMS = [
  {
    icon: ArrowDownToLine,
    title: 'Deposits are capped',
    body: '1 XLM to 1,000 XLM per deposit, and at most 2,000 XLM a day from one account.',
  },
  {
    icon: Hourglass,
    title: 'Deposits wait for screening',
    body: 'A deposit can be used after 15 min of screening at the earliest, or 6 h from 500 XLM. You can cancel it until then.',
  },
  {
    icon: ArrowUpFromLine,
    title: 'Withdrawals have a daily limit',
    body: 'The pool pays out at most 2,000 XLM a day across all users. Past that, withdrawals wait in a queue and are paid on later days.',
  },
]

// Acknowledged once before mainnet private mode opens a wallet or calls any of its services.
export function MainnetPrivateNotice({
  open,
  onCancel,
  onAcknowledge,
}: {
  open: boolean
  onCancel: () => void
  onAcknowledge: () => void
}) {
  return (
    <ConfirmSheet
      open={open}
      modal
      title="Private payments on mainnet"
      stepKey="mainnet-notice"
      onClose={onCancel}
      onBackdrop={onCancel}
    >
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs leading-snug text-amber-700 dark:text-amber-400">
          Private payments on mainnet are experimental and unaudited. This is real money: use only
          what you can afford to lose.
        </p>
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
      </div>
      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Not now
        </Button>
        <Button className="flex-1" onClick={onAcknowledge}>
          I understand
        </Button>
      </div>
    </ConfirmSheet>
  )
}
