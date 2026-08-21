import { describe, expect, it } from 'vitest'
import {
  effectiveEffortOf,
  isNoopSelection,
  modelChoiceId,
  modelChoicesOf,
  modelSelectionOf,
} from '../src/client/model-menu.ts'
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

/** A directory whose thinking model advertises the full DeepSeek effort ladder. */
const EFFORT_DIRECTORY: SidebarqaSessionModels = {
  current: { provider: 'deepseek-official', model: 'deepseek-v4' },
  routable: true,
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek Official',
      models: [
        {
          id: 'deepseek-v4',
          name: 'DeepSeek V4',
          reasoning: {
            defaultEffort: 'high',
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
              { id: 'max', name: 'Max' },
            ],
          },
        },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'r1', name: 'R1', reasoning: { efforts: [{ id: 'max', name: 'Max' }] } },
      ],
    },
  ],
  failures: [],
}

const OFFICIAL = 'deepseek-official'

describe('effectiveEffortOf', () => {
  it('lets an explicit effort win over the advertised default', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, { provider: OFFICIAL, model: 'deepseek-v4', reasoningEffort: 'max' }))
      .toBe('max')
  })
  it('folds in the advertised defaultEffort when none is set', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, { provider: OFFICIAL, model: 'deepseek-v4' })).toBe('high')
  })
  it('yields undefined for a model that advertises no reasoning', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, { provider: OFFICIAL, model: 'deepseek-v4-flash' })).toBeUndefined()
  })
  it('yields undefined for a reasoning model with no defaultEffort and no pick', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, { provider: OFFICIAL, model: 'r1' })).toBeUndefined()
  })
  it('keeps the explicit effort of a model missing from the directory', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, { provider: 'other', model: 'gone', reasoningEffort: 'low' }))
      .toBe('low')
  })
  it('yields undefined for a null selection', () => {
    expect(effectiveEffortOf(EFFORT_DIRECTORY, null)).toBeUndefined()
  })
})

describe('isNoopSelection', () => {
  const v4 = { provider: OFFICIAL, model: 'deepseek-v4' }

  it('never short-circuits an unknown current selection', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, null, { ...v4, reasoningEffort: 'high' })).toBe(false)
  })
  it('reports a provider change', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, v4, { provider: 'other', model: 'deepseek-v4' })).toBe(false)
  })
  it('reports a model change', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, v4, { provider: OFFICIAL, model: 'deepseek-v4-flash' })).toBe(false)
  })
  // The issue #10 regression lock: the old guard compared provider/model only,
  // so every effort-only switch was swallowed and never reached selectModel.
  it('reports an effort-only change on the same model', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, { ...v4, reasoningEffort: 'high' }, { ...v4, reasoningEffort: 'max' }))
      .toBe(false)
  })
  it('short-circuits an identical explicit effort', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, { ...v4, reasoningEffort: 'max' }, { ...v4, reasoningEffort: 'max' }))
      .toBe(true)
  })
  it('treats an absent effort and the advertised default as the same, both ways', () => {
    expect(isNoopSelection(EFFORT_DIRECTORY, v4, { ...v4, reasoningEffort: 'high' })).toBe(true)
    expect(isNoopSelection(EFFORT_DIRECTORY, { ...v4, reasoningEffort: 'high' }, v4)).toBe(true)
  })
  it('reports an effort added to a model that advertises no default', () => {
    const r1 = { provider: OFFICIAL, model: 'r1' }
    expect(isNoopSelection(EFFORT_DIRECTORY, r1, { ...r1, reasoningEffort: 'max' })).toBe(false)
  })
  it('reports an effort change on a model missing from the directory', () => {
    const gone = { provider: 'other', model: 'gone' }
    expect(isNoopSelection(EFFORT_DIRECTORY, { ...gone, reasoningEffort: 'low' }, { ...gone, reasoningEffort: 'max' }))
      .toBe(false)
  })
})
