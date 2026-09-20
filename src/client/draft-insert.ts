/**
 * The impure half of 「添加到对话」: reach the CURRENT session's main composer
 * through DSH's ui-conversation cordis service and append the quote there.
 *
 * Every decision about the TEXT lives in `quote-draft.ts` (pure, unit-tested);
 * this module is plumbing only. A missing service, an unresolvable session
 * scope, or ANY throw degrades to a logged report — the popover must survive
 * every deployment, including one without ui-conversation.
 *
 * ## Two moving parts, both asynchronous
 *
 * 1. **The session identity.** The selection records whatever the session feed
 *    reported as current at DRAG time, and that feed fills in from the Host — a
 *    selection made in the first moments after load can carry an empty id. The id
 *    therefore has to be re-resolved at write time rather than trusted.
 * 2. **The Agent scope.** `ctx.sessions.scope(id)` BORROWS an already-retained
 *    scoped context and returns undefined for a session that is not currently
 *    mounted (`session-controller/src/client/sessions/service.ts:502` —
 *    `this.scopes.get(id)`), and the composer facade is resolved from that
 *    context. `showSessionFirst` (see `show-session.ts`) retains that scope
 *    SYNCHRONOUSLY (`retain` → `retainScope` → `this.scopes.set`), so a successful
 *    navigation does not itself need a wait.
 *
 * The remaining reason to defer is narrower: the id may be empty while the session
 * feed has not filled in yet, and `uiWorkspace.openSession` throws `unknown session`
 * for an id the controller cannot resolve — a session that is not in the Host list
 * yet, in the first moments after load. Both can be cured by the next frame, so the
 * write is retried over a few. That includes the empty id, which an earlier revision
 * treated as unrecoverable and thus skipped the retry that would have fixed it.
 */
import type { Context, SidebarqaSessionInput } from '../context-types.ts'
import { resolveCurrentSessionId } from './current-session.ts'
import { planQuoteInsert } from './quote-draft.ts'
import { showSessionFirst } from './show-session.ts'

/** Why an insert could not happen, for the caller's diagnostics. */
export type ComposerInsertFailure =
  | 'missing-session'
  | 'no-conversation-service'
  | 'scope-unavailable'
  | 'threw'

/** How many frames a deferred composer write may wait for its session to mount. */
const RETRY_FRAMES = 3

/** What one insert attempt did. */
export interface ComposerInsertResult {
  /** Whether the draft was written (or already held the quote). */
  readonly ok: boolean
  /** Present when `ok` is false. */
  readonly failure?: ComposerInsertFailure
  /** The underlying error, when `failure` is 'threw'. */
  readonly error?: unknown
}

/**
 * Append `text` to `sessionId`'s composer draft as a `>` blockquote, then focus
 * the box with the caret at the end. Never opens (or expands) the sidebar.
 * @param ctx - this plugin's own activation context.
 * @param sessionId - the session whose composer receives the quote; an empty id
 *   is re-resolved from the live session feed.
 * @param text - the raw selected text (formatting happens in quote-draft.ts).
 * @returns the attempt's outcome; `ok: false` keeps the selection alive and
 *   leaves 提问 one click away.
 */
export function insertQuoteIntoComposer(ctx: Context, sessionId: string, text: string): ComposerInsertResult {
  // Resolve the target first: the selection's id may be empty (captured before
  // the session feed filled in), and an empty id must NOT short-circuit — the
  // current session is still a valid target.
  const target = resolveSessionId(ctx, sessionId)
  if (target === '') return { ok: false, failure: 'missing-session' }
  showSessionFirst(ctx, target)
  return attemptInsert(ctx, target, text)
}

/**
 * Retry the write over a few frames.
 *
 * The failure modes this can fix are both about the session FEED rather than the
 * scope: an empty recorded id, and a target the controller cannot resolve yet. A
 * bounded loop covers them without turning a click into a polling loop.
 * @param ctx - the plugin's activation context.
 * @param sessionId - the session whose composer receives the quote (may be empty).
 * @param text - the raw selected text.
 */
export function insertQuoteIntoComposerDeferred(ctx: Context, sessionId: string, text: string): void {
  const attempt = (framesLeft: number): void => {
    const result = insertQuoteIntoComposer(ctx, sessionId, text)
    if (result.ok) return
    const retryable = result.failure === 'missing-session' || result.failure === 'scope-unavailable'
    if (retryable && framesLeft > 0 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { attempt(framesLeft - 1) })
      return
    }
    // Reported only when it is the LAST attempt, so a normal cross-session insert
    // does not log a spurious failure on its way in.
    report(result, sessionId, framesLeft === RETRY_FRAMES ? 'first attempt' : 'retry')
  }
  attempt(RETRY_FRAMES)
}

/**
 * The session to write into: the selection's own id when it has one, else
 * whatever the live session feed now reports as current.
 *
 * Best-effort by design — a deployment without the client sessions service
 * keeps whatever the selection carried.
 * @param ctx - the plugin's activation context.
 * @param sessionId - the id the selection recorded.
 * @returns the id to target, or '' when neither source has one.
 */
function resolveSessionId(ctx: Context, sessionId: string): string {
  if (sessionId !== '') return sessionId
  const sessions = ctx.sessions
  if (sessions === undefined) return ''
  try {
    return resolveCurrentSessionId(sessions.list.getSnapshot()) ?? ''
  } catch (error) {
    console.warn('[dsh-sidebar-qa] reading the current session failed:', error)
    return ''
  }
}

/**
 * One write attempt against the session's composer facade.
 * @param ctx - the plugin's activation context.
 * @param sessionId - the session whose composer receives the quote.
 * @param text - the raw selected text.
 * @returns the attempt's outcome.
 */
function attemptInsert(ctx: Context, sessionId: string, text: string): ComposerInsertResult {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return { ok: false, failure: 'scope-unavailable' }
    // Inject-free runtime read (the one DSH's own plugins use): a value import
    // of @deepseek-ai/* would fail the client-bundle purity gate, and putting
    // `conversation` in `inject` would make ui-conversation a hard dependency
    // of the WHOLE plugin instead of just this one button.
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return { ok: false, failure: 'no-conversation-service' }
    const input = conversation.input.for(actx)
    const plan = planQuoteInsert(input.state.getSnapshot().draft, text)
    // An identical write early-returns inside setDraft without moving the
    // caret, so skipping it here only removes noise.
    if (plan.changed) input.setDraft(plan.next)
    focusComposer(input)
    return { ok: true }
  } catch (error) {
    console.warn('[dsh-sidebar-qa] composer insert failed:', error)
    return { ok: false, failure: 'threw', error }
  }
}

/**
 * Say why the button did nothing.
 *
 * The popover deliberately keeps the selection and itself alive on failure, so
 * from the user's side a refused write and a broken one look identical — the
 * console line is the only thing that tells them apart.
 * @param result - the failed outcome.
 * @param sessionId - the session the write targeted (as the selection recorded it).
 * @param phase - which attempt failed.
 */
function report(result: ComposerInsertResult, sessionId: string, phase: string): void {
  console.warn(
    `[dsh-sidebar-qa] 「添加到对话」 could not reach the composer (${phase}): ${String(result.failure)} `
    + `(selectionSession=${sessionId === '' ? '<empty>' : sessionId})`,
    ...result.error === undefined ? [] : [result.error],
  )
}

/**
 * Take composer focus — `setDraft` never does. Its own try/catch: a focus failure
 * must not report an already-landed draft write as a failure.
 *
 * Prefers the public `input.focus()`, which upstream implements as exactly the two
 * calls this used to hand-roll (`ui-conversation/src/client/input/facade.ts:460`).
 * The `editor` path and then the DOM hook remain for an upstream that lacks it.
 */
function focusComposer(input: SidebarqaSessionInput): void {
  try {
    if (typeof input.focus === 'function') {
      input.focus()
      return
    }
    const editor = input.editor
    if (editor !== undefined) {
      // Lexical's focus() re-applies the editor selection setDraft parked at the
      // end; preventScroll keeps the conversation scrollport still.
      editor.getRootElement()?.focus({ preventScroll: true })
      editor.focus()
      return
    }
    if (typeof document === 'undefined') return
    // Last resort: the composer's stable DOM hook. Taking the LAST match mirrors
    // how DSH's own e2e suite disambiguates the session composer from the hero
    // mount.
    const nodes = document.querySelectorAll<HTMLElement>('[data-composer-input][contenteditable="true"]')
    nodes[nodes.length - 1]?.focus({ preventScroll: true })
  } catch (error) {
    console.warn('[dsh-sidebar-qa] composer focus failed:', error)
  }
}
