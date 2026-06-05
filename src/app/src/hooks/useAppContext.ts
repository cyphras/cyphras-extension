export type AppContext = 'popup' | 'sidepanel' | 'tab'

export function useAppContext(): AppContext {
  const params = new URLSearchParams(window.location.search)
  const ctx = params.get('ctx')
  if (ctx === 'sidepanel') return 'sidepanel'
  if (window.outerWidth > 500) return 'tab'
  return 'popup'
}
