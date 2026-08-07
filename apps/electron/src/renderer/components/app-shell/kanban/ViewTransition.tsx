/**
 * View-switch entrance animation shared by full-width content views
 * (Kanban / Calendar). Plays on mount when the routed viewMode replaces
 * the content panel; honors prefers-reduced-motion.
 */
import { motion, useReducedMotion } from 'motion/react'

export function ViewTransition({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
      className="flex h-full min-h-0 flex-col"
    >
      {children}
    </motion.div>
  )
}
