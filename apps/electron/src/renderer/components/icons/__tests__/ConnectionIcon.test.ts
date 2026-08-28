import { describe, expect, it } from 'bun:test'
import { connectionFallbackInitial } from '../connection-icon-utils'

describe('connectionFallbackInitial', () => {
  it('uses the first letter or number from the connection name', () => {
    expect(connectionFallbackInitial('Cottoken')).toBe('C')
    expect(connectionFallbackInitial('  4o proxy')).toBe('4')
    expect(connectionFallbackInitial('  通义千问')).toBe('通')
  })

  it('returns null when the name has no usable character', () => {
    expect(connectionFallbackInitial(' -- ')).toBeNull()
  })
})
