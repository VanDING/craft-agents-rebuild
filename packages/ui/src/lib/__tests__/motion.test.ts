import { describe, expect, it } from 'bun:test'
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
  motionSpring,
  motionTween,
} from '../motion'

describe('motion language', () => {
  it('keeps interaction paces ordered and spatial motion below 300ms', () => {
    expect(MOTION_DURATION.instant).toBeLessThan(MOTION_DURATION.fast)
    expect(MOTION_DURATION.fast).toBeLessThan(MOTION_DURATION.standard)
    expect(MOTION_DURATION.standard).toBeLessThan(MOTION_DURATION.emphasis)
    expect(MOTION_DURATION.emphasis).toBeLessThan(MOTION_DURATION.spatial)
    expect(MOTION_DURATION.spatial).toBeLessThanOrEqual(0.3)
  })

  it('resolves tokenized tweens and instant reduced-motion fallbacks', () => {
    expect(motionTween(false, 'standard', 'enter')).toEqual({
      type: 'tween',
      duration: MOTION_DURATION.standard,
      ease: MOTION_EASE.enter,
    })
    expect(motionTween(true, 'spatial', 'move')).toEqual({ duration: 0 })
  })

  it('uses shared springs and disables them for reduced motion', () => {
    expect(motionSpring(false, 'responsive')).toBe(MOTION_SPRING.responsive)
    expect(motionSpring(true, 'spatial')).toEqual({ duration: 0 })
  })
})
