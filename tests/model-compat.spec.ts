import { describe, expect, it } from 'vitest'
import { catalogModelId } from '../src/model-compat.ts'

describe('Flash catalog compatibility', () => {
  it.each([
    ['deepseek-v4-flash', ['deepseek-flash', 'deepseek-v4-pro'], 'deepseek-flash'],
    ['deepseek-flash', ['deepseek-v4-flash'], 'deepseek-v4-flash'],
    ['deepseek-v4-flash', ['deepseek-v4-flash', 'deepseek-flash'], 'deepseek-v4-flash'],
    ['deepseek-flash', ['deepseek-v4-flash', 'deepseek-flash'], 'deepseek-flash'],
    ['custom-model', ['deepseek-flash'], 'custom-model'],
    ['deepseek-v4-flash', [], 'deepseek-v4-flash'],
    ['deepseek-v4-flash', ['deepseek-v4-pro'], 'deepseek-v4-flash'],
  ])('resolves %s against %j to %s', (model, ids, expected) => {
    expect(catalogModelId(model, ids.map(id => ({ id })))).toBe(expected)
  })
})
