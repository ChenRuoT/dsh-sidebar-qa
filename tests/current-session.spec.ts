import { describe, expect, it } from 'vitest'
import { resolveCurrentSessionId, type CurrentSessionList } from '../src/client/current-session.ts'

/** A row, with a main-view retain count and an activity stamp. */
function row(id: string, mainView: number, updatedAt?: number) {
  return {
    id,
    retainedBy: { mainView },
    ...updatedAt === undefined ? {} : { updatedAt },
  }
}

/** A list over the given rows, in the given host order. */
function listOf(rows: ReturnType<typeof row>[], ids = rows.map(r => r.id)): CurrentSessionList {
  return {
    ids,
    byId: Object.fromEntries(rows.map(r => [r.id, r])),
  }
}

describe('resolveCurrentSessionId', () => {
  it('returns the session the main view retains', () => {
    // The rule DSH's own workspace tree uses
    // (`client/ui-workspace/src/client/tree.ts:41`).
    expect(resolveCurrentSessionId(listOf([
      row('a', 0),
      row('b', 1),
      row('c', 0),
    ]))).toBe('b')
  })

  it('returns undefined when nothing retains the main view', () => {
    // The state the 「添加到对话」 button hit: not "no sessions", just none on
    // screen. Answering with a guess would write into the wrong conversation.
    expect(resolveCurrentSessionId(listOf([row('a', 0), row('b', 0)]))).toBeUndefined()
  })

  it('returns undefined for an absent or empty list', () => {
    expect(resolveCurrentSessionId(undefined)).toBeUndefined()
    expect(resolveCurrentSessionId({})).toBeUndefined()
    expect(resolveCurrentSessionId({ ids: [], byId: {} })).toBeUndefined()
  })

  it('prefers the newest activity while a switch overlaps', () => {
    // A switch retains the incoming session before releasing the outgoing one,
    // so two rows can hold the main view for a moment.
    expect(resolveCurrentSessionId(listOf([
      row('old', 1, 100),
      row('new', 1, 200),
    ]))).toBe('new')
  })

  it('falls back to host order when no row carries an activity stamp', () => {
    expect(resolveCurrentSessionId(listOf([row('first', 1), row('second', 1)]))).toBe('first')
  })

  it('prefers a stamped row over an unstamped one', () => {
    expect(resolveCurrentSessionId(listOf([row('unstamped', 1), row('stamped', 1, 5)]))).toBe('stamped')
  })

  it('reads a negative or missing retain count as not retained', () => {
    const list = {
      ids: ['a', 'b'],
      byId: {
        a: { id: 'a', retainedBy: { mainView: -1 } },
        b: { id: 'b', retainedBy: { otherSource: 1 } },
      },
    }
    expect(resolveCurrentSessionId(list)).toBeUndefined()
  })

  it('uses the row key when a row carries no id of its own', () => {
    const list = { ids: ['k'], byId: { k: { retainedBy: { mainView: 1 } } } }
    expect(resolveCurrentSessionId(list)).toBe('k')
  })

  it('is deterministic across Object key order', () => {
    // `byId` insertion order is not part of the contract; `ids` is.
    const forward = listOf([row('a', 1), row('b', 1)], ['a', 'b'])
    const reversed = { ids: ['a', 'b'], byId: { b: row('b', 1), a: row('a', 1) } }
    expect(resolveCurrentSessionId(forward)).toBe(resolveCurrentSessionId(reversed))
  })
})
