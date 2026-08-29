/**
 * The impure half of 「添加到对话」: reach the CURRENT session's main composer
 * through DSH's ui-conversation cordis service and append the quote there.
 *
 * Every decision about the TEXT lives in `quote-draft.ts` (pure, unit-tested);
 * this module is plumbing only. A missing service, an unresolvable session
 * scope, or ANY throw degrades to a logged `false` — the popover must survive
 * every deployment, including one without ui-conversation.
 */
import type { Context, SidebarqaSessionInput } from '../context-types.ts'
import { planQuoteInsert } from './quote-draft.ts'

/**
 * Append `text` to `sessionId`'s composer draft as a `>` blockquote, then focus
 * the box with the caret at the end. Never opens (or expands) the sidebar.
 * @param ctx - this plugin's own activation context.
 * @param sessionId - the session whose composer receives the quote.
 * @param text - the raw selected text (formatting happens in quote-draft.ts).
 * @returns false when the composer could not be reached, so the caller can keep
 *   the selection alive and leave 提问 one click away.
 */
export function insertQuoteIntoComposer(ctx: Context, sessionId: string, text: string): boolean {
  try {
    if (sessionId === '') return false
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return false
    // Inject-free runtime read (the one DSH's own plugins use): a value import
    // of @deepseek-ai/* would fail the client-bundle purity gate, and putting
    // `conversation` in `inject` would make ui-conversation a hard dependency
    // of the WHOLE plugin instead of just this one button.
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const plan = planQuoteInsert(input.state.getSnapshot().draft, text)
    // An identical write early-returns inside setDraft without moving the
    // caret, so skipping it here only removes noise.
    if (plan.changed) input.setDraft(plan.next)
    focusComposer(input)
    return true
  } catch (error) {
    console.warn('[dsh-sidebar-qa] composer insert failed:', error)
    return false
  }
}

/**
 * Take DOM focus — `setDraft` never does. Its own try/catch: a focus failure
 * must not report an already-landed draft write as a failure.
 */
function focusComposer(input: SidebarqaSessionInput): void {
  try {
    const editor = input.editor
    if (editor !== undefined) {
      // DSH's own order (ui-conversation's skeleton/InputBar.tsx): the raw DOM
      // focus first, then Lexical's focus(), which re-applies the editor
      // selection setDraft parked at the end. preventScroll keeps the
      // conversation scrollport still.
      editor.getRootElement()?.focus({ preventScroll: true })
      editor.focus()
      return
    }
    if (typeof document === 'undefined') return
    // Fallback for an upstream that drops the shell's `editor` field: the
    // composer's stable DOM hook. Taking the LAST match mirrors how DSH's own
    // e2e suite disambiguates the session composer from the hero mount.
    const nodes = document.querySelectorAll<HTMLElement>('[data-composer-input][contenteditable="true"]')
    nodes[nodes.length - 1]?.focus({ preventScroll: true })
  } catch (error) {
    console.warn('[dsh-sidebar-qa] composer focus failed:', error)
  }
}
