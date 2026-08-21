import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CATALOG_INHERIT_VALUE,
  configFields,
  historyStrategyOptions,
  modelOptionsOf,
  providerOptionsOf,
  REASONING_EFFORT_OPTIONS,
  coerceNumberField,
} from '../src/client/config-fields.ts'
import { attachLocale, t } from '../src/client/locales.ts'
import { FakeLocale, restoreNavigator } from './fake-locale.ts'
import type { SidebarqaCatalog } from '../src/context-types.ts'

// The labels follow the DSH language; every assertion below that names copy
// pins zh explicitly, so a translation edit can never quietly pass.
beforeEach(() => { attachLocale(new FakeLocale('zh')) })
afterEach(() => { attachLocale(undefined); restoreNavigator() })

const CATALOG: SidebarqaCatalog = {
  providers: [
    {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    },
    { provider: 'openai', displayName: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
  ],
}

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

describe('configFields', () => {
  it('declares unique keys', () => {
    const keys = configFields().map(field => field.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers the surfaced config surface (8 fields)', () => {
    expect(configFields()).toHaveLength(8)
  })

  it('keeps the compression internals off the panel', () => {
    const keys = configFields().map(field => field.key)
    for (const hidden of ['summarizeBudgetTokens', 'recentWindowMessages', 'backgroundWindowMessages', 'titleBudgetTokens']) {
      expect(keys).not.toContain(hidden)
    }
  })

  it('gives every number field a min and max', () => {
    for (const field of configFields()) {
      if (field.type === 'number') {
        expect(typeof field.min).toBe('number')
        expect(typeof field.max).toBe('number')
      }
    }
  })

  it('declares the thinking-mode rows as selects over Off / High / Max', () => {
    for (const key of ['summarizeReasoningEffort', 'answerReasoningEffort'] as const) {
      const field = configFields().find(candidate => candidate.key === key)
      expect(field?.type).toBe('select')
      expect(field?.options).toBe(REASONING_EFFORT_OPTIONS)
    }
  })

  it('declares the history strategy as a select over the three modes', () => {
    const field = configFields().find(candidate => candidate.key === 'historyStrategy')
    expect(field?.type).toBe('select')
    expect(field?.options?.map(option => option.value)).toEqual(['inherit', 'compressed', 'trim'])
  })

  it('declares the trim window as a bounded number row', () => {
    const field = configFields().find(candidate => candidate.key === 'trimWindowMessages')
    expect(field?.type).toBe('number')
    expect(field?.min).toBe(1)
    expect(field?.max).toBe(256)
  })

  it('declares the answer/summarize provider + model as catalog rows', () => {
    const answerProvider = configFields().find(candidate => candidate.key === 'answerProvider')
    const answerModel = configFields().find(candidate => candidate.key === 'answerModel')
    const summarizeProvider = configFields().find(candidate => candidate.key === 'summarizeProvider')
    const summarizeModel = configFields().find(candidate => candidate.key === 'summarizeModel')
    expect(answerProvider?.type).toBe('catalog')
    expect(answerProvider?.source).toBe('answerProvider')
    expect(answerModel?.type).toBe('catalog')
    expect(answerModel?.source).toBe('answerModel')
    expect(summarizeProvider?.type).toBe('catalog')
    expect(summarizeProvider?.source).toBe('summarizeProvider')
    expect(summarizeModel?.type).toBe('catalog')
    expect(summarizeModel?.source).toBe('summarizeModel')
  })
})

describe('providerOptionsOf', () => {
  it('maps catalog providers to select options in catalog order', () => {
    expect(providerOptionsOf(CATALOG.providers, 'answerProvider')).toEqual([
      { value: 'deepseek-official', label: 'DeepSeek' },
      { value: 'openai', label: 'OpenAI' },
    ])
  })

  it('prepends the inherit sentinel for the summarize channel', () => {
    expect(providerOptionsOf(CATALOG.providers, 'summarizeProvider')).toEqual([
      { value: CATALOG_INHERIT_VALUE, label: t('cfgCatalogInherit') },
      { value: 'deepseek-official', label: 'DeepSeek' },
      { value: 'openai', label: 'OpenAI' },
    ])
  })

  it('yields only the inherit entry for an empty catalog', () => {
    expect(providerOptionsOf([], 'summarizeProvider')).toEqual([
      { value: CATALOG_INHERIT_VALUE, label: t('cfgCatalogInherit') },
    ])
    expect(providerOptionsOf([], 'answerProvider')).toEqual([])
  })
})

describe('modelOptionsOf', () => {
  it('maps a chosen provider\'s models to select options', () => {
    expect(modelOptionsOf(CATALOG.providers, 'deepseek-official')).toEqual([
      { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
    ])
  })

  it('yields [] for an unknown provider', () => {
    expect(modelOptionsOf(CATALOG.providers, 'nope')).toEqual([])
  })

  it('flattens the whole catalog when the channel is inherit (empty)', () => {
    expect(modelOptionsOf(CATALOG.providers, CATALOG_INHERIT_VALUE)).toEqual([
      { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
      { value: 'gpt-5', label: 'GPT-5' },
    ])
  })

  it('deduplicates model ids by id across providers', () => {
    const dupCatalog: SidebarqaCatalog = {
      providers: [
        ...CATALOG.providers,
        { provider: 'gateway', displayName: 'Gateway', models: [{ id: 'deepseek-v4-flash', name: 'Proxy Flash' }] },
      ],
    }
    expect(modelOptionsOf(dupCatalog.providers, CATALOG_INHERIT_VALUE)).toEqual([
      { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
      { value: 'gpt-5', label: 'GPT-5' },
    ])
  })
})

describe('REASONING_EFFORT_OPTIONS', () => {
  it('offers exactly Off / High / Max', () => {
    expect(REASONING_EFFORT_OPTIONS.map(option => option.value)).toEqual(['off', 'high', 'max'])
  })
})

describe('historyStrategyOptions', () => {
  it('offers exactly inherit / compressed / trim', () => {
    expect(historyStrategyOptions().map(option => option.value)).toEqual(['inherit', 'compressed', 'trim'])
  })

  it('localizes the labels while the persisted values stay protocol', () => {
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    const zhOptions = historyStrategyOptions()
    expect(zhOptions.map(option => option.label)).toEqual(['全量继承', '压缩对话', '机械裁切'])

    locale.switchTo('en')
    const enOptions = historyStrategyOptions()
    expect(enOptions.map(option => option.label)).toEqual(['Inherit full history', 'Compressed', 'Trim'])
    // The settings VALUES are never localized — they are the stored protocol.
    expect(enOptions.map(option => option.value)).toEqual(zhOptions.map(option => option.value))
  })

  it('re-reads the language on every call (no frozen module table)', () => {
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    expect(configFields()[0]?.label).toBe('上下文策略')
    locale.switchTo('en')
    expect(configFields()[0]?.label).toBe('Context strategy')
  })
})
