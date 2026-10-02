import { useEffect, useRef, useState } from 'react'
import { truncateDecimals } from '@/lib/amount'

/**
 * Lets the user type an amount in dollars instead of the token. The token
 * amount stays the source of truth (quotes and balance checks use it); typed
 * dollars convert into it at the token's decimals, and any other change to it,
 * such as a quick fill, is mirrored back into the dollar field.
 */
export function useFiatEntry({
  amount,
  setAmount,
  price,
  decimals,
}: {
  amount: string
  setAmount: (v: string) => void
  price: number | null
  decimals: number
}) {
  const [mode, setMode] = useState<'token' | 'usd'>('token')
  const [usdText, setUsdText] = useState('')
  const derived = useRef(amount)
  const active = mode === 'usd' && price !== null && price > 0

  useEffect(() => {
    if (amount === derived.current || !price) return
    derived.current = amount
    setUsdText(amount ? (parseFloat(amount) * price).toFixed(2) : '')
  }, [amount, price])

  const onUsdChange = (v: string) => {
    setUsdText(v)
    const usd = parseFloat(v)
    const tokens = price ? usd / price : 0
    // toFixed switches to exponent notation from 1e21; no real balance gets near.
    const next =
      tokens > 0 && tokens < 1e15 ? truncateDecimals(tokens.toFixed(decimals + 2), decimals) : ''
    derived.current = next
    setAmount(next)
  }
  const toggle = () => {
    if (mode === 'token' && price) setUsdText(amount ? (parseFloat(amount) * price).toFixed(2) : '')
    setMode((m) => (m === 'token' ? 'usd' : 'token'))
  }
  return { active, usdText, onUsdChange, toggle, available: price !== null && price > 0 }
}
