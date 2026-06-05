import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { Trash2, AlertTriangle } from 'lucide-react'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function RemoveAsset() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [assetCode, setAssetCode] = useState('')
  const [issuer, setIssuer] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    setOrigin(params.get('origin') ?? '')
    setRequestId(params.get('id') ?? '')
    setAssetCode(params.get('assetCode') ?? '')
    setIssuer(params.get('issuer') ?? '')
  }, [])

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
        label: 'Remove Asset',
        loadingLabel: 'Removing...',
        onClick: () => respond(true),
        disabled: !status.publicKey,
        variant: 'destructive',
      }}
      secondary={{ label: 'Cancel', onClick: () => respond(false) }}
    >
      <ActionHeader
        icon={<Trash2 size={28} className="text-destructive" />}
        title="Remove Asset"
        subtitle="This site wants to remove a trustline from your wallet"
        variant="destructive"
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
        <InfoRow label="Asset">
          <span className="text-sm font-mono font-semibold text-foreground">{assetCode}</span>
        </InfoRow>
        {issuer && (
          <InfoRow label="Issuer">
            <AddressChip publicKey={issuer} />
          </InfoRow>
        )}
      </InfoCard>

      <div className="flex gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-3">
        <AlertTriangle size={13} className="text-destructive mt-0.5 shrink-0" />
        <p className="text-xs text-destructive">
          Removing this trustline will permanently remove {assetCode || 'this asset'} from your
          wallet. Any remaining balance will be lost.
        </p>
      </div>

      <TrustNote>Only approve actions from sites you trust</TrustNote>
    </ApprovalShell>
  )
}
