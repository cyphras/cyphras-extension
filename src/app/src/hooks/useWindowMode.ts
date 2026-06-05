import { useState, useEffect } from 'react'
import { WINDOW_MODES, MESSAGE_TYPES } from '@constants/windowMode'

export function useWindowMode() {
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false)

  useEffect(() => {
    detectSidePanel()
  }, [])

  async function detectSidePanel() {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
      })
      setIsSidePanelOpen(contexts.length > 0)
    } catch {
      chrome.storage.local.get(WINDOW_MODES.SIDEPANEL, (result) => {
        setIsSidePanelOpen(result['cyphras_window_mode'] === WINDOW_MODES.SIDEPANEL)
      })
    }
  }

  function openSidePanel() {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OPEN_SIDEPANEL }, () => {
      window.close()
    })
  }

  function closeSidePanel() {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLOSE_SIDEPANEL }, () => {
      window.close()
    })
  }

  function openTab(route = '/') {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OPEN_TAB, route }, () => {
      window.close()
    })
  }

  return { isSidePanelOpen, openSidePanel, closeSidePanel, openTab }
}
