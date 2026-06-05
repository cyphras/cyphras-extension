export const WINDOW_MODES = {
  POPUP: 'popup',
  SIDEPANEL: 'sidepanel',
  TAB: 'tab',
} as const

export type WindowMode = (typeof WINDOW_MODES)[keyof typeof WINDOW_MODES]

export const STORAGE_KEYS = {
  WINDOW_MODE: 'cyphras_window_mode',
} as const

export const MESSAGE_TYPES = {
  OPEN_SIDEPANEL: 'OPEN_SIDEPANEL',
  CLOSE_SIDEPANEL: 'CLOSE_SIDEPANEL',
  OPEN_TAB: 'OPEN_TAB',
  GET_WINDOW_MODE: 'GET_WINDOW_MODE',
  SET_WINDOW_MODE: 'SET_WINDOW_MODE',
} as const
