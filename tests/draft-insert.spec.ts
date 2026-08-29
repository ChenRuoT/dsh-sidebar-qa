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
import { insertQuoteIntoComposer } from '../src/client/draft-insert.ts'
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

/** Build a ctx whose `scope`/`get` behavior each test can bend. */
function makeCtx(options: {
  input?: FakeInput
  scope?: unknown
  conversation?: unknown
  forImpl?: () => unknown
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
  return {
    sessions: { scope: () => scoped },
    get: (name: string) => (name === 'conversation' ? conversation : undefined),
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

    expect(ok).toBe(true)
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

    expect(ok).toBe(true)
    expect(fake.setDraft).not.toHaveBeenCalled()
    expect(fake.calls).toEqual(['rootFocus', 'editorFocus'])
  })
})

describe('insertQuoteIntoComposer — unreachable composer', () => {
  it('returns false for an empty session id without touching the services', () => {
    const scope = vi.fn()
    const ctx = { sessions: { scope }, get: () => undefined } as unknown as Context
    expect(insertQuoteIntoComposer(ctx, '', 'x')).toBe(false)
    expect(scope).not.toHaveBeenCalled()
  })

  it('returns false when the session scope does not resolve', () => {
    const get = vi.fn()
    const ctx = { sessions: { scope: () => undefined }, get } as unknown as Context
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns false when the conversation service is absent', () => {
    // A DSH build without ui-conversation must not break the popover.
    expect(insertQuoteIntoComposer(makeCtx({ conversation: undefined }), 's1', 'x')).toBe(false)
  })
})

describe('insertQuoteIntoComposer — throwing internals', () => {
  it('swallows a throw from input.for and logs once', () => {
    const ctx = makeCtx({ forImpl: () => { throw new Error('no binding') } })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('swallows a throw from getSnapshot', () => {
    const ctx = makeCtx({
      forImpl: () => ({
        state: { getSnapshot: () => { throw new Error('detached') } },
        setDraft: () => {},
      }),
    })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toBe(false)
  })

  it('swallows a throw from setDraft', () => {
    const ctx = makeCtx({
      forImpl: () => ({
        state: { getSnapshot: () => ({ draft: '' }) },
        setDraft: () => { throw new Error('editor disposed') },
      }),
    })
    expect(insertQuoteIntoComposer(ctx, 's1', 'x')).toBe(false)
  })
})

describe('insertQuoteIntoComposer — focus degradation', () => {
  it('still succeeds when the editor field is absent and there is no document', () => {
    // The upstream-drift fallback: `editor` is not on the frozen SessionInput
    // interface, so its disappearance must cost only the caret guarantee.
    expect(typeof document).toBe('undefined')
    const fake = makeInput({ withEditor: false })
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('> x\n\n')
  })

  it('still focuses the editor when getRootElement returns null', () => {
    const fake = makeInput()
    fake.input.editor!.rootElement = null
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok).toBe(true)
    expect(fake.editorFocus).toHaveBeenCalledTimes(1)
  })

  it('reports success even when focusing throws — the draft already landed', () => {
    const fake = makeInput()
    fake.input.editor!.focus = () => { throw new Error('detached root') }
    const ok = insertQuoteIntoComposer(makeCtx({ input: fake.input }), 's1', 'x')

    expect(ok).toBe(true)
    expect(fake.setDraft).toHaveBeenCalledWith('> x\n\n')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
