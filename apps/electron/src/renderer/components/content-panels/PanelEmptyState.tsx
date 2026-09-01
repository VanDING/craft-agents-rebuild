/**
 * PanelEmptyState - Shared guidance empty-state for content-workbench panels.
 *
 * Used by bound workbench views when there is
 * no active session to bind to, and by SurfaceSlot when a bound route fails to
 * parse (invalid URL) — in both cases showing a hint instead of crashing or
 * falling through to the global navigation.
 */

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { motionTween } from '@craft-agent/ui/motion'

interface PanelEmptyStateProps {
  /** Primary message (usually an i18n key result) */
  title: ReactNode
  /** Optional secondary hint shown under the title */
  hint?: ReactNode
  /** Optional icon rendered above the text */
  icon?: ReactNode
}

export function PanelEmptyState({ title, hint, icon }: PanelEmptyStateProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center px-7 py-10 text-center"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTween(reduceMotion, 'standard', 'enter')}
    >
      {icon && (
        <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-gradient-to-b from-background to-foreground/[0.035] text-muted-foreground shadow-minimal">
          <div className="absolute inset-1 rounded-xl border border-white/[0.08]" />
          <span className="relative">{icon}</span>
        </div>
      )}
      <p className="text-[13px] font-medium text-foreground/80">{title}</p>
      {hint && (
        <p className="mt-1.5 max-w-[34ch] text-xs leading-relaxed text-muted-foreground/70">{hint}</p>
      )}
    </motion.div>
  )
}
