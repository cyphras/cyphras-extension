/// <reference types="chrome" />
import {
  CYPHRAS_INTERNAL_REQUEST,
  CYPHRAS_INTERNAL_RESPONSE,
  CYPHRAS_WALLET_CHANGED,
} from '../constants/external'

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  if (event.data?.type !== CYPHRAS_INTERNAL_REQUEST) return

  const { id, requestType, origin, payload } = event.data

  try {
    chrome.runtime.sendMessage(
      { type: 'EXTERNAL_REQUEST', id, requestType, origin, payload },
      (response: any) => {
        if (chrome.runtime.lastError) {
          // Service worker restarted - send error so SDK doesn't hang
          window.postMessage(
            {
              type: CYPHRAS_INTERNAL_RESPONSE,
              id,
              error: {
                code: 'EXTENSION_ERROR',
                message: 'Extension unavailable. Please refresh the page.',
              },
            },
            '*'
          )
          return
        }
        window.postMessage(
          {
            type: CYPHRAS_INTERNAL_RESPONSE,
            id,
            result: response?.result,
            error: response?.error,
          },
          '*'
        )
      }
    )
  } catch {
    // Extension context invalidated (extension reloaded while page was open)
    window.postMessage(
      {
        type: CYPHRAS_INTERNAL_RESPONSE,
        id,
        error: {
          code: 'EXTENSION_CONTEXT_INVALID',
          message: 'Extension was reloaded. Please refresh the page.',
        },
      },
      '*'
    )
  }
})

chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type !== 'WALLET_CHANGED') return

  try {
    chrome.runtime.sendMessage({ type: 'GET_WALLET_STATE_FOR_BROADCAST' }, (response: any) => {
      if (chrome.runtime.lastError || !response) return
      window.postMessage(
        {
          type: CYPHRAS_WALLET_CHANGED,
          address: response.address,
          network: response.network,
          networkPassphrase: response.networkPassphrase,
        },
        '*'
      )
    })
  } catch {
    // Extension context invalidated - silently ignore wallet change broadcast
  }
})
