import { describe, expect, it } from 'vitest'
import {
  boundText,
  buildFirstMessage,
  buildQuotedContext,
  escapeXml,
  FOLLOWUP_INTRO,
  followUpTitle,
  parseUserMessage,
  sanitizeText,
  topicFromQuote,
  unescapeXml,
} from '../src/client/injection.ts'

describe('escapeXml', () => {
  it('escapes the five special characters', () => {
    expect(escapeXml('a<b>&c"d\'e')).toBe('a&lt;b&gt;&amp;c&quot;d&apos;e')
  })
})

describe('sanitizeText', () => {
  it('strips control characters and NUL', () => {
    expect(sanitizeText('a\u0000b\u001fc\u007fd')).toBe('abcd')
  })
})

describe('boundText', () => {
  it('bounds and ellipsizes', () => {
    expect(boundText('1234567890', 5)).toBe('12345…')
  })
  it('passes through short text', () => {
    expect(boundText('abc', 5)).toBe('abc')
  })
})

describe('buildQuotedContext', () => {
  it('emits escaped attributes and body', () => {
    const out = buildQuotedContext({ text: 'x<y', role: 'assistant', messageId: 'm1' }, 'Agent 回复')
    expect(out).toContain('source="agent-history"')
    expect(out).toContain('message_id="m1"')
    expect(out).toContain('role="assistant"')
    expect(out).toContain('x&lt;y')
  })
  it('omits selection offsets without messageId', () => {
    const out = buildQuotedContext({ text: 'hello' }, 'Agent 回复')
    expect(out).not.toContain('selection_start')
    expect(out).not.toContain('selection_end')
  })
})

describe('buildFirstMessage', () => {
  it('prepends the governing intro at the very start', () => {
    const out = buildFirstMessage('摘要', { text: '引文' }, '问题', 'Agent 回复')
    expect(out.startsWith(FOLLOWUP_INTRO)).toBe(true)
  })
  it('includes summary + quote + question after the intro', () => {
    const out = buildFirstMessage('摘要', { text: '引文' }, '问题', 'Agent 回复')
    expect(out).toContain('【主对话上下文】')
    expect(out).toContain('摘要')
    expect(out).toContain('<quoted_context')
    expect(out).toContain('问题：问题')
  })
  it('skips summary when null (intro still leads)', () => {
    const out = buildFirstMessage(null, { text: '引文' }, '问题', 'Agent 回复')
    expect(out.startsWith(FOLLOWUP_INTRO)).toBe(true)
    expect(out).not.toContain('【主对话上下文】')
  })
})

describe('topicFromQuote', () => {
  it('uses the first non-blank line', () => {
    expect(topicFromQuote('  你好世界\n更多')).toBe('你好世界')
  })
  it('bounds long topics', () => {
    expect(topicFromQuote('abcdefghijklmnop')).toBe('abcdefghijkl…')
  })
  it('falls back to 追问 on blank', () => {
    expect(topicFromQuote('   \n  ')).toBe('追问')
  })
})

describe('followUpTitle', () => {
  it('prefixes the subject', () => {
    expect(followUpTitle('主题')).toBe('❓追问·主题')
  })
})

describe('unescapeXml', () => {
  it('reverses escapeXml', () => {
    expect(unescapeXml('a&lt;b&gt;&amp;c&quot;d&apos;e')).toBe('a<b>&c"d\'e')
  })
})

describe('parseUserMessage', () => {
  it('round-trips a first message: quote is ONLY the selected text', () => {
    const selected = 'effects/coeffects 恰好对应…coeffect 像信念：…'
    const message = buildFirstMessage('【背景】…\n【近期对话】用户：…\n助手：…', { text: selected }, '我的问题', 'Agent 回复')
    const { quote, question } = parseUserMessage(message)
    expect(quote).toBe(selected)
    expect(question).toBe('我的问题')
    expect(quote).not.toContain('【主对话上下文】')
    expect(quote).not.toContain('用户：')
    expect(quote).not.toContain('这是一次「侧边栏追问」')
  })

  it('does not let the bare <quoted_context> mention in the intro match', () => {
    // FOLLOWUP_INTRO contains the literal "见 <quoted_context> 块"; the real
    // block always carries attributes. The parse must anchor on the real block.
    expect(FOLLOWUP_INTRO).toContain('<quoted_context>')
    const message = buildFirstMessage(null, { text: '选中文本' }, '问', 'Agent 回复')
    const { quote } = parseUserMessage(message)
    expect(quote).toBe('选中文本')
  })

  it('returns the whole text as the question when there is no quote', () => {
    expect(parseUserMessage('直接问一句')).toEqual({ quote: null, question: '直接问一句' })
  })
})
