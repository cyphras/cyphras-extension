import { useState } from 'react'

// Which of several copy buttons copied last, for two seconds.
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      // clipboard denied; the address stays visible to copy by hand
    }
  }
  return { copied, copy }
}
