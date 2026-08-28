import { motion } from 'motion/react'
import { MOTION_DURATION, MOTION_EASE } from '@craft-agent/ui/motion'
import { CraftAgentsSymbol } from './icons/CraftAgentsSymbol'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

/**
 * SplashScreen - Shows Craft symbol during app initialization
 *
 * Displays centered symbol on app background, fades out when app is fully ready.
 * On exit, the symbol lifts subtly while the background fades away.
 */
export function SplashScreen({ isExiting, onExitComplete }: SplashScreenProps) {
  return (
    <motion.div
      className="fixed inset-0 z-splash flex items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: MOTION_DURATION.emphasis, ease: MOTION_EASE.exit }}
      onAnimationComplete={() => {
        if (isExiting && onExitComplete) {
          onExitComplete()
        }
      }}
    >
      <motion.div
        initial={{ scale: 1.5, opacity: 1 }}
        animate={{
          scale: isExiting ? 1.65 : 1.5,
          opacity: isExiting ? 0 : 1
        }}
        transition={{
          duration: MOTION_DURATION.standard,
          ease: MOTION_EASE.enter,
        }}
      >
        <CraftAgentsSymbol className="h-8 text-accent" />
      </motion.div>
    </motion.div>
  )
}
