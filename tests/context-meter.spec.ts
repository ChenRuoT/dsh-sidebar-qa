import { describe, expect, it } from 'vitest'
import { contextOccupancy, formatTokens } from '../src/client/context-meter.ts'

describe('formatTokens', () => {
  it('renders plain numbers under 1K', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })
  it('scales K with one decimal under three digits', () => {
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(12_234)).toBe('12.2K')
    expect(formatTokens(100_000)).toBe('100K')
  })
  it('scales M', () => {
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('contextOccupancy', () => {
  it('uses projectedTokens when present', () => {
    expect(contextOccupancy({
      pressureTokens: 100,
      projectedTokens: 250,
      contextWindow: 1000,
    })).toEqual({ percent: 25, usedTokens: 250, contextWindow: 1000 })
  })
  it('falls back to the bare sample', () => {
    expect(contextOccupancy({ pressureTokens: 500, contextWindow: 1000 })).toEqual({
      percent: 50, usedTokens: 500, contextWindow: 1000,
    })
  })
  it('clamps the percent at 100', () => {
    expect(contextOccupancy({ pressureTokens: 2000, contextWindow: 1000 })?.percent).toBe(100)
  })
  it('returns null until both numerator and capacity are known', () => {
    expect(contextOccupancy(undefined)).toBeNull()
    expect(contextOccupancy({ pressureTokens: 100 })).toBeNull()
    expect(contextOccupancy({ contextWindow: 1000 })).toBeNull()
    expect(contextOccupancy({})).toBeNull()
  })
})
