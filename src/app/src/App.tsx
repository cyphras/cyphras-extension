import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useAppContext } from '@/hooks/useAppContext'
import Onboarding from '@/pages/Onboarding'
import Unlock from '@/pages/Unlock'
import Home from '@/pages/Home'
import Settings from '@/pages/Settings'
import SettingsPreferences from '@/pages/SettingsPreferences'
import SettingsPreferencesCurrency from '@/pages/SettingsPreferencesCurrency'
import SettingsPreferencesTheme from '@/pages/SettingsPreferencesTheme'
import SettingsPreferencesExplorer from '@/pages/SettingsPreferencesExplorer'
import SettingsPreferencesLanguage from '@/pages/SettingsPreferencesLanguage'
import SettingsNetworkList from '@/pages/SettingsNetworkList'
import SettingsSecurity from '@/pages/SettingsSecurity'
import SettingsSecurityAutoLock from '@/pages/SettingsSecurityAutoLock'
import SettingsSecurityChangePassword from '@/pages/SettingsSecurityChangePassword'
import SettingsSecurityRecoveryPhrase from '@/pages/SettingsSecurityRecoveryPhrase'
import SettingsSecurityDeleteWallet from '@/pages/SettingsSecurityDeleteWallet'
import SettingsSecurityResetApp from '@/pages/SettingsSecurityResetApp'
import SettingsSecuritySecretKey from '@/pages/SettingsSecuritySecretKey'
import SettingsWallet from '@/pages/SettingsWallet'
import SettingsNetworkView from '@/pages/SettingsNetworkView'
import NetworkSettings from '@/pages/NetworkSettings'
import Send from '@/pages/Send'
import Receive from '@/pages/Receive'
import History from '@/pages/History'
import Assets from '@/pages/Assets'
import AddAsset from '@/pages/AddAsset'
import Swap from '@/pages/Swap'
import ConnectedApps from '@/pages/ConnectedApps'

function Router() {
  const { status, loading } = useWallet()
  const navigate = useNavigate()
  const location = useLocation()
  // Latch: once onboarding starts (no wallet), stay in onboarding until popup closes.
  // This keeps the mnemonic/verify/success steps visible even after createWallet() sets hasWallet=true.
  const [onboardingMode, setOnboardingMode] = useState(false)

  useEffect(() => {
    if (!loading && !status.hasWallet) setOnboardingMode(true)
  }, [loading, status.hasWallet])

  useEffect(() => {
    if (loading) return
    if (!status.hasWallet || onboardingMode) return
    const path = location.pathname
    const isProtected =
      path.startsWith('/settings') ||
      path === '/send' ||
      path === '/receive' ||
      path === '/history' ||
      path === '/assets' ||
      path === '/assets/add' ||
      path === '/swap'
    if (!status.isUnlocked) {
      navigate('/unlock')
    } else if (!isProtected && path !== '/') {
      navigate('/')
    }
  }, [loading, status.hasWallet, status.isUnlocked, location.pathname, onboardingMode])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (onboardingMode || !status.hasWallet) {
    return <Onboarding />
  }

  return (
    <Routes>
      <Route path="/unlock" element={<Unlock />} />
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Send />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/history" element={<History />} />
      <Route path="/assets" element={<Assets />} />
      <Route path="/assets/add" element={<AddAsset />} />
      <Route path="/swap" element={<Swap />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/settings/preferences" element={<SettingsPreferences />} />
      <Route path="/settings/preferences/currency" element={<SettingsPreferencesCurrency />} />
      <Route path="/settings/preferences/theme" element={<SettingsPreferencesTheme />} />
      <Route path="/settings/preferences/explorer" element={<SettingsPreferencesExplorer />} />
      <Route path="/settings/preferences/language" element={<SettingsPreferencesLanguage />} />
      <Route path="/settings/networks" element={<SettingsNetworkList />} />
      <Route path="/settings/security" element={<SettingsSecurity />} />
      <Route path="/settings/security/auto-lock" element={<SettingsSecurityAutoLock />} />
      <Route
        path="/settings/security/change-password"
        element={<SettingsSecurityChangePassword />}
      />
      <Route
        path="/settings/security/recovery-phrase"
        element={<SettingsSecurityRecoveryPhrase />}
      />
      <Route path="/settings/security/delete-wallet" element={<SettingsSecurityDeleteWallet />} />
      <Route path="/settings/security/reset-app" element={<SettingsSecurityResetApp />} />
      <Route path="/settings/security/secret-key" element={<SettingsSecuritySecretKey />} />
      <Route path="/settings/wallet" element={<SettingsWallet />} />
      <Route path="/settings/network/view/:networkId" element={<SettingsNetworkView />} />
      <Route path="/settings/network/add" element={<NetworkSettings mode="add" />} />
      <Route path="/settings/network/edit/:networkId" element={<NetworkSettings mode="edit" />} />
      <Route path="/settings/connected-apps" element={<ConnectedApps />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const ctx = params.get('ctx')
  const appCtx = useAppContext()

  useEffect(() => {
    if (appCtx === 'popup') document.documentElement.classList.add('is-popup')
    else document.documentElement.classList.remove('is-popup')
  }, [appCtx])

  useEffect(() => {
    if (ctx === 'sidepanel') {
      const port = chrome.runtime.connect({ name: 'sidepanel' })
      window.addEventListener('beforeunload', () => port.disconnect())
    } else {
      const port = chrome.runtime.connect({ name: 'wallet-popup' })
      window.addEventListener('beforeunload', () => port.disconnect())
    }
  }, [])

  return <Router />
}
