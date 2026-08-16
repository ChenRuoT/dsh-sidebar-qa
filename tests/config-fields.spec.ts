import { describe, expect, it } from 'vitest'
import { CONFIG_FIELDS, REASONING_EFFORT_OPTIONS, coerceNumberField } from '../src/client/config-fields.ts'

describe('coerceNumberField', () => {
  it('parses and clamps to the declared range', () => {
    expect(coerceNumberField('160', 64, 8192)).toBe(160)
    expect(coerceNumberField('1', 64, 8192)).toBe(64)
    expect(coerceNumberField('99999', 64, 8192)).toBe(8192)
  })

  it('rounds fractional input', () => {
    expect(coerceNumberField('3.7', 1, 10)).toBe(4)
  })

  it('returns null for non-finite input', () => {
    expect(coerceNumberField('', 1, 10)).toBeNull()
    expect(coerceNumberField('abc', 1, 10)).toBeNull()
    expect(coerceNumberField('Infinity', 1, 10)).toBeNull()
  })

  it('works with no bounds', () => {
    expect(coerceNumberField('42')).toBe(42)
    expect(coerceNumberField('-7')).toBe(-7)
  })
})

describe('CONFIG_FIELDS', () => {
  it('declares unique keys', () => {
    const keys = CONFIG_FIELDS.map(field => field.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers the full config surface (10 fields)', () => {
    expect(CONFIG_FIELDS).toHaveLength(10)
  })

  it('gives every number field a min and max', () => {
    for (const field of CONFIG_FIELDS) {
      if (field.type === 'number') {
        expect(typeof field.min).toBe('number')
        expect(typeof field.max).toBe('number')
      }
    }
  })

  it('declares the thinking-mode rows as selects over Off / High / Max', () => {
    for (const key of ['summarizeReasoningEffort', 'answerReasoningEffort'] as const) {
      const field = CONFIG_FIELDS.find(candidate => candidate.key === key)
      expect(field?.type).toBe('select')
      expect(field?.options).toBe(REASONING_EFFORT_OPTIONS)
    }
  })
})

describe('REASONING_EFFORT_OPTIONS', () => {
  it('offers exactly Off / High / Max', () => {
    expect(REASONING_EFFORT_OPTIONS.map(option => option.value)).toEqual(['off', 'high', 'max'])
  })
})
