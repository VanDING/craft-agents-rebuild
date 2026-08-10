/**
 * Trigger-type panel opener (used when overlays converge into panels, Task 10).
 *
 * Distinct from the explicit top-bar open (Task 5 LRU): when a bound panel is
 * triggered from chat content (diff / preview), and the foreground is full,
 * the oldest non-focused panel is REPLACED in place (with a toast), so the
 * user's focused chat is never pushed aside or backgrounded unexpectedly.
 *
 * Returns the outcome so callers can surface the toast.
 */

import { useCallback } from 'react'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import { panelStackAtom, focusedPanelIdAtom, pushPanelAtom, getPanelTypeFromRoute } from '@/atoms/panel-stack'
import { hiddenPanelsAtom, restorePanelAtom, MAX_FOREGROUND_PANELS } from '@/atoms/hidden-panels'
import { WORKBENCH_PANEL_ROUTES, workbenchPanelKindForRoute } from '@/lib/workbench-panels'
import type { ViewRoute } from '../../shared/routes'
import { useTranslation } from 'react-i18next'

export type TriggerOpenOutcome = 'focused' | 'restored' | 'replaced' | 'opened'

export function usePanelTriggerOpener() {
  const store = useStore()

  return useCallback((kind: 'diff' | 'preview'): TriggerOpenOutcome => {
    const route: ViewRoute = WORKBENCH_PANEL_ROUTES[kind]
    const stack = store.get(panelStackAtom)

    // Already open in the foreground → focus it.
    const existing = stack.find((entry) => workbenchPanelKindForRoute(entry.route) === kind)
    if (existing) {
      store.set(focusedPanelIdAtom, existing.id)
      return 'focused'
    }

    // In the background set → restore it (no duplication).
    const hidden = store
      .get(hiddenPanelsAtom)
      .find((entry) => workbenchPanelKindForRoute(entry.route) === kind)
    if (hidden) {
      store.set(restorePanelAtom, hidden.id)
      return 'restored'
    }

    // Foreground full → replace the oldest non-focused panel in place.
    if (stack.length >= MAX_FOREGROUND_PANELS) {
      const focusedId = store.get(focusedPanelIdAtom)
      const target = stack.find((entry) => entry.id !== focusedId) ?? stack[0]
      const replaced = stack.map((entry) =>
        entry.id === target.id
          ? { ...entry, route, panelType: getPanelTypeFromRoute(route) }
          : entry,
      )
      store.set(panelStackAtom, replaced)
      store.set(focusedPanelIdAtom, target.id)
      return 'replaced'
    }

    store.set(pushPanelAtom, { route, intent: 'explicit' })
    return 'opened'
  }, [store])
}

/** Surface the trigger toast for a given outcome (already-open = silent). */
export function useTriggerOpenToast() {
  const { t } = useTranslation()
  return useCallback((outcome: TriggerOpenOutcome) => {
    if (outcome === 'replaced') {
      toast.success(t('contentPanel.toast.replacedPanel'))
    }
  }, [t])
}
