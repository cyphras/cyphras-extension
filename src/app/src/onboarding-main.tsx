import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { WalletProvider } from './context/WalletContext'
import { PreferencesProvider } from './context/PreferencesContext'
import Onboarding from './pages/Onboarding'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <WalletProvider>
        <PreferencesProvider>
          <Onboarding />
        </PreferencesProvider>
      </WalletProvider>
    </HashRouter>
  </StrictMode>
)
