import { describe, expect, it } from 'vitest'
import {
  CONFIG_FIELDS,
  HISTORY_STRATEGY_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  coerceNumberField,
} from '../src/client/config-fields.ts'

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

  it('covers the surfaced config surface (8 fields)', () => {
    expect(CONFIG_FIELDS).toHaveLength(8)
  })

  it('keeps the compression internals off the panel', () => {
    const keys = CONFIG_FIELDS.map(field => field.key)
    for (const hidden of ['summarizeBudgetTokens', 'recentWindowMessages', 'backgroundWindowMessages', 'titleBudgetTokens']) {
      expect(keys).not.toContain(hidden)
    }
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

  it('declares the history strategy as a select over the three modes', () => {
    const field = CONFIG_FIELDS.find(candidate => candidate.key === 'historyStrategy')
    expect(field?.type).toBe('select')
    expect(field?.options).toBe(HISTORY_STRATEGY_OPTIONS)
  })

  it('declares the trim window as a bounded number row', () => {
    const field = CONFIG_FIELDS.find(candidate => candidate.key === 'trimWindowMessages')
    expect(field?.type).toBe('number')
    expect(field?.min).toBe(1)
    expect(field?.max).toBe(256)
  })
})

describe('REASONING_EFFORT_OPTIONS', () => {
  it('offers exactly Off / High / Max', () => {
    expect(REASONING_EFFORT_OPTIONS.map(option => option.value)).toEqual(['off', 'high', 'max'])
  })
})

describe('HISTORY_STRATEGY_OPTIONS', () => {
  it('offers exactly inherit / compressed / trim', () => {
    expect(HISTORY_STRATEGY_OPTIONS.map(option => option.value)).toEqual(['inherit', 'compressed', 'trim'])
  })
})
