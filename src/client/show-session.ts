/**
 * Put a session on screen, through DSH's own workspace service.
 *
 * Three call sites need this — the sidebar opener (an `openTab` only reaches the
 * session surface that is MOUNTED), 「添加到对话」 (a composer scope is only
 * resolvable once its session is retained), and the 追问记录 tree's 跳转 (which
 * goes through the sidebar opener) — and none of them can do it through the
 * sessions service.
 *
 * That service has no navigation entry. An earlier revision read
 * `ctx.sessions.open(id)` here, a member `ISessions`
 * (`api/session-controller/src/client/contract/sessions.ts:32-161`) does not have:
 * one call site threw `TypeError`, and the two guarded ones silently did nothing,
 * so every cross-session gesture was broken with no error to show for it.
 *
 * `ctx.uiWorkspace.openSession` is the real thing, and it is a NAVIGATION, not an
 * instant: `replaceMain` retains and selects the session synchronously, but the
 * React surface that then shows it — and with it the composer and the sidebar's
 * session binding — arrives on a later commit. Callers that need those must defer,
 * which is why this returns whether it actually navigated.
 *
 * Pure enough for the `node` test environment: it touches only the cordis context
 * and a plain function, no DOM.
 */
import type { Context } from '../context-types.ts'
import { resolveCurrentSessionId } from './current-session.ts'

/**
 * Make `sessionId` the session on screen, when it is not already.
 * @param ctx - the client plugin context.
 * @param sessionId - the session a gesture belongs to ('' means "unknown").
 * @returns whether a navigation was issued (i.e. whether the surface will change).
 */
export function showSessionFirst(ctx: Context, sessionId: string): boolean {
  if (sessionId === '') return false

  const sessions: Context['sessions'] | undefined = ctx.sessions
  if (sessions === undefined) return false
  if (resolveCurrentSessionId(sessions.list.getSnapshot()) === sessionId) return false

  const uiWorkspace = ctx.get('uiWorkspace')
  if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') {
    // Not fatal: every caller has a degradation that leaves the current session
    // alone. Said out loud because the silent version of this is what made the
    // original bug invisible.
    console.warn(
      '[dsh-sidebar-qa] this DSH has no uiWorkspace navigation service; '
      + 'the target session stays off screen.',
    )
    return false
  }

  uiWorkspace.openSession(sessionId)
  return true
}
