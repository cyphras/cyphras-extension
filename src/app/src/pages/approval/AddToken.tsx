import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { Cpu, Info } from 'lucide-react'
import { APPROVAL_PAYLOAD_STORAGE_KEY } from '@constants/external'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function AddToken() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [contractId, setContractId] = useState('')
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
      setContractId(payload?.contractId ?? '')
    })
  }, [])

  const shortContract =
    contractId.length > 10 ? `${contractId.slice(0, 4)}...${contractId.slice(-4)}` : contractId

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
        label: 'Add Token',
        loadingLabel: 'Adding...',
        onClick: () => respond(true),
        disabled: !status.publicKey,
      }}
      secondary={{ label: 'Cancel', onClick: () => respond(false) }}
    >
      <ActionHeader
        icon={<Cpu size={28} className="text-primary" />}
        title="Add Token"
        subtitle="This site wants to add a Soroban token to your wallet"
      />

      <InfoCard>
        {status.publicKey && (
          <InfoRow label="Wallet">
            <AddressChip publicKey={status.publicKey} />
          </InfoRow>
        )}
        <InfoRow label="Network">
          <span className="text-sm font-medium text-foreground">{activeNetwork.name}</span>
        </InfoRow>
        {contractId && (
          <InfoRow label="Contract ID">
            <span className="text-xs font-mono text-foreground">{shortContract}</span>
          </InfoRow>
        )}
      </InfoCard>

      <div className="flex gap-2.5 rounded-xl bg-muted/60 border border-border px-3.5 py-3">
        <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Adding this token allows your wallet to display its balance. No funds are moved.
        </p>
      </div>

      <TrustNote>Only approve tokens from sites you trust</TrustNote>
    </ApprovalShell>
  )
}
