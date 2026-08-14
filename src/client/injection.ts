/**
 * Context-injection formatting for the side session's first message: the
 * `【主对话上下文摘要】` block, the `<quoted_context>` XML block (own parser
 * contract, XML-escaped and sanitized), and the question. Kept pure and
 * dependency-free for unit testing.
 */
import type { PendingQuote } from './store.ts'

/** Maximum quoted-text length admitted into the XML block. */
export const QUOTE_MAX_LEN = 2000

/** Maximum topic length (subject of the `❓追问·<主题>` title). */
export const TOPIC_MAX_LEN = 12

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
 * frame that this is a sidebar follow-up anchored on a SELECTED snippet, and
 * that the answer must stay on the snippet's topic instead of over-indexing
 * on the main conversation's theme.
 */
export const FOLLOWUP_INTRO = [
  '这是一次「侧边栏追问」：用户对主对话里划选的一段文本提问。',
  '请识别用户意图，只围绕这段划选文本的主题直接、简明地回答（必要时先做概念澄清），不要复述上下文、也不要过度联系主对话的整体主题。',
  '输出要求：第一句就进入回答正文，禁止任何开场白、自我陈述或任务复述（如"我来回答…""这个问题是关于…""直接介绍即可"之类的话一律不写）。',
  '下面依次是参考上下文：',
  '1. 主对话整体主题',
  '2. 主对话最近几轮对话',
  '3. 用户划选的文本（见 <quoted_context> 块）',
  '4. 用户的问题',
].join('\n')

/**
 * Build the side session's first user message: the governing intro, optional
 * summary block, quoted context block, then the question. Later follow-up
 * messages pass `summary` as null (only the first message carries the
 * compressed main context).
 */
export function buildFirstMessage(summary: string | null, quote: PendingQuote, question: string, label: string): string {
  const parts: string[] = [FOLLOWUP_INTRO]
  if (summary !== null && summary !== '') {
    parts.push(`【主对话上下文】\n${boundText(summary, 12000)}`)
  }
  parts.push(buildQuotedContext(quote, label))
  parts.push(`问题：${sanitizeText(question)}`)
  return parts.join('\n\n')
}

/** Build a follow-up message inside an existing side session (no summary). */
export function buildFollowUpMessage(quote: PendingQuote | null, question: string, label: string): string {
  const parts: string[] = []
  if (quote !== null && quote.text !== '') parts.push(buildQuotedContext(quote, label))
  parts.push(`问题：${sanitizeText(question)}`)
  return parts.join('\n\n')
}

/**
 * Derive the `❓追问·<主题>` subject: the first non-blank line of the quote,
 * whitespace-collapsed, bounded to TOPIC_MAX_LEN; falls back to '追问'.
 */
export function topicFromQuote(text: string): string {
  const firstLine = sanitizeText(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line !== '')
  if (firstLine === undefined || firstLine === '') return '追问'
  return boundText(firstLine, TOPIC_MAX_LEN)
}

/** Build the full side-session title from a subject. */
export function followUpTitle(subject: string): string {
  return `❓追问·${subject}`
}

/** Parsed display form of one user message in the transcript. */
export interface ParsedUserMessage {
  /** The quoted_context body (unescaped), or null when the message has none. */
  quote: string | null
  /** The question text (summary + labels stripped). */
  question: string
}

/** Strip a leading `问题：` label, else return the trimmed text as-is. */
function stripQuestionLabel(text: string): string {
  const trimmed = text.trim()
  return trimmed.startsWith('问题：') ? trimmed.slice('问题：'.length).trim() : trimmed
}

/**
 * Parse a user message into its display parts. The governing intro and the
 * `【主对话上下文】` summary blocks are stripped (they were consumed as model
 * context, not shown to the reader); the `<quoted_context>` body is unescaped
 * for display; the question is whatever follows the quote (first message) or
 * the whole message (plain follow-up).
 */
export function parseUserMessage(text: string): ParsedUserMessage {
  // Require whitespace after `<quoted_context` so the bare prose mention in
  // FOLLOWUP_INTRO ("见 <quoted_context> 块") never matches — only the real
  // block, which always carries ` source="agent-history" ...` attributes.
  const match = /<quoted_context\s[^>]*>([\s\S]*?)<\/quoted_context>/.exec(text)
  const quote = match === null ? null : unescapeXml(match[1]!.trim())
  const question = match === null
    ? stripQuestionLabel(text)
    : stripQuestionLabel(text.slice((match.index ?? 0) + match[0].length))
  return { quote, question }
}
