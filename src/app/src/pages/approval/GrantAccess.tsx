import { useEffect, useState } from 'react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { Link, AlertTriangle, ArrowRight, Check } from 'lucide-react'
import { ApprovalShell, ActionHeader, InfoCard, InfoRow, TrustNote, AddressChip } from './_shell'

export default function GrantAccess() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const [origin, setOrigin] = useState('')
  const [requestId, setRequestId] = useState('')
  const [requestedNetwork, setRequestedNetwork] = useState('')
  const [networkMismatch, setNetworkMismatch] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    setOrigin(params.get('origin') ?? '')
    setRequestId(params.get('id') ?? '')
    setRequestedNetwork(params.get('requestedNetwork') ?? '')
    setNetworkMismatch(params.get('networkMismatch') === 'true')
  }, [])

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  function handleGrant() {
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
        label: networkMismatch ? 'Switch & Connect' : 'Connect',
        loadingLabel: 'Connecting...',
        onClick: handleGrant,
        disabled: !status.publicKey,
      }}
      secondary={{ label: 'Cancel', onClick: handleReject }}
    >
      <ActionHeader
        icon={<Link size={28} className="text-primary" />}
        title="Connection Request"
        subtitle="This site is requesting access to your wallet"
      />

      {networkMismatch && (
        <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-foreground">Network switch required</p>
            <p className="text-xs text-muted-foreground">
              This dApp requires{' '}
              <span className="font-medium text-foreground">{capitalize(requestedNetwork)}</span>.
              Connecting will switch your wallet network.
            </p>
          </div>
        </div>
      )}

      <InfoCard>
        {status.publicKey && (
          <InfoRow label="Wallet">
            <AddressChip publicKey={status.publicKey} />
          </InfoRow>
        )}
        <InfoRow label="Network">
          {networkMismatch ? (
            <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
              {activeNetwork.name}
              <ArrowRight size={12} className="text-muted-foreground shrink-0" />
              {capitalize(requestedNetwork)}
            </span>
          ) : (
            <span className="text-sm font-medium text-foreground">{activeNetwork.name}</span>
          )}
        </InfoRow>
      </InfoCard>

      <div className="rounded-xl bg-muted/60 px-4 py-3 flex flex-col gap-2">
        <p className="text-xs font-semibold text-foreground">Permissions requested</p>
        {[
          'View your wallet address and balance',
          'View your network and transaction history',
          'Request transaction signing approval',
        ].map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={12} className="text-primary mt-0.5 shrink-0" />
            {item}
          </div>
        ))}
      </div>

      <TrustNote>Only connect to sites you trust</TrustNote>
    </ApprovalShell>
  )
}
