import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { WalletProvider } from './context/WalletContext.tsx'
import { NetworkProvider } from './context/NetworkContext.tsx'
import { PreferencesProvider } from './context/PreferencesContext.tsx'
import ApprovalApp from './ApprovalApp.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <WalletProvider>
        <NetworkProvider>
          <PreferencesProvider>
            <ApprovalApp />
          </PreferencesProvider>
        </NetworkProvider>
      </WalletProvider>
    </HashRouter>
  </StrictMode>
)
