import { describe, expect, it } from 'vitest'
import { modelChoiceId, modelChoicesOf, modelSelectionOf } from '../src/client/model-menu.ts'
import type { SidebarqaSessionModels } from '../src/context-types.ts'

const DIRECTORY: SidebarqaSessionModels = {
  current: { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' },
  routable: true,
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek Official',
      models: [
        { id: 'deepseek-v4', name: 'DeepSeek V4', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      ],
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner',
      models: [
        { id: 'r1', name: 'R1', description: '深度推理', reasoning: { efforts: [{ id: 'max', name: 'Max' }] } },
      ],
    },
  ],
  failures: [],
}

describe('modelChoiceId', () => {
  it('joins provider and model with a slash', () => {
    expect(modelChoiceId('a', 'b')).toBe('a/b')
  })
})

describe('modelChoicesOf', () => {
  it('flattens the directory into provider-ordered rows', () => {
    const rows = modelChoicesOf(DIRECTORY)
    expect(rows.map(row => row.id)).toEqual([
      'deepseek-official/deepseek-v4',
      'deepseek-official/deepseek-v4-flash',
      'deepseek-reasoner/r1',
    ])
    expect(rows[0]?.name).toBe('DeepSeek V4')
    expect(rows[0]?.reasoning?.defaultEffort).toBe('high')
  })
  it('carries the provider name as detail, plus description when present', () => {
    const rows = modelChoicesOf(DIRECTORY)
    expect(rows[2]?.detail).toBe('DeepSeek Reasoner · 深度推理')
    expect(rows[0]?.detail).toBe('DeepSeek Official')
  })
  it('yields no rows for an empty directory', () => {
    expect(modelChoicesOf({ current: null, routable: null, groups: [], failures: [] })).toEqual([])
  })
})

describe('modelSelectionOf', () => {
  it('resolves a picked row with its provider default effort', () => {
    expect(modelSelectionOf(DIRECTORY, 'deepseek-reasoner/r1')).toEqual({
      provider: 'deepseek-reasoner',
      model: 'r1',
      reasoningEffort: undefined,
    })
  })
  it('keeps the host-reported current effort for the current route', () => {
    expect(modelSelectionOf(DIRECTORY, 'deepseek-official/deepseek-v4')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4',
      reasoningEffort: 'high',
    })
  })
  it('applies the default effort to a non-current model that advertises one', () => {
    expect(modelSelectionOf({
      ...DIRECTORY,
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }, 'deepseek-official/deepseek-v4')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4',
      reasoningEffort: 'high',
    })
  })
  it('returns undefined for unknown row ids', () => {
    expect(modelSelectionOf(DIRECTORY, 'nope/missing')).toBeUndefined()
  })
})
