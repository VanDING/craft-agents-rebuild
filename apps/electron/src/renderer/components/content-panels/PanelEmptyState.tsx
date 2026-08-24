/**
 * PanelEmptyState - Shared guidance empty-state for content-workbench panels.
 *
 * Used by bound panels (Review-Diff / Files / Context / Preview) when there is
 * no active session to bind to, and by SurfaceSlot when a bound route fails to
 * parse (invalid URL) — in both cases showing a hint instead of crashing or
 * falling through to the global navigation.
 */

import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

interface PanelEmptyStateProps {
  /** Primary message (usually an i18n key result) */
  title: ReactNode
  /** Optional secondary hint shown under the title */
  hint?: ReactNode
  /** Optional icon rendered above the text */
  icon?: ReactNode
}

export function PanelEmptyState({ title, hint, icon }: PanelEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      {icon && <div className="mb-1 opacity-60">{icon}</div>}
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && (
        <p className="max-w-[32ch] text-xs text-muted-foreground/70">{hint}</p>
      )}
    </div>
  )
}
