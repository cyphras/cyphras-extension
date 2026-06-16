import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

function getPasswordStatus(password: string): { valid: boolean; message: string } {
  if (password.length === 0) return { valid: false, message: '' }
  if (password.length < 8) return { valid: false, message: 'Password is too short' }
  if (!/[A-Z]/.test(password))
    return { valid: false, message: 'Password needs an uppercase letter' }
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Password needs a number' }
  return { valid: true, message: '' }
}

function getStrengthLevel(password: string): 0 | 1 | 2 | 3 {
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  return score as 0 | 1 | 2 | 3
}

interface PasswordInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  showStrength?: boolean
  confirmOf?: string
  error?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export function PasswordInput({
  value,
  onChange,
  placeholder = 'Password',
  showStrength = false,
  confirmOf,
  error = false,
  onKeyDown,
}: PasswordInputProps) {
  const [show, setShow] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const isConfirm = confirmOf !== undefined
  const strengthLevel = showStrength ? getStrengthLevel(value) : 0
  const { valid: passwordValid, message: passwordMessage } = showStrength
    ? getPasswordStatus(value)
    : { valid: false, message: '' }

  const showBar = showStrength && value.length > 0

  const barWidthPercent =
    strengthLevel === 0 ? '0%' : strengthLevel === 1 ? '33%' : strengthLevel === 2 ? '66%' : '100%'

  const barColor =
    strengthLevel === 1 ? 'oklch(0.704 0.191 22.216)' : strengthLevel === 2 ? '#EAB308' : '#22C55E'

  const matchMessage =
    isConfirm && isDirty
      ? value.length === 0
        ? { ok: false, text: 'Password confirmation is required' }
        : value !== confirmOf
          ? { ok: false, text: 'Passwords must match' }
          : null
      : null

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`overflow-hidden rounded-lg bg-input transition-shadow ${error ? 'ring-2 ring-destructive/60' : ''}`}
      >
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              setIsDirty(true)
            }}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            onClick={() => setShow((prev) => !prev)}
            className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {showBar && (
          <div className="h-0.5 w-full bg-muted">
            <div
              className="h-full transition-all duration-500"
              style={{ width: barWidthPercent, backgroundColor: barColor }}
            />
          </div>
        )}
      </div>

      {showStrength && value.length > 0 && !passwordValid && (
        <p className="text-xs text-destructive">{passwordMessage}</p>
      )}

      {matchMessage && <p className="text-xs text-destructive">{matchMessage.text}</p>}
    </div>
  )
}
