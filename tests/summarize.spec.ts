import { describe, expect, it } from 'vitest'
import type { SidebarqaSurfaceEvent } from '../src/context-types.ts'
import {
  assembleText,
  buildTrimContext,
  composeSummary,
  extractSegments,
  formatBackground,
  formatSegments,
  splitRecent,
  textOfEvent,
} from '../src/summarize.ts'

function event(type: string, data: Record<string, unknown>, seq = 0): SidebarqaSurfaceEvent {
  return { type, seq, time: 0, data }
}

describe('textOfEvent', () => {
  it('extracts user text blocks (skipping reasoning)', () => {
    expect(textOfEvent(event('user/message', {
      content: [{ type: 'text', text: 'hi' }, { type: 'reasoning', text: 'x' }],
    }))).toBe('hi')
  })
  it('extracts assistant text blocks', () => {
    expect(textOfEvent(event('assistant/message', {
      message: { content: [{ type: 'text', text: 'ans' }] },
    }))).toBe('ans')
  })
  it('skips tool/result noise', () => {
    expect(textOfEvent(event('tool/result', {
      message: { content: [{ type: 'text', text: 'tool-out' }] },
    }))).toBe('')
  })
  it('skips DSH-injected runtime-context snapshots', () => {
    expect(textOfEvent(event('user/message', {
      content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes…' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    }))).toBe('')
  })
  it('skips the skills catalog', () => {
    expect(textOfEvent(event('user/message', {
      content: [{ type: 'text', text: '<system-reminder><available_skills>…</available_skills></system-reminder>' }],
      source: { kind: 'skill-catalog', form: 'catalog' },
    }))).toBe('')
  })
})

describe('extractSegments', () => {
  it('returns ordered role-labeled segments, dropping tool noise', () => {
    const events = [
      event('user/message', { content: [{ type: 'text', text: 'q1' }] }),
      event('assistant/message', { message: { content: [{ type: 'text', text: 'a1' }] } }),
      event('tool/result', {}),
      event('user/message', { content: [{ type: 'text', text: 'q2' }] }),
    ]
    expect(extractSegments(events)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'q2' },
    ])
  })
})

describe('splitRecent', () => {
  it('splits the recent window from the earlier background', () => {
    const segments = [0, 1, 2, 3, 4].map(i => ({ role: 'assistant' as const, text: `m${i}` }))
    const { earlier, recent } = splitRecent(segments, 2)
    expect(earlier.map(s => s.text)).toEqual(['m0', 'm1', 'm2'])
    expect(recent.map(s => s.text)).toEqual(['m3', 'm4'])
  })
  it('keeps everything recent when shorter than the window', () => {
    const segments = [{ role: 'user' as const, text: 'a' }]
    const { earlier, recent } = splitRecent(segments, 4)
    expect(earlier).toEqual([])
    expect(recent).toEqual(segments)
  })
})

describe('formatSegments', () => {
  it('role-labels and separates segments', () => {
    const segments = [
      { role: 'user' as const, text: '你好' },
      { role: 'assistant' as const, text: '收到' },
    ]
    expect(formatSegments(segments, 1000)).toBe('用户：你好\n\n助手：收到')
  })
  it('bounds each segment', () => {
    expect(formatSegments([{ role: 'assistant' as const, text: 'abcdefghij' }], 5)).toBe('助手：abcde…')
  })
})

describe('composeSummary', () => {
  it('combines background and recent', () => {
    expect(composeSummary('背景', '近期')).toBe('【背景】\n背景\n\n【近期对话】\n近期')
  })
  it('omits absent parts', () => {
    expect(composeSummary('', '近期')).toBe('【近期对话】\n近期')
    expect(composeSummary('背景', '')).toBe('【背景】\n背景')
    expect(composeSummary('', '')).toBe('')
  })
})

describe('formatBackground', () => {
  it('renders the newest background segments first (current progress on top)', () => {
    const segments = [
      { role: 'user' as const, text: '读 taskbook，先做个计划' },
      { role: 'assistant' as const, text: '好，计划如下……' },
      { role: 'user' as const, text: '三点反馈都改好了，已全部落地' },
      { role: 'assistant' as const, text: '已确认，三点全部完成' },
    ]
    // Take the newest 3 of the background window, newest-first.
    expect(formatBackground(segments, 3, 1000)).toBe([
      '助手：已确认，三点全部完成',
      '用户：三点反馈都改好了，已全部落地',
      '助手：好，计划如下……',
    ].join('\n\n'))
  })
  it('takes the whole background when count exceeds its length', () => {
    const segments = [
      { role: 'user' as const, text: 'a' },
      { role: 'assistant' as const, text: 'b' },
    ]
    expect(formatBackground(segments, 10, 1000)).toBe('助手：b\n\n用户：a')
  })
  it('renders nothing for an empty background', () => {
    expect(formatBackground([], 5, 1000)).toBe('')
  })
  it('bounds each segment', () => {
    const segments = [{ role: 'assistant' as const, text: 'abcdefghij' }]
    expect(formatBackground(segments, 5, 5)).toBe('助手：abcde…')
  })
})

describe('buildTrimContext', () => {
  const segments = [
    { role: 'user' as const, text: 'q1' },
    { role: 'assistant' as const, text: 'a1' },
    { role: 'user' as const, text: 'q2' },
    { role: 'assistant' as const, text: 'a2' },
  ]

  it('keeps the last N segments verbatim in model order', () => {
    expect(buildTrimContext(segments, 2, 1000)).toBe('用户：q2\n\n助手：a2')
  })

  it('keeps the whole tail when count exceeds the segment count', () => {
    expect(buildTrimContext(segments, 10, 1000)).toBe('用户：q1\n\n助手：a1\n\n用户：q2\n\n助手：a2')
  })

  it('bounds each segment like the other windows', () => {
    expect(buildTrimContext(segments, 1, 1)).toBe('助手：a…')
  })

  it('returns empty for a zero or negative count', () => {
    expect(buildTrimContext(segments, 0, 1000)).toBe('')
    expect(buildTrimContext(segments, -3, 1000)).toBe('')
  })

  it('returns empty for an empty segment list', () => {
    expect(buildTrimContext([], 5, 1000)).toBe('')
  })
})

describe('assembleText', () => {
  it('accumulates text deltas', async () => {
    const chunks = (async function* () {
      yield { type: 'text-delta', index: 0, text: 'hel' } as const
      yield { type: 'text-delta', index: 0, text: 'lo' } as const
      yield { type: 'finish', reason: { kind: 'completed' } } as const
    })()
    expect(await assembleText(chunks)).toEqual({ text: 'hello', failed: false })
  })
  it('marks failure on an error finish', async () => {
    const chunks = (async function* () {
      yield { type: 'finish', reason: { kind: 'error' } } as const
    })()
    expect(await assembleText(chunks)).toEqual({ text: '', failed: true })
  })
})

describe('locale forwarding', () => {
  const segments = [
    { role: 'user' as const, text: 'q1' },
    { role: 'assistant' as const, text: 'a1' },
  ]

  it('buildTrimContext forwards the locale to the role prefixes', () => {
    // A wrapper that took the parameter but dropped it would emit Chinese
    // prefixes under an English prompt — invisible to every other assertion.
    expect(buildTrimContext(segments, 2, 1000, 'en')).toBe('User: q1\n\nAssistant: a1')
    expect(buildTrimContext(segments, 2, 1000)).toBe('用户：q1\n\n助手：a1')
  })

  it('formatBackground forwards the locale (newest-first is unchanged)', () => {
    expect(formatBackground(segments, 2, 1000, 'en')).toBe('Assistant: a1\n\nUser: q1')
    expect(formatBackground(segments, 2, 1000)).toBe('助手：a1\n\n用户：q1')
  })
})
