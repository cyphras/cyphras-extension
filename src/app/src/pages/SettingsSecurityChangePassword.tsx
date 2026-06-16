import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Layout } from '@/components/Layout'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'

export default function SettingsSecurityChangePassword() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleSubmit() {
    setError(null)
    setSuccess(false)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setChanging(true)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.CHANGE_PASSWORD, currentPassword, newPassword },
      (res) => {
        setChanging(false)
        if (res?.error) {
          setError(res.error)
        } else {
          setSuccess(true)
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
        }
      }
    )
  }

  return (
    <Layout
      footer={
        <div className="flex flex-col gap-2">
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          {success && (
            <p className="text-xs text-green-500 text-center">Password changed successfully</p>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={changing}>
            {changing ? 'Changing...' : 'Change Password'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-foreground">Change Password</h2>
        </div>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <input
              type={showCurrentPw ? 'text' : 'password'}
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl bg-card px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPw((v) => !v)}
              className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="relative">
            <input
              type={showNewPw ? 'text' : 'password'}
              placeholder="New password (min 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl bg-card px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowNewPw((v) => !v)}
              className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="w-full rounded-xl bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
    </Layout>
  )
}
