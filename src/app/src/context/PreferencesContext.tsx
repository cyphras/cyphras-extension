import { createContext, useContext, useState, useEffect } from 'react'

export type Currency = 'USD' | 'EUR' | 'GBP' | 'IDR'
export type Theme = 'system' | 'light' | 'dark'
export type Explorer = 'stellar.expert' | 'stellarchain'

interface ExchangeRates {
  EUR: number
  GBP: number
  IDR: number
  cachedAt: number
}

interface PreferencesContextValue {
  currency: Currency
  setCurrency: (c: Currency) => void
  theme: Theme
  setTheme: (t: Theme) => void
  explorer: Explorer
  setExplorer: (e: Explorer) => void
  hideSmallPayments: boolean
  setHideSmallPayments: (v: boolean) => void
  sidebarByDefault: boolean
  setSidebarByDefault: (v: boolean) => void
  hideBalance: boolean
  setHideBalance: (v: boolean) => void
  formatValue: (usdValue: number) => string
  formatPrice: (usdPrice: number) => string
  getExplorerTxUrl: (hash: string, networkId: string) => string
  getExplorerAccountUrl: (address: string, networkId: string) => string
  getExplorerAssetUrl: (code: string, issuer: string, networkId: string) => string
  getExplorerName: () => string
}

const STORAGE_KEYS = {
  currency: 'cyphras_currency',
  theme: 'cyphras_theme',
  explorer: 'cyphras_explorer',
  hideSmallPayments: 'cyphras_hide_small_payments',
  sidebarByDefault: 'cyphras_sidebar_by_default',
  hideBalance: 'cyphras_hide_balance',
  exchangeRates: 'cyphras_exchange_rates',
}

const FALLBACK_RATES = { EUR: 0.92, GBP: 0.79, IDR: 16000 }
const RATES_TTL_MS = 6 * 60 * 60 * 1000

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
  }
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>('USD')
  const [theme, setThemeState] = useState<Theme>('light')
  const [explorer, setExplorerState] = useState<Explorer>('stellar.expert')
  const [hideSmallPayments, setHideSmallPaymentsState] = useState(false)
  const [sidebarByDefault, setSidebarByDefaultState] = useState(false)
  const [hideBalance, setHideBalanceState] = useState(false)
  const [rates, setRates] = useState(FALLBACK_RATES)

  useEffect(() => {
    chrome.storage.local.get(Object.values(STORAGE_KEYS), (res) => {
      const c = res[STORAGE_KEYS.currency] as Currency | undefined
      const t = res[STORAGE_KEYS.theme] as Theme | undefined
      const e = res[STORAGE_KEYS.explorer] as Explorer | undefined
      const h = res[STORAGE_KEYS.hideSmallPayments] as boolean | undefined
      const wm = res[STORAGE_KEYS.sidebarByDefault] as boolean | undefined
      const r = res[STORAGE_KEYS.exchangeRates] as ExchangeRates | undefined

      if (c) setCurrencyState(c)
      if (t) {
        setThemeState(t)
        applyTheme(t)
        localStorage.setItem('cyphras_theme', t)
      } else {
        applyTheme('light')
      }
      if (e) setExplorerState(e)
      if (h !== undefined) setHideSmallPaymentsState(h)
      if (wm !== undefined) setSidebarByDefaultState(wm)
      const hb = res[STORAGE_KEYS.hideBalance] as boolean | undefined
      if (hb !== undefined) setHideBalanceState(hb)

      if (r && Date.now() - r.cachedAt < RATES_TTL_MS) {
        setRates({ EUR: r.EUR, GBP: r.GBP, IDR: r.IDR })
      } else {
        fetchAndCacheRates()
      }
    })
  }, [])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  async function fetchAndCacheRates() {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      if (!res.ok) return
      const data = (await res.json()) as { result: string; rates: Record<string, number> }
      if (data.result !== 'success') return
      const newRates = {
        EUR: data.rates['EUR'] ?? FALLBACK_RATES.EUR,
        GBP: data.rates['GBP'] ?? FALLBACK_RATES.GBP,
        IDR: data.rates['IDR'] ?? FALLBACK_RATES.IDR,
        cachedAt: Date.now(),
      }
      setRates({ EUR: newRates.EUR, GBP: newRates.GBP, IDR: newRates.IDR })
      await chrome.storage.local.set({ [STORAGE_KEYS.exchangeRates]: newRates })
    } catch {
      // Keep fallback
    }
  }

  function setCurrency(c: Currency) {
    setCurrencyState(c)
    chrome.storage.local.set({ [STORAGE_KEYS.currency]: c })
  }

  function setTheme(t: Theme) {
    setThemeState(t)
    applyTheme(t)
    chrome.storage.local.set({ [STORAGE_KEYS.theme]: t })
    localStorage.setItem('cyphras_theme', t)
  }

  function setExplorer(e: Explorer) {
    setExplorerState(e)
    chrome.storage.local.set({ [STORAGE_KEYS.explorer]: e })
  }

  function setHideSmallPayments(v: boolean) {
    setHideSmallPaymentsState(v)
    chrome.storage.local.set({ [STORAGE_KEYS.hideSmallPayments]: v })
  }

  function setSidebarByDefault(v: boolean) {
    setSidebarByDefaultState(v)
    chrome.runtime.sendMessage({ type: 'SET_WINDOW_MODE', mode: v ? 'sidepanel' : 'popup' })
  }

  function setHideBalance(v: boolean) {
    setHideBalanceState(v)
    chrome.storage.local.set({ [STORAGE_KEYS.hideBalance]: v })
  }

  function convertCurrency(usdValue: number): number {
    switch (currency) {
      case 'EUR':
        return usdValue * rates.EUR
      case 'GBP':
        return usdValue * rates.GBP
      case 'IDR':
        return usdValue * rates.IDR
      default:
        return usdValue
    }
  }

  function formatIDR(value: number): string {
    const abs = Math.abs(Math.round(value))
    return (value < 0 ? '-' : '') + 'Rp' + new Intl.NumberFormat('id-ID').format(abs)
  }

  function formatValue(usdValue: number): string {
    const value = convertCurrency(usdValue)
    try {
      if (currency === 'IDR') return formatIDR(value)
      const opts: Intl.NumberFormatOptions = { style: 'currency', currency }
      const locale = currency === 'EUR' ? 'de-DE' : 'en-US'
      return new Intl.NumberFormat(locale, opts).format(value)
    } catch {
      return value.toFixed(2)
    }
  }

  function formatPrice(usdPrice: number): string {
    const value = convertCurrency(usdPrice)
    try {
      if (currency === 'IDR') return formatIDR(value)
      const opts: Intl.NumberFormatOptions = { style: 'currency', currency }
      if (value < 0.0001) {
        opts.minimumFractionDigits = 8
        opts.maximumFractionDigits = 8
      } else if (value < 0.01) {
        opts.minimumFractionDigits = 6
        opts.maximumFractionDigits = 6
      } else if (value < 1) {
        opts.minimumFractionDigits = 4
        opts.maximumFractionDigits = 4
      } else {
        opts.minimumFractionDigits = 2
        opts.maximumFractionDigits = 2
      }
      const locale = currency === 'EUR' ? 'de-DE' : 'en-US'
      return new Intl.NumberFormat(locale, opts).format(value)
    } catch {
      return value.toFixed(value < 0.01 ? 6 : 2)
    }
  }

  function getExplorerTxUrl(hash: string, networkId: string): string {
    const isMainnet = networkId === 'mainnet'
    if (explorer === 'stellarchain') {
      return isMainnet
        ? `https://stellarchain.io/transactions/${hash}`
        : `https://testnet.stellarchain.io/transactions/${hash}`
    }
    return isMainnet
      ? `https://stellar.expert/explorer/public/tx/${hash}`
      : `https://stellar.expert/explorer/testnet/tx/${hash}`
  }

  function getExplorerAccountUrl(address: string, networkId: string): string {
    const isMainnet = networkId === 'mainnet'
    if (explorer === 'stellarchain') {
      return isMainnet
        ? `https://stellarchain.io/accounts/${address}`
        : `https://testnet.stellarchain.io/accounts/${address}`
    }
    return isMainnet
      ? `https://stellar.expert/explorer/public/account/${address}`
      : `https://stellar.expert/explorer/testnet/account/${address}`
  }

  function getExplorerAssetUrl(code: string, issuer: string, networkId: string): string {
    const isMainnet = networkId === 'mainnet'
    const isNative = code === 'XLM' && !issuer
    if (explorer === 'stellarchain') {
      const base = isMainnet ? 'https://stellarchain.io' : 'https://testnet.stellarchain.io'
      return isNative ? `${base}/assets/XLM` : `${base}/assets/${code}-${issuer}`
    }
    const base = isMainnet
      ? 'https://stellar.expert/explorer/public'
      : 'https://stellar.expert/explorer/testnet'
    return isNative ? `${base}/asset/XLM` : `${base}/asset/${code}-${issuer}`
  }

  function getExplorerName(): string {
    return explorer === 'stellarchain' ? 'StellarChain' : 'Stellar.expert'
  }

  return (
    <PreferencesContext.Provider
      value={{
        currency,
        setCurrency,
        theme,
        setTheme,
        explorer,
        setExplorer,
        hideSmallPayments,
        setHideSmallPayments,
        sidebarByDefault,
        setSidebarByDefault,
        hideBalance,
        setHideBalance,
        formatValue,
        formatPrice,
        getExplorerTxUrl,
        getExplorerAccountUrl,
        getExplorerAssetUrl,
        getExplorerName,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider')
  return ctx
}
