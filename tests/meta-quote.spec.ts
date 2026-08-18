import { describe, expect, it } from 'vitest'
import { resolveMetaQuote, consumeMetaQuote } from '../src/client/meta-quote.ts'

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
