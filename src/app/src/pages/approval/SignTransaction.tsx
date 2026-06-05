import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { PenLine, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { TransactionBuilder, Transaction } from '@stellar/stellar-sdk'
import { APPROVAL_PAYLOAD_STORAGE_KEY } from '@constants/external'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function SignTransaction() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [xdr, setXdr] = useState('')
  const [loading, setLoading] = useState(false)
  const [xdrExpanded, setXdrExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [feeXlm, setFeeXlm] = useState<string | null>(null)
  const [operationCount, setOperationCount] = useState<number | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const id = params.get('id') ?? ''
    setRequestId(id)
    setOrigin(params.get('origin') ?? '')

    if (!id) return
    chrome.storage.session?.get(APPROVAL_PAYLOAD_STORAGE_KEY).then((result) => {
      const store = (result?.[APPROVAL_PAYLOAD_STORAGE_KEY] ?? {}) as Record<
        string,
        Record<string, string>
      >
      const payload = store[id]
      const xdrValue = payload?.xdr ?? ''
      if (payload?.origin) setOrigin(payload.origin)
      setXdr(xdrValue)
      if (xdrValue) {
        try {
          const tx = TransactionBuilder.fromXDR(xdrValue, activeNetwork.passphrase)
          const feeStroops = parseInt(tx.fee ?? '0')
          setFeeXlm((feeStroops / 10_000_000).toFixed(7))
          if (tx instanceof Transaction) {
            setOperationCount(tx.operations.length)
          }
        } catch {
          /* malformed XDR */
        }
      }
    })
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(xdr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSign() {
    setLoading(true)
    chrome.runtime.sendMessage({ type: 'APPROVAL_RESPONSE', id: requestId, approved: true }, () =>
      window.close()
    )
  }

  function handleReject() {
    chrome.runtime.sendMessage({ type: 'APPROVAL_RESPONSE', id: requestId, approved: false }, () =>
      window.close()
    )
  }

  return (
    <ApprovalShell
      origin={origin}
      loading={loading}
      primary={{
        label: 'Sign',
        loadingLabel: 'Signing...',
        onClick: handleSign,
        disabled: !status.publicKey,
      }}
      secondary={{ label: 'Reject', onClick: handleReject }}
    >
      <ActionHeader
        icon={<PenLine size={28} className="text-primary" />}
        title="Sign Transaction"
        subtitle="Review this transaction before signing"
      />

      <InfoCard>
        {status.publicKey && (
          <InfoRow label="Signing as">
            <AddressChip publicKey={status.publicKey} />
          </InfoRow>
        )}
        <InfoRow label="Network">
          <span className="text-sm font-medium text-foreground">{activeNetwork.name}</span>
        </InfoRow>
        {feeXlm && (
          <InfoRow label="Network fee">
            <span className="text-sm font-medium text-foreground">{feeXlm} XLM</span>
          </InfoRow>
        )}
        {operationCount !== null && (
          <InfoRow label="Operations">
            <span className="text-sm font-medium text-foreground">{operationCount}</span>
          </InfoRow>
        )}
      </InfoCard>

      {xdr && (
        <div className="rounded-xl bg-card overflow-hidden">
          <button
            onClick={() => setXdrExpanded((p) => !p)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
          >
            <span>Transaction XDR</span>
            {xdrExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {xdrExpanded && (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <div className="relative rounded-xl bg-muted p-3">
                <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-7">
                  {xdr}
                </p>
                <button
                  onClick={handleCopy}
                  className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Copy XDR"
                >
                  {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <TrustNote>Only sign transactions from sites you trust</TrustNote>
    </ApprovalShell>
  )
}
