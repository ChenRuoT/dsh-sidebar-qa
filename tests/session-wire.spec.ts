import { describe, expect, it } from 'vitest'
import type { SidebarqaHistoryEntry, SidebarqaHistoryRecord } from '../src/context-types.ts'
import {
  eventsOfChunkRun,
  eventsOfRecords,
  mergeEntries,
  mintRequestId,
  modelSelectionOfProjection,
  remoteErrorText,
  sessionAddress,
  unwrapRemote,
} from '../src/client/session-wire.ts'

function entry(seq: number, type = 'user/message'): SidebarqaHistoryEntry {
  return { event: { type, seq, time: 0, data: {} } }
}

function textRun(texts: string[], dt: number[] = []): SidebarqaHistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: 'chunkrow/text-chunks',
      seq: 10,
      time: 100,
      data: { turn: 1, step: 2, index: 0, dt, texts },
    },
  }
}

describe('sessionAddress', () => {
  it('addresses an ordinary session', () => {
    expect(sessionAddress('s1')).toEqual({ kind: 'session', sessionId: 's1' })
  })
})

describe('remoteErrorText / unwrapRemote', () => {
  it('returns the value of an ok result', () => {
    expect(unwrapRemote({ ok: true, value: { sessionId: 's1' } }, 'create session'))
      .toEqual({ sessionId: 's1' })
  })

  it('throws the operation, code and message of a failure', () => {
    expect(() => unwrapRemote(
      { ok: false, error: { code: 'fork-unavailable', message: 'mid turn' } },
      'fork',
    )).toThrow('fork failed: fork-unavailable: mid turn')
  })

  it('renders one failure as code: message', () => {
    expect(remoteErrorText({ code: 'internal', message: 'boom' })).toBe('internal: boom')
  })
})

describe('mintRequestId', () => {
  it('formats 16 bytes as a UUID with the v4 version and variant bits', () => {
    const id = mintRequestId(new Uint8Array(16).fill(0xff))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Version nibble is forced to 4, variant bits to 0b10.
    expect(id[14]).toBe('4')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('leaves the other bytes untouched', () => {
    expect(mintRequestId(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
  })
})

describe('eventsOfChunkRun', () => {
  it('expands a text run into one assistant/chunk per member', () => {
    expect(eventsOfChunkRun(textRun(['a', 'b', 'c'], [5, 7]).event as never)).toEqual([
      { type: 'assistant/chunk', seq: 10, time: 100, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'a' } } },
      { type: 'assistant/chunk', seq: 11, time: 105, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'b' } } },
      { type: 'assistant/chunk', seq: 12, time: 112, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'c' } } },
    ])
  })

  it('maps a reasoning run to reasoning-delta chunks', () => {
    const events = eventsOfChunkRun({
      type: 'chunkrow/reasoning-chunks',
      seq: 3,
      time: 0,
      data: { turn: 0, step: 0, index: 1, dt: [], texts: ['why'] },
    })
    expect(events[0]?.data).toEqual({ turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 1, text: 'why' } })
  })

  it('maps a tool-call run to tool-call-delta chunks, carrying an optional name', () => {
    const events = eventsOfChunkRun({
      type: 'chunkrow/tool-call-chunks',
      seq: 4,
      time: 0,
      data: { turn: 0, step: 0, index: 0, dt: [], id: 'call-1', name: 'read', args: ['{"a', '":1}'] },
    })
    expect(events.map(event => event.data)).toEqual([
      { turn: 0, step: 0, chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '{"a' } },
      { turn: 0, step: 0, chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '":1}' } },
    ])
  })

  it('yields nothing for a run without members, and treats a missing dt as no gap', () => {
    expect(eventsOfChunkRun({ type: 'chunkrow/text-chunks', seq: 0, time: 0, data: {} })).toEqual([])
    const events = eventsOfChunkRun(textRun(['a', 'b']).event as never)
    expect(events.map(event => event.time)).toEqual([100, 100])
  })
})

describe('eventsOfRecords', () => {
  it('passes scalar records through and expands packed runs in place', () => {
    const records: SidebarqaHistoryRecord[] = [
      { type: 'event', event: { type: 'user/message', seq: 9, time: 0, data: {} } },
      textRun(['a', 'b']),
      { type: 'event', event: { type: 'assistant/message', seq: 12, time: 0, data: {} } },
    ]
    expect(eventsOfRecords(records).map(item => [item.event.type, item.event.seq])).toEqual([
      ['user/message', 9],
      ['assistant/chunk', 10],
      ['assistant/chunk', 11],
      ['assistant/message', 12],
    ])
  })

  it('is empty for an empty page', () => {
    expect(eventsOfRecords([])).toEqual([])
  })
})

describe('mergeEntries', () => {
  it('takes the published window when nothing is loaded yet', () => {
    expect(mergeEntries([], [entry(1), entry(2)]).map(item => item.event.seq)).toEqual([1, 2])
  })

  it('adds unseen seqs and keeps the result ordered', () => {
    const merged = mergeEntries([entry(1), entry(4)], [entry(2), entry(4), entry(5)])
    expect(merged.map(item => item.event.seq)).toEqual([1, 2, 4, 5])
  })

  it('returns the same array when a republished window adds nothing', () => {
    const prev = [entry(1), entry(2)]
    // Identity matters: it is what makes the panel's setState bail out.
    expect(mergeEntries(prev, [entry(1), entry(2)])).toBe(prev)
  })

  it('preserves an upward-loaded page the reopened window does not cover', () => {
    const loadedUpward = [entry(1), entry(2), entry(3)]
    expect(mergeEntries(loadedUpward, [entry(3), entry(4)]).map(item => item.event.seq))
      .toEqual([1, 2, 3, 4])
  })
})

describe('modelSelectionOfProjection', () => {
  it('prefers the selection pinned for the next request', () => {
    expect(modelSelectionOfProjection({
      next: { provider: 'p', model: 'm2' },
      lastUsed: { provider: 'p', model: 'm1' },
    })).toEqual({ provider: 'p', model: 'm2' })
  })

  it('falls back to the last used selection', () => {
    expect(modelSelectionOfProjection({
      next: null,
      lastUsed: { provider: 'p', model: 'm1', reasoningEffort: 'high' },
    })).toEqual({ provider: 'p', model: 'm1', reasoningEffort: 'high' })
  })

  it('omits a non-string reasoning effort rather than forwarding it', () => {
    expect(modelSelectionOfProjection({ next: { provider: 'p', model: 'm', reasoningEffort: 3 } }))
      .toEqual({ provider: 'p', model: 'm' })
  })

  it('reads null for absent, malformed, or incomplete projections', () => {
    expect(modelSelectionOfProjection(undefined)).toBeNull()
    expect(modelSelectionOfProjection(null)).toBeNull()
    expect(modelSelectionOfProjection('deepseek')).toBeNull()
    expect(modelSelectionOfProjection({ next: null, lastUsed: null })).toBeNull()
    expect(modelSelectionOfProjection({ next: { provider: 'p' } })).toBeNull()
  })
})
