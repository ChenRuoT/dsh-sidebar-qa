/**
 * The composer-insertion plumbing: reaching `conversation.input.for(scope)`,
 * writing only when the plan says something changed, taking DOM focus, and —
 * above all — degrading to a logged `false` instead of throwing, because this
 * runs inside the selection popover's click handler.
 *
 * `draft-insert.ts` takes `ctx` as a parameter and touches `document` only
 * behind a `typeof document === 'undefined'` guard, so it is fully testable in
 * the `node` environment with inline fakes (style: `ensure-panel.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertQuoteIntoComposer, insertQuoteIntoComposerDeferred } from '../src/client/draft-insert.ts'
import type { Context } from '../src/context-types.ts'

interface FakeEditor {
  rootElement: { focus: (options?: { preventScroll?: boolean }) => void } | null
  focus: () => void
}

interface FakeInput {
  draft: string
  setDraft: (text: string) => void
  editor?: FakeEditor
}

/** Record every observable call in order, so ordering can be asserted. */
function makeInput(options: { draft?: string; withEditor?: boolean } = {}) {
  const calls: string[] = []
  const rootFocus = vi.fn((_options?: { preventScroll?: boolean }) => { calls.push('rootFocus') })
  const editorFocus = vi.fn(() => { calls.push('editorFocus') })
  const setDraft = vi.fn((text: string) => { calls.push(`setDraft:${text}`) })
  const input: FakeInput = {
    draft: options.draft ?? '',
    setDraft,
    ...(options.withEditor === false ? {} : {
      editor: { rootElement: { focus: rootFocus }, focus: editorFocus },
    }),
  }
  return { input, calls, setDraft, rootFocus, editorFocus }
}

/**
 * A session list snapshot in DSH's REAL shape.
 *
 * The current session is the one the MAIN VIEW retains
 * (`retainedBy.mainView > 0`, per `client/ui-workspace/src/client/tree.ts:41`) —
 * there is no `current` field. Fixtures that hand-wrote one were exercising a
 * property this plugin invented, which is exactly how 「添加到对话」 came to look
 * for a session in a field that never existed.
 * @param currentSessionId - the session to mark as main-view retained, if any.
 */
function sessionListOf(currentSessionId: string | undefined): {
  ids: readonly string[]
  byId: Record<string, { id: string; retainedBy: { mainView: number }; updatedAt: number }>
} {
  const ids = currentSessionId === undefined ? [] : [currentSessionId]
  const byId: Record<string, { id: string; retainedBy: { mainView: number }; updatedAt: number }> = {}
  for (const id of ids) byId[id] = { id, retainedBy: { mainView: 1 }, updatedAt: 1 }
  return { ids, byId }
}

/**
 * Build a ctx whose `scope`/`get` behavior each test can bend.
 *
 * The sessions slice carries a real list feed, because the write path may have to
 * make its target session visible first: reaching a composer needs that session's
 * Agent scope, and a scope exists only for a mounted session. Navigation itself
 * lives on `uiWorkspace`, not on the sessions service.
 */
function makeCtx(options: {
  input?: FakeInput
  scope?: unknown
  conversation?: unknown
  forImpl?: () => unknown
  /** The session the list marks as current; `null` means "none". */
  currentSession?: string | null
} = {}): Context {
  const scoped = options.scope === undefined ? {} : options.scope
  const conversation = 'conversation' in options
    ? options.conversation
    : {
      input: {
        for: options.forImpl ?? (() => ({
          state: { getSnapshot: () => ({ draft: options.input?.draft ?? '' }) },
          setDraft: options.input?.setDraft ?? (() => {}),
          editor: options.input?.editor === undefined ? undefined : {
            getRootElement: () => options.input?.editor?.rootElement ?? null,
            focus: options.input.editor.focus,
          },
        })),
      },
    }
  const currentSession = options.currentSession === undefined ? 's1' : options.currentSession
  return {
    sessions: {
      scope: () => scoped,
      list: { getSnapshot: () => sessionListOf(currentSession ?? undefined) },
    },
    get: (name: string) => {
      if (name === 'conversation') return conversation
      // Switching the shown session goes through DSH's workspace service, NOT the
      // sessions service (which has no navigation entry at all). Tests that care
      // about it build their own ctx — see `ctxWithCurrent`.
      if (name === 'uiWorkspace') return { openSession: () => {} }
      return undefined
    },
  } as unknown as Context
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('insertQuoteIntoComposer — happy path', () => {
  it('writes the planned draft, then focuses, and reports success', () => {
    const fake = makeInput({ draft: 'why?' })
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok.ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('why?\n\n> x\n\n')
    // setDraft must land BEFORE focus: focus re-applies the selection setDraft
    // parked at the end, so the reverse order would restore a stale caret.
    expect(fake.calls).toEqual(['setDraft:why?\n\n> x\n\n', 'rootFocus', 'editorFocus'])
  })

  it('focuses the root element with preventScroll', () => {
    const fake = makeInput()
    insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')
    expect(fake.rootFocus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('insertQuoteIntoComposer — nothing to write', () => {
  it('skips setDraft but still focuses when the plan is unchanged', () => {
    // A blank selection plans no change; focusing anyway is the friendlier
    // outcome (the user asked to act on the composer) and stays truthful.
    const fake = makeInput({ draft: 'why?' })
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', '   ')

    expect(ok.ok).toBe(true)
    expect(fake.setDraft).not.toHaveBeenCalled()
    expect(fake.calls).toEqual(['rootFocus', 'editorFocus'])
  })
})

describe('insertQuoteIntoComposer — unreachable composer', () => {
  it('re-resolves an empty selection id from the live session feed', () => {
    // The selection records the current session at DRAG time, and the list feed
    // fills in from the Host — a selection made in the first moments after load
    // carries an empty id. The write must not treat that as fatal.
    const fake = makeInput({ draft: 'why?' })
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input, currentSession: 's1' }), '', 'x')

    expect(ok.ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('why?\n\n> x\n\n')
  })

  it('reports missing-session when neither the selection nor the feed names one', () => {
    const scope = vi.fn()
    const ctx = {
      sessions: {
        scope,
        open: () => {},
        list: { getSnapshot: () => ({ ids: [], byId: {} }) },
      },
      get: () => undefined,
    } as unknown as Context

    expect(insertQuoteIntoComposer(ctx, '', 'x')).toMatchObject({ ok: false, failure: 'missing-session' })
    expect(scope).not.toHaveBeenCalled()
  })

  it('returns scope-unavailable when the session scope does not resolve', () => {
    const get = vi.fn()
    const ctx = {
      sessions: {
        scope: () => undefined,
        open: () => {},
        list: { getSnapshot: () => sessionListOf('s1') },
      },
      get,
    } as unknown as Context
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toMatchObject({ ok: false, failure: 'scope-unavailable' })
    expect(get).not.toHaveBeenCalled()
  })

  it('returns no-conversation-service when ui-conversation is absent', () => {
    // A DSH build without ui-conversation must not break the popover.
    expect(insertQuoteIntoComposer(makeCtx({ conversation: undefined }), 's1', 'x'))
      .toMatchObject({ ok: false, failure: 'no-conversation-service' })
  })
})

describe('insertQuoteIntoComposer — throwing internals', () => {
  it('swallows a throw from input.for and logs once', () => {
    const ctx = makeCtx({ forImpl: () => { throw new Error('no binding') } })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toMatchObject({ ok: false, failure: 'threw' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('swallows a throw from getSnapshot', () => {
    const ctx = makeCtx({
      forImpl: () => ({
        state: { getSnapshot: () => { throw new Error('detached') } },
        setDraft: () => {},
      }),
    })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toMatchObject({ ok: false, failure: 'threw' })
  })

  it('swallows a throw from setDraft', () => {
    const ctx = makeCtx({
      forImpl: () => ({
        state: { getSnapshot: () => ({ draft: '' }) },
        setDraft: () => { throw new Error('editor disposed') },
      }),
    })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toMatchObject({ ok: false, failure: 'threw' })
  })
})

describe('insertQuoteIntoComposer — focus degradation', () => {
  it('still succeeds when the editor field is absent and there is no document', () => {
    // The upstream-drift fallback: `editor` is not on the frozen SessionInput
    // interface, so its disappearance must cost only the caret guarantee.
    expect(typeof document).toBe('undefined')
    const fake = makeInput({ withEditor: false })
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok.ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('> x\n\n')
  })

  it('still focuses the editor when getRootElement returns null', () => {
    const fake = makeInput()
    fake.input.editor!.rootElement = null
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok.ok).toBe(true)
    expect(fake.editorFocus).toHaveBeenCalledTimes(1)
  })

  it('reports success even when focusing throws — the draft already landed', () => {
    const fake = makeInput()
    fake.input.editor!.focus = () => { throw new Error('detached root') }
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok.ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('> x\n\n')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('insertQuoteIntoComposer — making the target session visible', () => {
  /**
   * A ctx whose session feed reports `current` and whose workspace service records
   * its navigations.
   *
   * The double mirrors the one behaviour the callers depend on: DSH's
   * `retain(target, { source: 'mainView' })` is SYNCHRONOUS, so the feed reports the
   * target as the main-view session the moment `openSession` returns.
   */
  function ctxWithCurrent(scopeFor: (id: string) => unknown, current: string) {
    const switched: string[] = []
    let reported = current
    const ctx = {
      sessions: {
        scope: scopeFor,
        list: { getSnapshot: () => sessionListOf(reported) },
      },
      get: (name: string) => {
        if (name === 'uiWorkspace') {
          return { openSession: (id: string) => { switched.push(id); reported = id } }
        }
        return {
          input: {
            for: () => ({
              state: { getSnapshot: () => ({ draft: '' }) },
              setDraft: () => {},
              editor: undefined,
            }),
          },
        }
      },
    } as unknown as Context
    return { ctx, switched }
  }

  it('switches to the quoted session when it is not the one on screen', () => {
    // Reaching a composer needs that session's Agent scope, and a scope is
    // retained only while the session is mounted — so the button makes its target
    // current rather than refusing.
    const { ctx, switched } = ctxWithCurrent(() => ({}), 'other')
    expect(insertQuoteIntoComposer(ctx, 's9', 'x').ok).toBe(true)
    expect(switched).toEqual(['s9'])
  })

  it('does not switch when the quoted session is already current', () => {
    const { ctx, switched } = ctxWithCurrent(() => ({}), 's9')
    expect(insertQuoteIntoComposer(ctx, 's9', 'x').ok).toBe(true)
    expect(switched).toEqual([])
  })

  it('survives a missing client sessions service', () => {
    const ctx = { sessions: undefined, get: () => undefined } as unknown as Context
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toMatchObject({ ok: false, failure: 'threw' })
  })
})

describe('insertQuoteIntoComposerDeferred', () => {
  /** Install a controllable requestAnimationFrame for one test. */
  function withFrame(): { flush: () => void; restore: () => void } {
    const queue: Array<() => void> = []
    const previous = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (fn: () => void) => {
      queue.push(fn)
      return queue.length
    }
    return {
      flush: () => { for (const fn of queue.splice(0)) fn() },
      restore: () => { (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previous },
    }
  }

  it('retries on the next frame when the target is not reachable yet', () => {
    // An immediate attempt can still miss — a session whose scope the controller
    // has not published, or a feed that has not named a current session — so a
    // failed attempt is deferred rather than reported as a dead click.
    const frame = withFrame()
    let retained = false
    let current = 'other'
    const switched: string[] = []
    const ctx = {
      sessions: {
        scope: () => (retained ? {} : undefined),
        list: { getSnapshot: () => sessionListOf(current) },
      },
      get: (name: string) => (name === 'uiWorkspace'
        ? { openSession: (id: string) => { switched.push(id); current = id } }
        : {
          input: {
            for: () => ({
              state: { getSnapshot: () => ({ draft: '' }) },
              setDraft: () => {},
              editor: undefined,
            }),
          },
        }),
    } as unknown as Context

    insertQuoteIntoComposerDeferred(ctx, 's1', 'x')
    // A retryable miss is deliberately NOT reported: the retry may still land, and a
    // successful cross-session insert must not log a failure on its way in.
    expect(warn).not.toHaveBeenCalled()
    expect(switched).toEqual(['s1'])

    retained = true
    frame.flush()
    expect(warn).not.toHaveBeenCalled()
    frame.restore()
  })

  it('retries an EMPTY selection id, which the feed may name by then', () => {
    // The real failure this covers: a selection made before the session feed
    // named a current session. Treating an empty id as unrecoverable skipped the
    // one retry that fixes it.
    const frame = withFrame()
    let current: string | undefined
    const setDraft = vi.fn()
    const ctx = {
      sessions: {
        scope: () => ({}),
        list: { getSnapshot: () => sessionListOf(current) },
      },
      get: (name: string) => (name === 'uiWorkspace'
        ? { openSession: () => {} }
        : {
          input: {
            for: () => ({
              state: { getSnapshot: () => ({ draft: '' }) },
              setDraft,
              editor: undefined,
            }),
          },
        }),
    } as unknown as Context

    insertQuoteIntoComposerDeferred(ctx, '', 'x')
    expect(setDraft).not.toHaveBeenCalled()
    // Nothing is reported while a retry is still available.
    expect(warn).not.toHaveBeenCalled()

    current = 's1'
    frame.flush()
    expect(setDraft).toHaveBeenCalledWith('> x\n\n')
    // It recovered, so the console stays clean.
    expect(warn).not.toHaveBeenCalled()
    frame.restore()
  })

  it('does not retry a failure that a retry cannot fix', () => {
    const frame = withFrame()
    const ctx = makeCtx({ conversation: undefined })
    insertQuoteIntoComposerDeferred(ctx, 's1', 'x')
    frame.flush()
    // Exactly one report: the conversation service will not appear on the next
    // frame, so retrying would only double the noise.
    expect(warn).toHaveBeenCalledTimes(1)
    frame.restore()
  })

  it('stays quiet when the first attempt succeeds', () => {
    const frame = withFrame()
    const fake = makeInput({ draft: 'why?' })
    insertQuoteIntoComposerDeferred(makeCtx({ input: fake.input }), 's1', 'x')
    frame.flush()
    expect(fake.setDraft).toHaveBeenCalledWith('why?\n\n> x\n\n')
    expect(warn).not.toHaveBeenCalled()
    frame.restore()
  })
})