import {
  CYPHRAS_MSG_REQUEST,
  CYPHRAS_MSG_RESPONSE,
  CYPHRAS_INTERNAL_REQUEST,
  CYPHRAS_INTERNAL_RESPONSE,
  EXTERNAL_SERVICE_TYPES,
} from '../constants/external'

const ALLOWED_TYPES = new Set(Object.values(EXTERNAL_SERVICE_TYPES))

function isValidRequest(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (d.type !== CYPHRAS_MSG_REQUEST) return false
  if (typeof d.id !== 'string') return false
  if (typeof d.requestType !== 'string') return false
  if (!ALLOWED_TYPES.has(d.requestType as any)) return false
  return true
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return

  if (event.data?.type === CYPHRAS_MSG_REQUEST) {
    if (!isValidRequest(event.data)) return

    window.postMessage(
      {
        type: CYPHRAS_INTERNAL_REQUEST,
        id: event.data.id,
        requestType: event.data.requestType,
        origin: window.location.origin,
        payload: event.data.payload,
      },
      '*'
    )
    return
  }

  if (event.data?.type === CYPHRAS_INTERNAL_RESPONSE) {
    window.postMessage(
      {
        type: CYPHRAS_MSG_RESPONSE,
        id: event.data.id,
        result: event.data.result,
        error: event.data.error,
      },
      window.location.origin
    )
  }
})
;(window as any).isCyphrasInstalled = true
