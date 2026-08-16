import { describe, expect, it } from 'vitest'
import {
  boundTitleInput,
  buildTitleInput,
  normalizeTitle,
  TITLE_MAX_BYTES,
  truncateTitleUtf8,
} from '../src/title.ts'

describe('normalizeTitle', () => {
  it('strips SGR control sequences and collapses whitespace to one line', () => {
    expect(normalizeTitle('  会话\u001B[31m标题  \t 测试  ', TITLE_MAX_BYTES)).toBe('会话标题 测试')
  })
  it('removes directional and invisible controls', () => {
    expect(normalizeTitle('\u200B标题\u200B', TITLE_MAX_BYTES)).toBe('标题')
  })
  it('returns empty for a control-only input', () => {
    expect(normalizeTitle('\u001B[31m', TITLE_MAX_BYTES)).toBe('')
  })
})

describe('truncateTitleUtf8', () => {
  it('truncates to the UTF-8 byte budget without splitting a code point', () => {
    // 8 CJK chars = 24 bytes; a 6-byte budget keeps exactly the first 2 chars.
    expect(truncateTitleUtf8('会话标题超长测试', 6)).toBe('会话')
  })
  it('passes short text through unchanged', () => {
    expect(truncateTitleUtf8('abc', 10)).toBe('abc')
  })
})

describe('buildTitleInput', () => {
  it('labels question and answer', () => {
    expect(buildTitleInput('怎么用', '这样用')).toBe('问题：怎么用\n回答：这样用')
  })
  it('omits empty parts', () => {
    expect(buildTitleInput('', '只有回答')).toBe('回答：只有回答')
    expect(buildTitleInput('只有问题', '')).toBe('问题：只有问题')
    expect(buildTitleInput('', '')).toBe('')
  })
  it('bounds long question and answer parts', () => {
    const question = 'x'.repeat(500)
    const answer = 'y'.repeat(2000)
    const out = buildTitleInput(question, answer)
    expect(out).toContain(`问题：${'x'.repeat(400)}…`)
    expect(out).toContain(`回答：${'y'.repeat(1200)}…`)
  })
})

describe('boundTitleInput', () => {
  it('caps the whole input to the defensive budget', () => {
    expect(boundTitleInput('z'.repeat(5000)).length).toBe(4001) // 4000 + ellipsis
    expect(boundTitleInput('short')).toBe('short')
  })
})
