/**
 * Pure formatting for the popover's 「添加到对话」 action: render a captured
 * selection as a Markdown `>` blockquote and decide the whole next composer
 * draft. Zero DOM, zero ctx — `draft-insert.ts` is the only impure consumer.
 *
 * The composer's single public write path is `setDraft(wholeDraft)`, so the
 * decision this module makes is always "what is the NEXT COMPLETE draft",
 * never "what to splice in at the caret".
 */
import { boundText } from './injection.ts'

/** Bound for one inserted quote (mirror of selection.ts's MAX_SELECTION_CHARS). */
export const QUOTE_DRAFT_MAX_LEN = 2000

/**
 * Characters the composer strips on the way in (`REFERENCE_PLACEHOLDER_RE` in
 * ui-conversation's `src/client/input/facade.ts` — a reference chip is the only
 * legitimate source of U+FFFC). Stripped HERE too so {@link DraftInsertPlan}'s
 * `changed` flag stays honest: a `next` differing from the draft only by these
 * would be an invisible `setDraft` no-op.
 */
const COMPOSER_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu

/** CRLF/CR → LF, composer placeholders out, control chars out, length bounded. */
export function normalizeQuote(text: string): string {
  // \r must go BEFORE boundText: sanitizeText's control class deliberately
  // spares \t\n\r, so a CRLF selection would otherwise reach Lexical intact.
  return boundText(
    text.replace(/\r\n?/g, '\n').replace(COMPOSER_PLACEHOLDER_RE, ''),
    QUOTE_DRAFT_MAX_LEN,
  )
}

/**
 * Render text as ONE Markdown blockquote. Every line is prefixed; an interior
 * blank line becomes a bare `>` (a truly empty line would END the block and
 * split one quote into two); leading and trailing blank lines are dropped, and
 * per-line trailing whitespace with them. Blank input yields ''.
 */
export function blockquote(text: string): string {
  const lines = normalizeQuote(text).split('\n').map(line => line.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''
  return lines.map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
}

/** One planned composer write. */
export interface DraftInsertPlan {
  /** The whole next draft (identical to the input draft when nothing lands). */
  next: string
  /** Whether `next` differs from the draft; a false plan must not call setDraft. */
  changed: boolean
}

/**
 * Plan the next draft for one inserted quote.
 *
 * The block is APPENDED — the user's existing text reads as a lead-in and is
 * never destroyed (dsh-better-sidebar's `appendToDraft` sets the same
 * precedent) — separated by exactly one blank line however many newlines the
 * draft happened to end with. The result itself ends with a blank line so the
 * caret, which `setDraft` parks at the very end, lands on a fresh paragraph
 * BELOW the quote and OUTSIDE it: a line written directly under `> x` would be
 * a Markdown lazy continuation and stay inside the quote.
 *
 * Deliberately NOT idempotent: clicking twice appends two quotes.
 */
export function planQuoteInsert(draft: string, text: string): DraftInsertPlan {
  const block = blockquote(text)
  if (block === '') return { next: draft, changed: false }
  const head = draft.replace(/\s+$/, '')
  const next = head === '' ? `${block}\n\n` : `${head}\n\n${block}\n\n`
  return { next, changed: next !== draft }
}
