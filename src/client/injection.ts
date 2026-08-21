/**
 * Context-injection formatting for the side session's first message: the
 * context block, the `<quoted_context>` XML block (own parser contract,
 * XML-escaped and sanitized), and the question. Kept pure and dependency-free
 * (its one import, `prompt-locale.ts`, is itself dependency-free) for unit
 * testing.
 *
 * The model-facing wording lives in `../prompt-locale.ts`; every builder takes
 * the locale as a trailing parameter defaulting to `'zh'`, so a caller that
 * predates i18n produces byte-identical output.
 */
import { promptsOf, QUESTION_LABELS, type PromptLocale } from '../prompt-locale.ts'
import type { PendingQuote } from './store.ts'

/** Maximum quoted-text length admitted into the XML block. */
export const QUOTE_MAX_LEN = 2000

/** Maximum topic length for CJK text (the subject of the `❓<主题>` title). */
export const TOPIC_MAX_LEN = 12

/**
 * Maximum topic length for non-CJK text. A Latin script carries far less
 * information per character, so the CJK budget would cut mid-phrase.
 */
export const TOPIC_MAX_LEN_LATIN = 24

/** Escape the five XML special characters in a text node or attribute. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Reverse of {@link escapeXml} (display the quoted body back unescaped). */
export function unescapeXml(input: string): string {
  return input
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Strip control characters and NUL that would corrupt the XML/text block. */
export function sanitizeText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** Bound a string to `max` characters with an ellipsis (Unicode-safe slice). */
export function boundText(input: string, max: number): string {
  const text = sanitizeText(input)
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/** One quoted_context attribute line (escaped value or omitted). */
function attr(name: string, value: string | undefined): string {
  return value === undefined || value === '' ? '' : ` ${name}="${escapeXml(value)}"`
}

/**
 * Build the `<quoted_context>` XML block for one captured selection.
 * Selection offsets are only meaningful when the message id is known; they are
 * omitted otherwise.
 */
export function buildQuotedContext(quote: PendingQuote, label: string): string {
  const body = escapeXml(boundText(quote.text, QUOTE_MAX_LEN))
  const messageId = quote.messageId ?? ''
  const role = quote.role ?? 'assistant'
  const turn = quote.turn ?? ''
  const hasOffsets = quote.selectionStart !== undefined
    && quote.selectionEnd !== undefined
    && quote.messageId !== undefined
  const start = hasOffsets ? String(quote.selectionStart) : undefined
  const end = hasOffsets ? String(quote.selectionEnd) : undefined
  const attrs = [
    attr('source', 'agent-history'),
    attr('label', label),
    attr('message_id', messageId),
    attr('role', role),
    attr('turn', turn),
    attr('selection_start', start),
    attr('selection_end', end),
  ].join('')
  return `<quoted_context${attrs}>\n${body}\n</quoted_context>`
}

/**
 * The governing instruction prepended to the side session's first message.
 * It sits at the very start of the input so the model reads it under the
 * highest attention weight, before the (heavier) context blocks: it sets the
 * frame that this is a sidebar follow-up anchored on a SELECTED snippet, that
 * the answer must stay on the snippet's topic instead of over-indexing on the
 * main conversation's theme, and that the ANSWER LANGUAGE follows the user's
 * question (not the UI language).
 * @param locale - which language the instruction itself is written in.
 */
export function followUpIntro(locale: PromptLocale = 'zh'): string {
  return promptsOf(locale).followUpIntro
}

/** The zh intro — the pre-i18n constant, kept for callers and tests that
 *  predate the locale parameter. */
export const FOLLOWUP_INTRO = followUpIntro('zh')

/**
 * Build the side session's first user message: the governing intro, optional
 * summary block, quoted context block, then the question. Later follow-up
 * messages pass `summary` as null (only the first message carries the
 * compressed main context).
 */
export function buildFirstMessage(
  summary: string | null,
  quote: PendingQuote,
  question: string,
  label: string,
  locale: PromptLocale = 'zh',
): string {
  const prompts = promptsOf(locale)
  const parts: string[] = [prompts.followUpIntro]
  if (summary !== null && summary !== '') {
    parts.push(`${prompts.contextHeading}\n${boundText(summary, 12000)}`)
  }
  parts.push(buildQuotedContext(quote, label))
  parts.push(`${prompts.questionLabel}${sanitizeText(question)}`)
  return parts.join('\n\n')
}

/** Build a follow-up message inside an existing side session (no summary). */
export function buildFollowUpMessage(
  quote: PendingQuote | null,
  question: string,
  label: string,
  locale: PromptLocale = 'zh',
): string {
  const parts: string[] = []
  if (quote !== null && quote.text !== '') parts.push(buildQuotedContext(quote, label))
  parts.push(`${promptsOf(locale).questionLabel}${sanitizeText(question)}`)
  return parts.join('\n\n')
}

/**
 * Derive the `❓<主题>` subject: the first non-blank line of the quote,
 * whitespace-collapsed, bounded to a script-aware budget; falls back to
 * `fallback` (the caller passes the locale's placeholder topic).
 */
export function topicFromQuote(text: string, fallback = '追问'): string {
  const firstLine = sanitizeText(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line !== '')
  if (firstLine === undefined || firstLine === '') return fallback
  // The budget follows the TEXT's script, not the UI language: a zh user
  // quoting English needs the wide budget just as much as an en user does.
  const budget = /[\u3040-\u30ff\u4e00-\u9fff]/.test(firstLine) ? TOPIC_MAX_LEN : TOPIC_MAX_LEN_LATIN
  return boundText(firstLine, budget)
}

/**
 * Build the full side-session title from a subject. The emoji alone marks a
 * follow-up session, so the title carries no translatable word (and no locale
 * switch can ever leave a session list with mixed-language prefixes).
 */
export function followUpTitle(subject: string): string {
  return `❓${subject}`
}

/** Parsed display form of one user message in the transcript. */
export interface ParsedUserMessage {
  /** The quoted_context body (unescaped), or null when the message has none. */
  quote: string | null
  /** The question text (summary + labels stripped). */
  question: string
}

/**
 * Strip a leading question label, else return the trimmed text as-is.
 *
 * Tries EVERY marker the plugin has ever emitted ({@link QUESTION_LABELS}):
 * these messages live in the DSH session log forever, so a message written
 * under zh must still parse after the user switches to en.
 */
function stripQuestionLabel(text: string): string {
  const trimmed = text.trim()
  for (const label of QUESTION_LABELS) {
    if (trimmed.startsWith(label)) return trimmed.slice(label.length).trim()
  }
  return trimmed
}

/**
 * Parse a user message into its display parts. The governing intro and the
 * context summary blocks are stripped (they were consumed as model context,
 * not shown to the reader) — structurally, by slicing past the quote block, so
 * no localized heading is ever matched; the `<quoted_context>` body is
 * unescaped for display; the question is whatever follows the quote (first
 * message) or the whole message (plain follow-up).
 */
export function parseUserMessage(text: string): ParsedUserMessage {
  // Require whitespace after `<quoted_context` so the bare prose mention in
  // the intro ("见 <quoted_context> 块") never matches — only the real
  // block, which always carries ` source="agent-history" ...` attributes.
  const match = /<quoted_context\s[^>]*>([\s\S]*?)<\/quoted_context>/.exec(text)
  const quote = match === null ? null : unescapeXml(match[1]!.trim())
  const question = match === null
    ? stripQuestionLabel(text)
    : stripQuestionLabel(text.slice((match.index ?? 0) + match[0].length))
  return { quote, question }
}
