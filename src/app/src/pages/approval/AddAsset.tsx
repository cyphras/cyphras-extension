import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { CirclePlus, Info } from 'lucide-react'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function AddAsset() {
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
        label: 'Add Asset',
        loadingLabel: 'Adding...',
        onClick: () => respond(true),
        disabled: !status.publicKey,
      }}
      secondary={{ label: 'Cancel', onClick: () => respond(false) }}
    >
      <ActionHeader
        icon={<CirclePlus size={28} className="text-primary" />}
        title="Add Asset"
        subtitle="This site wants to add a trustline to your wallet"
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

      <div className="flex gap-2.5 rounded-xl bg-muted/60 border border-border px-3.5 py-3">
        <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Adding this trustline requires a small XLM reserve (~0.5 XLM) and allows your wallet to
          hold {assetCode || 'this asset'}.
        </p>
      </div>

      <TrustNote>Only approve assets from sites you trust</TrustNote>
    </ApprovalShell>
  )
}
