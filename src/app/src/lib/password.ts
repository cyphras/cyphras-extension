import { PASSWORD_RULES } from '@constants/services'

export interface PasswordStrength {
  score: number
  label: 'weak' | 'fair' | 'strong' | 'very strong'
  color: string
  issues: string[]
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < PASSWORD_RULES.MIN_LENGTH) {
    return { valid: false, error: `Use at least ${PASSWORD_RULES.MIN_LENGTH} characters` }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Add at least one uppercase letter (A-Z)' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Add at least one number (0-9)' }
  }
  return { valid: true }
}

export function getPasswordStrength(password: string): PasswordStrength {
  const issues: string[] = []
  let score = 0

  if (password.length >= 8) score++
  else issues.push('At least 8 characters')

  if (/[A-Z]/.test(password)) score++
  else issues.push('One uppercase letter')

  if (/[0-9]/.test(password)) score++
  else issues.push('One number')

  if (score === 1) return { score, label: 'weak', color: 'text-destructive', issues }
  if (score === 2) return { score, label: 'fair', color: 'text-yellow-500', issues }
  return { score, label: 'strong', color: 'text-green-500', issues }
}
