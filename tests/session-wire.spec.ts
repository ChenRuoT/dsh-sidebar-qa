import { describe, expect, it } from 'vitest'
import type { Context, SidebarqaFollowFrame, SidebarqaHistoryEntry, SidebarqaHistoryRecord } from '../src/context-types.ts'
import {
  eventsOfRecords,
  followSession,
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

describe('eventsOfRecords', () => {
  it('passes every scalar record through in order', () => {
    // The wire carries scalar events and nothing else
    // (`SessionHistoryRecord = SessionEventEntry`), so this is a faithful map. It
    // used to also expand a `{ type: 'chunks' }` record that does not exist
    // upstream, which made the expansion unreachable code.
    const records: SidebarqaHistoryRecord[] = [
      { type: 'event', event: { type: 'user/message', seq: 9, time: 0, data: {} } },
      { type: 'event', event: { type: 'assistant/message', seq: 12, time: 0, data: {} } },
    ]
    expect(eventsOfRecords(records).map(item => [item.event.type, item.event.seq])).toEqual([
      ['user/message', 9],
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

describe('followSession', () => {
  it('opts into the live stream and forwards every frame kind', async () => {
    const requests: unknown[] = []
    const frames: SidebarqaFollowFrame[] = [
      {
        type: 'snapshot',
        cursor: 12,
        hasMore: true,
        assistantStream: {
          revision: 3,
          activeAttempt: {
            attemptId: 'a',
            startedAfterSeq: 10,
            turn: 0,
            step: 0,
            nextIndex: 1,
            stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [0], texts: ['hi'] }],
          },
        },
        records: [{ type: 'event', event: { type: 'user/message', seq: 9, time: 0, data: {} } }],
      },
      { type: 'event', event: { type: 'assistant/message', seq: 12, time: 0, data: {} } },
      {
        type: 'assistant-stream',
        frame: { type: 'chunk', attemptId: 'a', revision: 4, index: 0, time: 1, chunk: { type: 'text-delta', text: 'hi' } },
      },
      {
        type: 'assistant-stream',
        frame: { type: 'end', attemptId: 'a', revision: 5, index: 1, outcome: { kind: 'abandoned' } },
      },
    ]
    const ctx = {
      remote: {
        session: {
          follow: (request: unknown) => {
            requests.push(request)
            return (async function* generate() {
              for (const frame of frames) yield frame
            })()
          },
        },
      },
    } as unknown as Context

    const seen: string[] = []
    await new Promise<void>((resolve) => {
      followSession(ctx, 's1', {
        snapshot: (input) => {
          seen.push(`snapshot:${String(input.cursor)}:${String(input.assistantStream?.revision)}`)
        },
        append: (item) => { seen.push(`event:${String(item.event.seq)}`) },
        assistantStream: (frame) => {
          seen.push(`frame:${frame.type}`)
          if (frame.type === 'end') resolve()
        },
      })
    })

    // The request opts in — without this flag DSH 0.2.x sends no live frames.
    expect(requests).toEqual([{
      address: { kind: 'session', sessionId: 's1' },
      maxMessages: 60,
      assistantStream: true,
    }])
    expect(seen).toEqual(['snapshot:12:3', 'event:12', 'frame:chunk', 'frame:end'])
  })
})
