import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { SERVICE_TYPES } from '@constants/services'
import type { WalletStatus, AccountInfo, HDWalletInfo, ImportedKeyInfo } from '@ext-types/index'

interface AccountsState {
  accounts: AccountInfo[]
  activePublicKey: string
  hdWallets: HDWalletInfo[]
  importedKeys: ImportedKeyInfo[]
}

interface WalletContextValue {
  status: WalletStatus
  loading: boolean
  accounts: AccountInfo[]
  activePublicKey: string
  hdWallets: HDWalletInfo[]
  importedKeys: ImportedKeyInfo[]
  createWallet: (
    password: string
  ) => Promise<{ publicKey: string; mnemonic: string } | { error: string }>
  importWallet: (
    mnemonic: string,
    password: string
  ) => Promise<{ publicKey: string } | { error: string }>
  unlockWallet: (password: string) => Promise<{ publicKey: string } | { error: string }>
  lockWallet: () => void
  resetWallet: (password?: string) => Promise<{ ok: true } | { error: string }>
  checkStatus: () => void
  refreshAccounts: () => Promise<void>
  addAccount: (
    walletId?: string,
    label?: string,
    password?: string
  ) => Promise<{ account: AccountInfo } | { error: string }>
  switchAccount: (publicKey: string) => Promise<{ publicKey: string } | { error: string }>
  renameAccount: (publicKey: string, label: string) => Promise<{ ok: true } | { error: string }>
  removeAccount: (publicKey: string, password?: string) => Promise<{ ok: true } | { error: string }>
  createHDWallet: (
    password: string,
    label?: string
  ) => Promise<{ account: AccountInfo; mnemonic: string } | { error: string }>
  importHDWallet: (
    mnemonic: string,
    password: string,
    label?: string
  ) => Promise<{ account: AccountInfo } | { error: string }>
  importSecretKey: (
    secretKey: string,
    password: string,
    label?: string
  ) => Promise<{ account: AccountInfo } | { error: string }>
  removeHDWallet: (walletId: string) => Promise<{ ok: true } | { error: string }>
  reorderAccounts: (publicKeys: string[]) => Promise<void>
  getSecretKey: (
    publicKey: string,
    password: string
  ) => Promise<{ secretKey: string } | { error: string }>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>({
    hasWallet: false,
    isUnlocked: false,
    failedAttempts: 0,
    lockedUntil: 0,
  })
  const [loading, setLoading] = useState(true)
  const [accountsState, setAccountsState] = useState<AccountsState>({
    accounts: [],
    activePublicKey: '',
    hdWallets: [],
    importedKeys: [],
  })

  const refreshAccounts = useCallback(async (): Promise<void> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_ACCOUNTS }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve()
          return
        }
        if (!response.error) {
          setAccountsState({
            accounts: response.accounts ?? [],
            activePublicKey: response.activePublicKey ?? '',
            hdWallets: response.hdWallets ?? [],
            importedKeys: response.importedKeys ?? [],
          })
        }
        resolve()
      })
    })
  }, [])

  const checkStatus = useCallback(() => {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_WALLET_STATUS }, (response) => {
      if (chrome.runtime.lastError) return
      const unlocked = response?.isUnlocked ?? false
      setStatus({
        hasWallet: response?.hasWallet ?? false,
        isUnlocked: unlocked,
        isLegacy: response?.isLegacy ?? false,
        publicKey: response?.publicKey,
        failedAttempts: response?.failedAttempts ?? 0,
        lockedUntil: response?.lockedUntil ?? 0,
      })
      setLoading(false)
      if (unlocked) refreshAccounts()
      else setAccountsState({ accounts: [], activePublicKey: '', hdWallets: [], importedKeys: [] })
    })
  }, [refreshAccounts])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 3000)
    return () => clearInterval(interval)
  }, [checkStatus])

  async function createWallet(
    password: string
  ): Promise<{ publicKey: string; mnemonic: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.CREATE_WALLET, password },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            setStatus({ hasWallet: true, isUnlocked: true, publicKey: response.publicKey })
            await refreshAccounts()
            resolve({ publicKey: response.publicKey, mnemonic: response.mnemonic })
          }
        }
      )
    })
  }

  async function importWallet(
    mnemonic: string,
    password: string
  ): Promise<{ publicKey: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.IMPORT_WALLET, mnemonic, password },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            setStatus({ hasWallet: true, isUnlocked: true, publicKey: response.publicKey })
            await refreshAccounts()
            resolve({ publicKey: response.publicKey })
          }
        }
      )
    })
  }

  async function unlockWallet(
    password: string
  ): Promise<{ publicKey: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.UNLOCK_WALLET, password },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            checkStatus()
            resolve({ error: response.error })
          } else {
            setStatus((prev) => ({
              ...prev,
              isUnlocked: true,
              publicKey: response.publicKey,
              failedAttempts: 0,
              lockedUntil: 0,
            }))
            await refreshAccounts()
            resolve({ publicKey: response.publicKey })
          }
        }
      )
    })
  }

  function lockWallet() {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.LOCK_WALLET }, (response) => {
      if (chrome.runtime.lastError) return
      if (!response?.error) {
        setStatus((prev) => ({ ...prev, isUnlocked: false, publicKey: undefined }))
        setAccountsState({ accounts: [], activePublicKey: '', hdWallets: [], importedKeys: [] })
      }
    })
  }

  async function resetWallet(password?: string): Promise<{ ok: true } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.RESET_WALLET, password }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: 'Extension error' })
          return
        }
        if (response?.error) {
          resolve({ error: response.error })
          return
        }
        setStatus({ hasWallet: false, isUnlocked: false, failedAttempts: 0, lockedUntil: 0 })
        setAccountsState({ accounts: [], activePublicKey: '', hdWallets: [], importedKeys: [] })
        resolve({ ok: true })
      })
    })
  }

  async function addAccount(
    walletId?: string,
    label?: string,
    password?: string
  ): Promise<{ account: AccountInfo } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.ADD_ACCOUNT, walletId, label, password },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ account: response.account })
          }
        }
      )
    })
  }

  async function switchAccount(
    publicKey: string
  ): Promise<{ publicKey: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.SWITCH_ACCOUNT, publicKey },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            setStatus((prev) => ({ ...prev, publicKey: response.publicKey }))
            await refreshAccounts()
            resolve({ publicKey: response.publicKey })
          }
        }
      )
    })
  }

  async function renameAccount(
    publicKey: string,
    label: string
  ): Promise<{ ok: true } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.RENAME_ACCOUNT, publicKey, label },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ ok: true })
          }
        }
      )
    })
  }

  async function removeAccount(
    publicKey: string,
    password?: string
  ): Promise<{ ok: true } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.REMOVE_ACCOUNT, publicKey, password },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ ok: true })
          }
        }
      )
    })
  }

  async function createHDWallet(
    password: string,
    label?: string
  ): Promise<{ account: AccountInfo; mnemonic: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.CREATE_HD_WALLET, password, walletLabel: label },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ account: response.account, mnemonic: response.mnemonic })
          }
        }
      )
    })
  }

  async function importHDWallet(
    mnemonic: string,
    password: string,
    label?: string
  ): Promise<{ account: AccountInfo } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.IMPORT_HD_WALLET, mnemonic, password, walletLabel: label },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ account: response.account })
          }
        }
      )
    })
  }

  async function importSecretKey(
    secretKey: string,
    password: string,
    label?: string
  ): Promise<{ account: AccountInfo } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.IMPORT_SECRET_KEY, secretKey, password, walletLabel: label },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ account: response.account })
          }
        }
      )
    })
  }

  async function removeHDWallet(walletId: string): Promise<{ ok: true } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.REMOVE_HD_WALLET, walletId },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
          } else {
            await refreshAccounts()
            resolve({ ok: true })
          }
        }
      )
    })
  }

  async function getSecretKey(
    publicKey: string,
    password: string
  ): Promise<{ secretKey: string } | { error: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.GET_SECRET_KEY, publicKey, password },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
            return
          }
          resolve({ secretKey: response.secretKey })
        }
      )
    })
  }

  async function reorderAccounts(publicKeys: string[]): Promise<void> {
    // Optimistic update already applied by caller - just persist
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.REORDER_ACCOUNTS, order: publicKeys },
        () => {
          resolve()
        }
      )
    })
  }

  return (
    <WalletContext.Provider
      value={{
        status,
        loading,
        accounts: accountsState.accounts,
        activePublicKey: accountsState.activePublicKey,
        hdWallets: accountsState.hdWallets,
        importedKeys: accountsState.importedKeys,
        createWallet,
        importWallet,
        unlockWallet,
        lockWallet,
        resetWallet,
        checkStatus,
        refreshAccounts,
        addAccount,
        switchAccount,
        renameAccount,
        removeAccount,
        createHDWallet,
        importHDWallet,
        importSecretKey,
        removeHDWallet,
        reorderAccounts,
        getSecretKey,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
