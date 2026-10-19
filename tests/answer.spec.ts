import { describe, expect, it } from 'vitest'
import type { SidebarqaHistoryEntry } from '../src/context-types.ts'
import {
  answerTextOf,
  applyAssistantStreamFrame,
  assistantAttemptOf,
  failureOfStreamChunk,
  foldAssistantStreamRecords,
  hasSeedHistory,
  hasTurnEnded,
  lastEndSeedIndex,
  liveStreamOf,
  textOfAssistantMessage,
  textOfStreamChunk,
  textOfUserMessage,
  transcriptOf,
  transcriptRowsOf,
} from '../src/client/answer.ts'

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

describe('lastEndSeedIndex / hasSeedHistory', () => {
  it('finds the end-seed marker of a fork child', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '父对话问题' }] }, 0),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '父对话回答' }] } }, 1),
      entry('session/end-seed', {}, 2),
      entry('user/message', { content: [{ type: 'text', text: '追问' }] }, 3),
    ]
    expect(lastEndSeedIndex(events)).toBe(2)
    expect(hasSeedHistory(events)).toBe(true)
  })

  it('returns -1 / false for a plain (non-fork) session', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 0),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '回答' }] } }, 1),
    ]
    expect(lastEndSeedIndex(events)).toBe(-1)
    expect(hasSeedHistory(events)).toBe(false)
  })

  it('takes the LAST marker for nested forks (the child\'s own boundary)', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '祖父对话' }] }, 0),
      entry('session/end-seed', {}, 1),
      entry('user/message', { content: [{ type: 'text', text: '父追问' }] }, 2),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '父回答' }] } }, 3),
      entry('session/end-seed', {}, 4),
      entry('user/message', { content: [{ type: 'text', text: '孙追问' }] }, 5),
    ]
    expect(lastEndSeedIndex(events)).toBe(4)
  })

  it('is empty-safe', () => {
    expect(lastEndSeedIndex([])).toBe(-1)
    expect(hasSeedHistory([])).toBe(false)
  })
})

describe('transcriptRowsOf', () => {
  it('carries each row\'s event seq', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 3),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '回答' }] } }, 4),
    ]
    expect(transcriptRowsOf(events)).toEqual([
      { role: 'user', text: '问题', seq: 3 },
      { role: 'assistant', text: '回答', seq: 4 },
    ])
  })

  it('gives the in-flight aggregate the last chunk seq', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 1),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '还' } }, 2),
      entry('assistant/chunk', { chunk: { type: 'text-delta', text: '在写' } }, 3),
    ]
    expect(transcriptRowsOf(events)).toEqual([
      { role: 'user', text: '问题', seq: 1 },
      { role: 'assistant', text: '还在写', seq: 3 },
    ])
  })

  it('mirrors transcriptOf content (drops snapshots, folds chunks)', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } }, 1),
      entry('user/message', {
        content: [{ type: 'text', text: 'Current runtime context…' }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      }, 2),
      entry('assistant/message', { message: { content: [{ type: 'text', text: '回答' }] } }, 3),
    ]
    expect(transcriptRowsOf(events).map(({ role, text }) => ({ role, text })))
      .toEqual(transcriptOf(events))
  })
})

describe('hasTurnEnded', () => {
  it('detects a finished turn', () => {
    expect(hasTurnEnded([entry('turn/end', { turn: 0, reason: { kind: 'completed' } })])).toBe(true)
    expect(hasTurnEnded([entry('assistant/message', {})])).toBe(false)
  })
})

describe('textOfStreamChunk / failureOfStreamChunk', () => {
  it('folds only text deltas', () => {
    expect(textOfStreamChunk({ type: 'text-delta', index: 0, text: 'hello' })).toBe('hello')
    expect(textOfStreamChunk({ type: 'reasoning-delta', text: 'why' })).toBe('')
    expect(textOfStreamChunk(undefined)).toBe('')
    expect(textOfStreamChunk('text')).toBe('')
  })

  it('reads the failure of a terminal finish chunk, but not of a normal stop', () => {
    expect(failureOfStreamChunk({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'provider exploded', code: 'llm/error' } },
    })).toBe('provider exploded')
    expect(failureOfStreamChunk({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'stopped' } },
    })).toBe('stopped')
    expect(failureOfStreamChunk({ type: 'finish', reason: { kind: 'stop' } })).toBeUndefined()
    expect(failureOfStreamChunk({ type: 'text-delta', text: 'x' })).toBeUndefined()
    expect(failureOfStreamChunk(null)).toBeUndefined()
  })
})

describe('foldAssistantStreamRecords', () => {
  it('folds packed text runs and raw text-delta chunks together', () => {
    const folded = foldAssistantStreamRecords([
      { type: 'text-chunks', time0: 1, index: 0, dt: [0, 1], texts: ['he', 'llo'] },
      { type: 'reasoning-chunks', time0: 1, index: 0, dt: [0], texts: ['ignored'] },
      { type: 'chunk', time: 3, chunk: { type: 'text-delta', index: 0, text: ' world' } },
    ])
    expect(folded).toEqual({ text: 'hello world' })
  })

  it('carries the finish failure of a failed attempt', () => {
    const folded = foldAssistantStreamRecords([
      { type: 'text-chunks', time0: 1, index: 0, dt: [0], texts: ['partial'] },
      { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } } },
    ])
    expect(folded).toEqual({ text: 'partial', failure: 'boom' })
  })

  it('is empty-safe for malformed input', () => {
    expect(foldAssistantStreamRecords(undefined)).toEqual({ text: '' })
    expect(foldAssistantStreamRecords([null, 'x', { type: 'text-chunks', texts: [1, 'ok'] }]))
      .toEqual({ text: 'ok' })
  })
})

describe('assistant/attempt events', () => {
  it('becomes a failed assistant row with the partial text', () => {
    const events = [
      entry('user/message', { content: [{ type: 'text', text: '问题' }] }, 1),
      entry('assistant/attempt', {
        turn: 0,
        step: 0,
        stream: [
          { type: 'text-chunks', time0: 1, index: 0, dt: [0], texts: ['半截回答'] },
          { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } } },
        ],
      }, 2),
    ]
    expect(transcriptRowsOf(events)).toEqual([
      { role: 'user', text: '问题', seq: 1 },
      { role: 'assistant', text: '半截回答', seq: 2, failure: 'boom' },
    ])
    expect(transcriptOf(events)).toEqual([
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '半截回答', failure: 'boom' },
    ])
  })

  it('is ignored when it carries neither text nor failure', () => {
    expect(assistantAttemptOf(entry('assistant/attempt', { stream: [] }, 5).event)).toEqual({ text: '' })
    expect(transcriptOf([entry('assistant/attempt', { stream: [] }, 5)])).toEqual([])
  })

  it('makes answerTextOf omit failed rows (title input stays clean)', () => {
    const events = [
      entry('assistant/message', { message: { content: [{ type: 'text', text: '成功' }] } }, 1),
      entry('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'x' } } } }] }, 2),
    ]
    expect(answerTextOf(events)).toBe('成功')
  })
})

describe('live assistant frames', () => {
  it('starts empty, appends text deltas, and records a failure', () => {
    let state = applyAssistantStreamFrame(null, { type: 'start', attemptId: 'a', revision: 1, startedAfterSeq: 10, turn: 0, step: 0 })
    expect(state).toEqual({ startedAfterSeq: 10, text: '' })
    state = applyAssistantStreamFrame(state, { type: 'chunk', attemptId: 'a', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', text: '你' } })
    state = applyAssistantStreamFrame(state, { type: 'chunk', attemptId: 'a', revision: 3, index: 1, time: 2, chunk: { type: 'text-delta', text: '好' } })
    expect(state).toEqual({ startedAfterSeq: 10, text: '你好' })
    state = applyAssistantStreamFrame(state, { type: 'chunk', attemptId: 'a', revision: 4, index: 2, time: 3, chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } } })
    expect(state).toEqual({ startedAfterSeq: 10, text: '你好', failure: 'boom' })
  })

  it('keeps a committed attempt for the durable settlement, and clears an abandoned one', () => {
    const state = { startedAfterSeq: 10, text: 'x' }
    expect(applyAssistantStreamFrame(state, { type: 'end', attemptId: 'a', revision: 5, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 11 } })).toBe(state)
    expect(applyAssistantStreamFrame(state, { type: 'end', attemptId: 'a', revision: 5, index: 1, outcome: { kind: 'abandoned' } })).toBeNull()
  })

  it('rebuilds the in-flight row from a reconnect baseline', () => {
    expect(liveStreamOf(undefined)).toBeNull()
    expect(liveStreamOf({ revision: 3, activeAttempt: {
      attemptId: 'a', startedAfterSeq: 7, turn: 0, step: 0, nextIndex: 2,
      stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [0], texts: ['partial'] }],
    } })).toEqual({ startedAfterSeq: 7, text: 'partial' })
  })
})
