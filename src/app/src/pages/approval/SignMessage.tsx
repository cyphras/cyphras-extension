import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { MessageSquare } from 'lucide-react'
import { APPROVAL_PAYLOAD_STORAGE_KEY } from '@constants/external'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function SignMessage() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [message, setMessage] = useState('')
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
      setMessage(payload?.message ?? '')
    })
  }, [])

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
        icon={<MessageSquare size={28} className="text-primary" />}
        title="Sign Message"
        subtitle="Review this message before signing"
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

      {message && (
        <div className="rounded-xl bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground">Message</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-foreground break-all leading-relaxed whitespace-pre-wrap">
              {message}
            </p>
          </div>
        </div>
      )}

      <TrustNote>Only sign messages from sites you trust</TrustNote>
    </ApprovalShell>
  )
}
