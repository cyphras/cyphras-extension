import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Check } from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'

const AUTO_LOCK_OPTIONS = [
  { label: 'Immediately', seconds: 0 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 5 * 60 },
  { label: '10 minutes', seconds: 10 * 60 },
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '30 minutes', seconds: 30 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '4 hours', seconds: 4 * 60 * 60 },
  { label: '8 hours', seconds: 8 * 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
]

export default function SettingsSecurityAutoLock() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(15 * 60)

  useEffect(() => {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_AUTO_LOCK_TIMEOUT }, (res) => {
      if (res?.timeoutSeconds !== undefined) setSelected(res.timeoutSeconds)
    })
  }, [])

  function handleSelect(seconds: number) {
    const prev = selected
    setSelected(seconds)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SET_AUTO_LOCK_TIMEOUT, timeoutSeconds: seconds },
      () => {
        // Revert the optimistic selection if the background never stored it.
        if (chrome.runtime.lastError) setSelected(prev)
      }
    )
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
          <h2 className="text-lg font-bold text-foreground">Auto-lock</h2>
        </div>

        <div className="flex flex-col rounded-xl bg-card overflow-hidden divide-y divide-border">
          {AUTO_LOCK_OPTIONS.map((opt) => (
            <button
              key={opt.seconds}
              onClick={() => handleSelect(opt.seconds)}
              className="cursor-pointer flex w-full items-center justify-between px-4 py-3 hover:bg-muted transition-colors text-left"
            >
              <p
                className={`text-sm ${selected === opt.seconds ? 'font-medium text-primary' : 'text-foreground'}`}
              >
                {opt.label}
              </p>
              {selected === opt.seconds && <Check size={16} className="text-primary" />}
            </button>
          ))}
        </div>
      </div>
    </Layout>
  )
}
