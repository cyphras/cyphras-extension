import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useNetwork } from '@/context/NetworkContext'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft } from 'lucide-react'
import type { NetworkConfig } from '@constants/networks'

function FormField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled = false,
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  disabled?: boolean
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg bg-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

interface NetworkSettingsProps {
  mode: 'add' | 'edit'
}

export default function NetworkSettings({ mode }: NetworkSettingsProps) {
  const navigate = useNavigate()
  const { networkId } = useParams<{ networkId: string }>()
  const { networks, addNetwork, editNetwork } = useNetwork()

  const existingNetwork = mode === 'edit' ? networks.find((n) => n.id === networkId) : null

  const isDefault = existingNetwork?.isDefault ?? false

  const [name, setName] = useState(existingNetwork?.name ?? '')
  const [horizonUrl, setHorizonUrl] = useState(existingNetwork?.horizonUrl ?? '')
  const [sorobanRpcUrl, setSorobanRpcUrl] = useState(existingNetwork?.sorobanRpcUrl ?? '')
  const [passphrase, setPassphrase] = useState(existingNetwork?.passphrase ?? '')
  const [friendbotUrl, setFriendBotUrl] = useState(existingNetwork?.friendbotUrl ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mode === 'edit' && !existingNetwork) {
      navigate('/settings/networks', { replace: true })
    }
  }, [existingNetwork, mode, navigate])

  function validate(): boolean {
    if (!name.trim()) {
      setError('Network name is required')
      return false
    }
    if (!horizonUrl.trim()) {
      setError('Horizon RPC URL is required')
      return false
    }
    if (!sorobanRpcUrl.trim()) {
      setError('Soroban RPC URL is required')
      return false
    }
    if (!passphrase.trim()) {
      setError('Passphrase is required')
      return false
    }
    try {
      new URL(horizonUrl)
    } catch {
      setError('Horizon URL is not valid')
      return false
    }
    try {
      new URL(sorobanRpcUrl)
    } catch {
      setError('Soroban RPC URL is not valid')
      return false
    }
    return true
  }

  async function handleSubmit() {
    if (!validate()) return
    setError('')
    setLoading(true)

    const network: NetworkConfig = {
      id: mode === 'edit' ? existingNetwork!.id : crypto.randomUUID(),
      name: name.trim(),
      horizonUrl: horizonUrl.trim(),
      sorobanRpcUrl: sorobanRpcUrl.trim(),
      passphrase: passphrase.trim(),
      friendbotUrl: friendbotUrl.trim(),
      txTimeout: mode === 'edit' ? (existingNetwork!.txTimeout ?? 90) : 90,
      isDefault: false,
    }

    const result = mode === 'add' ? await addNetwork(network) : await editNetwork(network)

    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    navigate(-1)
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">
            {mode === 'add' ? 'Add network' : 'Edit network'}
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          <FormField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="My Custom Network"
            disabled={isDefault}
            required
          />
          <FormField
            label="Horizon RPC URL"
            value={horizonUrl}
            onChange={setHorizonUrl}
            placeholder="https://horizon.stellar.org"
            disabled={isDefault}
            required
          />
          <FormField
            label="Soroban RPC URL"
            value={sorobanRpcUrl}
            onChange={setSorobanRpcUrl}
            placeholder="https://mainnet.sorobanrpc.com"
            hint={
              existingNetwork?.id === 'mainnet'
                ? 'SDF does not provide a public Soroban RPC for Mainnet. sorobanrpc.com is used as default.'
                : undefined
            }
            disabled={isDefault}
            required
          />
          <FormField
            label="Passphrase"
            value={passphrase}
            onChange={setPassphrase}
            placeholder="Public Global Stellar Network ; September 2015"
            disabled={isDefault}
            required
          />
          <FormField
            label="Friendbot URL"
            value={friendbotUrl}
            onChange={setFriendBotUrl}
            placeholder="https://friendbot.stellar.org (optional)"
            disabled={isDefault}
          />

          {isDefault && (
            <p className="text-xs text-muted-foreground">Default networks cannot be edited</p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {!isDefault && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Saving...' : mode === 'add' ? 'Add network' : 'Save changes'}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  )
}
