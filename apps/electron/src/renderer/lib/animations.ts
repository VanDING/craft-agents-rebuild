/**
 * Shared animation configurations for synchronized animations across components
 */

import {
  MOTION_DISTANCE,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SCALE,
} from '@craft-agent/ui/motion'

// Easing curves for fullscreen overlay animations
// Entry: exponential out - fast start, smooth deceleration (responsive feel)
export const overlayEaseIn = MOTION_EASE.enter

// Exit: exponential in - slow start, accelerates away (feels "pulled away")
export const overlayEaseOut = MOTION_EASE.exit

// Tween config for entry animation
export const overlayTransitionIn = {
  duration: MOTION_DURATION.spatial,
  ease: overlayEaseIn,
}

// Tween config for exit animation
export const overlayTransitionOut = {
  duration: MOTION_DURATION.emphasis,
  ease: overlayEaseOut,
}

// Scale-back values for AppShell when overlay is open
export const scaleBackValues = {
  scale: MOTION_SCALE.dialog,
  y: MOTION_DISTANCE.content,
  borderRadius: 16,
}
