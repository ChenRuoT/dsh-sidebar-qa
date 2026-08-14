import { describe, expect, it } from 'vitest'
import type { SidebarqaHistoryEntry } from '../src/context-types.ts'
import { answerTextOf, hasTurnEnded, textOfAssistantMessage, textOfUserMessage, transcriptOf } from '../src/client/answer.ts'

function entry(type: string, data: Record<string, unknown>, seq = 0): SidebarqaHistoryEntry {
  return { event: { type, seq, time: 0, data } }
}

describe('textOfAssistantMessage', () => {
  it('extracts text blocks, skipping reasoning', () => {
    expect(textOfAssistantMessage({
      type: 'assistant/message',
      seq: 1,
      time: 0,
      data: { message: { content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'r' }] } },
    })).toBe('a')
  })
})

describe('textOfUserMessage', () => {
  it('extracts user text blocks', () => {
    expect(textOfUserMessage({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: { content: [{ type: 'text', text: '问题' }] },
    })).toBe('问题')
  })
  it('skips DSH-injected runtime-context snapshots (source.kind === plugin)', () => {
    expect(textOfUserMessage({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: {
        content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes…' }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      },
    })).toBe('')
  })
  it('skips the skills catalog (source.kind === skill-catalog)', () => {
    expect(textOfUserMessage({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: {
        content: [{ type: 'text', text: '<system-reminder>\n<available_skills>\n- `x`: …\n</available_skills>\n</system-reminder>' }],
        source: { kind: 'skill-catalog', form: 'catalog' },
      },
    })).toBe('')
  })
})

describe('transcriptOf', () => {
  it('returns ordered user/assistant messages', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 1),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '回答' }] } }, 2),
    ]
    expect(transcriptOf(events)).toEqual([
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '回答' },
    ])
  })

  it('appends in-flight chunks as a trailing assistant message', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 1),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '还' } }, 2),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '在写' } }, 3),
    ]
    expect(transcriptOf(events)).toEqual([
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '还在写' },
    ])
  })

  it('ignores chunks belonging to a settled assistant message', () => {
    const events = [
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: 'h' } }, 1),
      entry('assistant/message', { message: { content: [{ type: 'text', text: 'hi' }] } }, 2),
    ]
    expect(transcriptOf(events)).toEqual([{ role: 'assistant', text: 'hi' }])
  })

  it('drops runtime-context snapshots from the transcript', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } }, 1),
      entry('user/message', {
        content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes…' }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      }, 2),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '回答' }] } }, 3),
    ]
    expect(transcriptOf(events)).toEqual([
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '回答' },
    ])
  })
})

describe('answerTextOf', () => {
  it('joins settled messages and in-flight chunks', () => {
    const events = [
      entry('assistant/message', { message: { content: [{ type: 'text', text: '第一段' }] } }, 1),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '还' } }, 2),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '在写' } }, 3),
    ]
    expect(answerTextOf(events)).toBe('第一段\n\n还在写')
  })
  it('ignores chunks belonging to a settled message', () => {
    const events = [
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: 'h' } }, 1),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: 'i' } }, 2),
      entry('assistant/message', { message: { content: [{ type: 'text', text: 'hi' }] } }, 3),
    ]
    expect(answerTextOf(events)).toBe('hi')
  })
})

describe('hasTurnEnded', () => {
  it('detects a finished turn', () => {
    expect(hasTurnEnded([entry('turn/end', { turn: 0, reason: { kind: 'completed' } })])).toBe(true)
    expect(hasTurnEnded([entry('assistant/message', {})])).toBe(false)
  })
})
