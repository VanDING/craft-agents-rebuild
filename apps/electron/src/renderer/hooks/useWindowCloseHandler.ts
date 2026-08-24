import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useModalRegistry } from '@/context/ModalContext'
import { useDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { closeWorkbenchItemAtom, workbenchStateAtom } from '@/atoms/workbench'
import type { WindowCloseRequest } from '../../shared/types'

/**
 * Hook to handle window close requests with source-aware behavior.
 *
 * - `window-button` closes the window directly.
 * - `keyboard-shortcut` (Cmd/Ctrl+W) uses layered dismissal:
 *   1. Close top modal
 *   2. Else close the active Context Workbench tab
 *   3. Else close window
 * - `unknown` follows layered dismissal as a safe fallback.
 *
 * The main process starts a fallback timeout on each close request.
 * cancelCloseWindow() clears it (window stays open).
 * confirmCloseWindow() clears it and destroys the window.
 *
 * This hook should be called once at the app root level.
 */
export function useWindowCloseHandler() {
  const { hasOpenLayers, closeTop } = useDismissibleLayerRegistry()
  const { hasOpenModals, closeTopModal } = useModalRegistry()
  const workbench = useAtomValue(workbenchStateAtom)
  const closeWorkbenchItem = useSetAtom(closeWorkbenchItemAtom)

  useEffect(() => {
    const cleanup = window.electronAPI.onCloseRequested((request: WindowCloseRequest) => {
      if (request.source === 'window-button') {
        window.electronAPI.confirmCloseWindow()
        return
      }

      if (hasOpenLayers()) {
        closeTop()
        window.electronAPI.cancelCloseWindow()
        return
      }

      // Backward-compatible fallback for legacy modals not yet migrated.
      if (hasOpenModals()) {
        closeTopModal()
        window.electronAPI.cancelCloseWindow()
        return
      }

      // Primary is structural and cannot be closed. Cmd/Ctrl+W first closes
      // the active workbench tab; with no docked item left it closes the window.
      if (workbench.open && workbench.activeItemId) {
        closeWorkbenchItem(workbench.activeItemId)
        window.electronAPI.cancelCloseWindow()
      } else {
        // No workbench tab or modal — close the window.
        window.electronAPI.confirmCloseWindow()
      }
    })

    return cleanup
  }, [hasOpenLayers, closeTop, hasOpenModals, closeTopModal, workbench, closeWorkbenchItem])
}
