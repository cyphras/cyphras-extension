import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { KeyRound, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { APPROVAL_PAYLOAD_STORAGE_KEY } from '@constants/external'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function SignAuthEntry() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [entryXdr, setEntryXdr] = useState('')
  const [showXdr, setShowXdr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

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
      if (payload?.origin) setOrigin(payload.origin)
      setEntryXdr(payload?.entryXdr ?? '')
    })
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(entryXdr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function respond(approved: boolean) {
    setLoading(true)
    chrome.runtime.sendMessage({ type: 'APPROVAL_RESPONSE', id: requestId, approved }, () =>
      window.close()
    )
  }

  return (
    <ApprovalShell
      origin={origin}
      loading={loading}
      primary={{
        label: 'Authorize',
        loadingLabel: 'Authorizing...',
        onClick: () => respond(true),
        disabled: !status.publicKey,
      }}
      secondary={{ label: 'Reject', onClick: () => respond(false) }}
    >
      <ActionHeader
        icon={<KeyRound size={28} className="text-primary" />}
        title="Authorize Contract"
        subtitle="This site wants you to authorize a Soroban contract call"
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
      </InfoCard>

      {entryXdr && (
        <div className="rounded-xl bg-card overflow-hidden">
          <button
            onClick={() => setShowXdr((p) => !p)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
          >
            <span>Auth Entry XDR</span>
            {showXdr ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showXdr && (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <div className="relative rounded-xl bg-muted p-3">
                <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed pr-7">
                  {entryXdr}
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

      <TrustNote>Authorization is scoped to this specific contract invocation only</TrustNote>
    </ApprovalShell>
  )
}
