import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { WalletProvider } from './context/WalletContext.tsx'
import { NetworkProvider } from './context/NetworkContext.tsx'
import { PreferencesProvider } from './context/PreferencesContext.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <WalletProvider>
        <NetworkProvider>
          <PreferencesProvider>
            <App />
          </PreferencesProvider>
        </NetworkProvider>
      </WalletProvider>
    </HashRouter>
  </StrictMode>
)
