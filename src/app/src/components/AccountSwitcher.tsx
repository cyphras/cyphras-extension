import { useState, useRef, useEffect } from 'react'
import {
  X,
  MoreVertical,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Loader2,
  GripVertical,
} from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { usePreferences } from '@/context/PreferencesContext'
import { fetchPrices } from '@/lib/api'
import { SERVICE_TYPES } from '@constants/services'
import type { AccountInfo } from '@ext-types/index'
import AddWalletModal from './AddWalletModal'
import { StellarAvatar } from './StellarAvatar'

interface AccountBalance {
  usd: number | null
  loading: boolean
}

interface AccountSwitcherProps {
  isOpen: boolean
  onClose: () => void
}

function truncateAddress(addr: string) {
  return addr.slice(0, 4) + '...' + addr.slice(-4)
}

export default function AccountSwitcher({ isOpen, onClose }: AccountSwitcherProps) {
  const { status, accounts, switchAccount, renameAccount, removeAccount, reorderAccounts } =
    useWallet()
  const { formatValue, hideBalance } = usePreferences()

  // Local ordered list - allows optimistic reorder without waiting for context refresh
  const [localAccounts, setLocalAccounts] = useState<AccountInfo[]>([])
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const [editingPk, setEditingPk] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [addWalletOpen, setAddWalletOpen] = useState(false)
  const [accountBalances, setAccountBalances] = useState<Record<string, AccountBalance>>({})

  const draggedPk = useRef<string | null>(null)
  const dragOverPk = useRef<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalAccounts(accounts)
  }, [accounts])

  useEffect(() => {
    if (editingPk !== null) editInputRef.current?.focus()
  }, [editingPk])

  useEffect(() => {
    if (menuOpenFor === null) return
    function onClick() {
      setMenuOpenFor(null)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [menuOpenFor])

  useEffect(() => {
    if (!isOpen) {
      setMenuOpenFor(null)
      setEditingPk(null)
      setError('')
    }
  }, [isOpen])

  // Stable key - only changes when the actual set of public keys changes, not on every poll
  const accountKeysRef = isOpen ? localAccounts.map((a) => a.publicKey).join(',') : ''

  useEffect(() => {
    if (!accountKeysRef) return
    let cancelled = false

    const snapshot = localAccounts
    const initial: Record<string, AccountBalance> = {}
    for (const a of snapshot) initial[a.publicKey] = { usd: null, loading: true }
    setAccountBalances(initial)

    async function fetchAll() {
      const rawResults = await Promise.all(
        snapshot.map(
          (a) =>
            new Promise<{
              pk: string
              rawBalances: Array<{
                balance: string
                asset_type: string
                asset_code?: string
              }> | null
              unfunded: boolean
            }>((resolve) => {
              chrome.runtime.sendMessage(
                { type: SERVICE_TYPES.FETCH_HORIZON_ACCOUNT, publicKey: a.publicKey },
                (response) => {
                  if (chrome.runtime.lastError || !response) {
                    resolve({ pk: a.publicKey, rawBalances: null, unfunded: false })
                  } else {
                    resolve({
                      pk: a.publicKey,
                      rawBalances: response.rawBalances ?? null,
                      unfunded: response.unfunded ?? false,
                    })
                  }
                }
              )
            })
        )
      )

      if (cancelled) return

      const allCodes = new Set<string>()
      for (const r of rawResults) {
        if (r.rawBalances) {
          for (const b of r.rawBalances) {
            allCodes.add(b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? ''))
          }
        }
      }

      const { prices } = await fetchPrices([...allCodes])
      if (cancelled) return

      const updated: Record<string, AccountBalance> = {}
      for (const { pk, rawBalances, unfunded } of rawResults) {
        if (!rawBalances) {
          updated[pk] = { usd: unfunded ? 0 : null, loading: false }
        } else {
          const total = rawBalances.reduce((sum, b) => {
            const code = b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? '')
            const price = prices[code] ?? null
            return price !== null ? sum + parseFloat(b.balance) * price : sum
          }, 0)
          updated[pk] = { usd: total, loading: false }
        }
      }

      setAccountBalances(updated)
    }

    fetchAll()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKeysRef])

  function startRename(account: AccountInfo) {
    setMenuOpenFor(null)
    setEditLabel(account.label)
    setEditingPk(account.publicKey)
  }

  async function confirmRename(publicKey: string) {
    const trimmed = editLabel.trim()
    if (!trimmed) {
      setEditingPk(null)
      return
    }
    setError('')
    const result = await renameAccount(publicKey, trimmed)
    if ('error' in result) setError(result.error)
    setEditingPk(null)
  }

  async function handleRemove(publicKey: string) {
    setMenuOpenFor(null)
    setError('')
    const result = await removeAccount(publicKey)
    if ('error' in result) setError(result.error)
  }

  async function handleSwitch(publicKey: string) {
    if (publicKey === status.publicKey) {
      onClose()
      return
    }
    setSwitchingTo(publicKey)
    setError('')
    const result = await switchAccount(publicKey)
    setSwitchingTo(null)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onClose()
  }

  function onDragStart(e: React.DragEvent, publicKey: string) {
    draggedPk.current = publicKey
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.style.opacity = '0'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  function onDragOver(e: React.DragEvent, publicKey: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOverPk.current = publicKey
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const from = draggedPk.current
    const to = dragOverPk.current
    if (!from || !to || from === to) {
      resetDrag()
      return
    }

    const next = [...localAccounts]
    const fromIdx = next.findIndex((a) => a.publicKey === from)
    const toIdx = next.findIndex((a) => a.publicKey === to)
    if (fromIdx === -1 || toIdx === -1) {
      resetDrag()
      return
    }

    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    setLocalAccounts(next)
    reorderAccounts(next.map((a) => a.publicKey))
    resetDrag()
  }

  function resetDrag() {
    draggedPk.current = null
    dragOverPk.current = null
  }

  const isLegacy = status.isLegacy ?? false

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <span className="text-sm font-semibold text-foreground">Accounts</span>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col px-3 pb-1 max-h-72 overflow-y-auto">
          {localAccounts.length === 0 && isLegacy && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-3 mb-2">
              <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Legacy wallet - re-import your wallet to enable multi-account support.
              </p>
            </div>
          )}

          {localAccounts.map((account) => {
            const isActive = account.publicKey === status.publicKey
            const isSwitching = switchingTo === account.publicKey
            const isEditing = editingPk === account.publicKey
            const menuOpen = menuOpenFor === account.publicKey

            return (
              <div
                key={account.publicKey}
                className="relative"
                draggable={editingPk === null}
                onDragStart={(e) => onDragStart(e, account.publicKey)}
                onDragOver={(e) => onDragOver(e, account.publicKey)}
                onDrop={onDrop}
                onDragEnd={resetDrag}
              >
                <button
                  disabled={isSwitching || editingPk !== null}
                  onClick={() => handleSwitch(account.publicKey)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors mb-1 ${
                    isActive
                      ? 'bg-primary/10 border border-primary/20 cursor-default'
                      : isSwitching
                        ? 'border border-transparent opacity-60 cursor-default'
                        : 'hover:bg-muted border border-transparent cursor-pointer'
                  }`}
                >
                  {/* Drag handle */}
                  <div
                    className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={14} />
                  </div>

                  <StellarAvatar publicKey={account.publicKey} size={28} className="shrink-0" />

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onBlur={() => confirmRename(account.publicKey)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename(account.publicKey)
                          if (e.key === 'Escape') setEditingPk(null)
                          e.stopPropagation()
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-medium text-foreground outline-none focus:border-primary"
                        maxLength={20}
                      />
                    ) : (
                      <p className="text-sm font-medium text-foreground truncate">
                        {account.label}
                      </p>
                    )}
                    <p className="font-mono text-xs text-muted-foreground">
                      {isEditing ? `${editLabel.length}/20` : truncateAddress(account.publicKey)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    {hideBalance ? (
                      <span className="text-xs text-muted-foreground tracking-wider">****</span>
                    ) : accountBalances[account.publicKey]?.loading ? (
                      <span className="text-xs text-muted-foreground/50">...</span>
                    ) : accountBalances[account.publicKey]?.usd !== null &&
                      accountBalances[account.publicKey]?.usd !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        {formatValue(accountBalances[account.publicKey].usd!)}
                      </span>
                    ) : null}
                  </div>

                  {isSwitching && (
                    <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpenFor(menuOpen ? null : account.publicKey)
                    }}
                    className="cursor-pointer shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  >
                    <MoreVertical size={14} />
                  </button>
                </button>

                {menuOpen && (
                  <div className="absolute right-2 top-1 z-10 flex flex-col rounded-xl bg-background shadow-lg overflow-hidden min-w-[120px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(account)
                      }}
                      className="cursor-pointer flex items-center gap-2 px-3 py-2.5 text-xs text-foreground hover:bg-muted transition-colors text-left"
                    >
                      <Pencil size={12} />
                      Rename
                    </button>
                    <button
                      disabled={localAccounts.length <= 1 || isActive}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(account.publicKey)
                      }}
                      className="cursor-pointer flex items-center gap-2 px-3 py-2.5 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
            <AlertCircle size={13} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <div className="px-3 pb-4 pt-1">
          <button
            onClick={() => setAddWalletOpen(true)}
            className="cursor-pointer flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus size={14} />
            Add Wallet
          </button>
        </div>
      </div>

      <AddWalletModal isOpen={addWalletOpen} onClose={() => setAddWalletOpen(false)} />
    </>
  )
}
