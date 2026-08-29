/**
 * Trigger-type panel opener (used when overlays converge into panels, Task 10).
 *
 * Triggered content opens or activates a Context Workbench tab. There is no
 * foreground capacity/LRU replacement in the v2 Surface model.
 *
 */

import { useCallback } from 'react'
import { useStore } from 'jotai'
import { openWorkbenchItemAtom } from '@/atoms/workbench'
import { SURFACE_LAUNCHER_ROUTES } from '@/lib/surface-launchers'
import type { ViewRoute } from '../../shared/routes'

export function usePanelTriggerOpener() {
  const store = useStore()

  return useCallback((kind: 'diff' | 'preview'): void => {
    const route: ViewRoute = kind === 'preview'
      ? SURFACE_LAUNCHER_ROUTES.preview
      : SURFACE_LAUNCHER_ROUTES[kind]
    store.set(openWorkbenchItemAtom, route)
  }, [store])
}
