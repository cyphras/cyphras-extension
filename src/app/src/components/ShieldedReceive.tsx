import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { AddressQr, FullAddress } from '@/components/AddressQr'
import { Alert } from '@/components/Alert'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useWallet } from '@/context/WalletContext'
import { useCopy } from '@/hooks/useCopy'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse } from '@ext-types/index'

// The private mark sits in the QR and the warning where a public address shows its network's logo.
const PRIVATE_MARK = '/icon.svg'

// The account's private address as the public Receive sheet shows an address: its QR, the whole
// address with the parts people compare emphasized, a copy button, and what may be sent to it. The
// keys behind it stay in the background.
export default function ShieldedReceive({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activePublicKey } = useWallet()
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopy()
  // Drops a slow reply for a prior account so it cannot paint after a switch.
  const runIdRef = useRef(0)

  const load = useCallback(() => {
    const runId = ++runIdRef.current
    setError(null)
    setAddress(null)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_RECEIVE_ADDRESS },
      (r: ServiceResponse) => {
        if (runId !== runIdRef.current) return
        if (chrome.runtime.lastError) setError('The extension restarted. Try again.')
        else if (r?.error) setError(r.error)
        else if (r?.shieldedAddress) setAddress(r.shieldedAddress)
      }
    )
  }, [])

  // Read again on account change, the old address cleared first so it never shows for the wrong
  // account.
  useEffect(() => {
    if (open) load()
  }, [open, activePublicKey, load])

  return (
    <BottomSheet open={open} title="Receive privately" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {error ? (
          <div className="w-full">
            <Alert message={error} onRetry={load} />
          </div>
        ) : (
          <>
            {address ? (
              <AddressQr address={address} icon={PRIVATE_MARK} />
            ) : (
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="h-[188px] w-[188px] animate-pulse rounded-lg bg-neutral-200" />
              </div>
            )}

            {address ? (
              // The prefix ends at the separator, the last "1": the data never holds one.
              <FullAddress
                address={address}
                prefix={address.slice(0, address.lastIndexOf('1') + 1)}
              />
            ) : (
              <div className="flex w-full flex-col items-center gap-1.5">
                <Skeleton className="h-3 w-56 rounded" />
                <Skeleton className="h-3 w-40 rounded" />
              </div>
            )}

            <Button
              className="w-full"
              disabled={!address}
              onClick={() => address && copy('private', address)}
            >
              {copied === 'private' ? (
                <Check size={14} className="pop-enter" />
              ) : (
                <Copy size={14} />
              )}
              {copied === 'private' ? 'Copied' : 'Copy'}
            </Button>

            <p className="flex w-full items-start gap-2.5 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-foreground">
              <img
                src={PRIVATE_MARK}
                alt=""
                className="mt-0.5 h-5 w-5 shrink-0 rounded-full object-cover"
              />
              <span>
                Only private payments in the Cyphras pool reach this address. To receive from a
                Stellar wallet, share your Stellar address instead.
              </span>
            </p>

            <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
              Who pays you and how much stay hidden on-chain. Testnet preview: the testnet pool can
              be reset, and its balances do not carry over.
            </p>
          </>
        )}
      </div>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Private address copied to clipboard' : ''}
      </span>
    </BottomSheet>
  )
}
