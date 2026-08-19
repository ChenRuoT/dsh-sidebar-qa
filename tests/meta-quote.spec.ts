import { describe, expect, it } from 'vitest'
import { resolveMetaQuote, consumeMetaQuote, resolveAskMode } from '../src/client/meta-quote.ts'

describe('resolveMetaQuote', () => {
  it('reads a plain text quote off the meta slot', () => {
    expect(resolveMetaQuote({ quote: '选中的一段内容' })).toEqual({ text: '选中的一段内容' })
  })

  it('passes optional fields through when they are strings', () => {
    expect(resolveMetaQuote({ quote: 'text', role: 'user', messageId: 'm1' }))
      .toEqual({ text: 'text', role: 'user', messageId: 'm1' })
  })

  it('rejects absent, non-object, or blank meta', () => {
    expect(resolveMetaQuote(undefined)).toBeNull()
    expect(resolveMetaQuote(null)).toBeNull()
    expect(resolveMetaQuote('quote')).toBeNull()
    expect(resolveMetaQuote(42)).toBeNull()
    expect(resolveMetaQuote({})).toBeNull()
    expect(resolveMetaQuote({ quote: '' })).toBeNull()
    expect(resolveMetaQuote({ quote: '   ' })).toBeNull()
    expect(resolveMetaQuote({ quote: 42 })).toBeNull()
  })

  it('ignores non-string optional fields instead of passing them', () => {
    expect(resolveMetaQuote({ quote: 'text', role: 42, messageId: null }))
      .toEqual({ text: 'text' })
  })
})

describe('consumeMetaQuote', () => {
  it('strips the quote key and keeps sibling keys', () => {
    expect(consumeMetaQuote({ quote: 'text', other: 1 })).toEqual({ other: 1 })
  })

  it('leaves meta without a quote untouched (same reference)', () => {
    const meta = { other: 1 }
    expect(consumeMetaQuote(meta)).toBe(meta)
  })

  it('passes absent or non-object meta through', () => {
    expect(consumeMetaQuote(undefined)).toBeUndefined()
    expect(consumeMetaQuote(null)).toBeNull()
    expect(consumeMetaQuote('x')).toBe('x')
  })
})

describe('resolveAskMode', () => {
  it('starts a new follow-up when a quote is parked and nothing is selected', () => {
    expect(resolveAskMode(true, null)).toBe('start')
  })

  it('returns to the selected conversation even while a quote is parked (switcher regression)', () => {
    expect(resolveAskMode(true, 'child-a')).toBe('conversation')
  })

  it('shows the empty hint without a quote and without a selection', () => {
    expect(resolveAskMode(false, null)).toBe('empty')
  })

  it('stays in conversation without a quote once a child is selected', () => {
    expect(resolveAskMode(false, 'child-a')).toBe('conversation')
  })
})
