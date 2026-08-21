/**
 * Pure helpers for the post-answer retitle flow: the strict "title-only"
 * system prompt, the Q+A input framing with a truncation budget, and
 * UTF-8-safe title normalization. The normalization rules mirror DSH's
 * session-title package (control-sequence stripping + UTF-8 byte truncation
 * that never splits a code point), copied here so a third-party plugin
 * resolves outside the DSH monorepo without a runtime value import. Kept
 * dependency-free (TextEncoder only) for unit testing and shared by both the
 * host title route and the client input builder.
 *
 * The prompt text itself lives in `prompt-locale.ts`; the locale enters as a
 * trailing parameter defaulting to `'zh'`, so pre-i18n callers are unaffected.
 */
import { promptsOf, type PromptLocale } from './prompt-locale.ts'

/**
 * System prompt: emit ONLY the title, plain single line, with a dual budget
 * (≤15 CJK chars / ≤6 words). It tells the model to use the language of the
 * question and answer — the title follows the CONTENT, not the UI language.
 * @param locale - which language the instruction itself is written in.
 */
export function titleSystem(locale: PromptLocale = 'zh'): string {
  return promptsOf(locale).titleSystem
}

/** The zh system prompt — the pre-i18n constant, kept for callers and tests
 *  that predate the locale parameter. */
export const TITLE_SYSTEM = titleSystem('zh')

/** Max chars of the question part admitted into the title input. */
export const TITLE_QUESTION_MAX = 400

/** Max chars of the answer part admitted into the title input. */
export const TITLE_ANSWER_MAX = 1200

/** Defensive cap on the whole input the host hands to the model. */
export const TITLE_INPUT_MAX = 4000

/** Max UTF-8 bytes of an accepted title. Script-adaptive by construction:
 *  60 bytes ≈ 20 CJK chars ≈ 60 Latin chars ≈ 10 English words. */
export const TITLE_MAX_BYTES = 60

/** Operating-system-command escape sequences, including unterminated tails. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/** UTF-8 byte length of a string (TextEncoder is global in Node and browsers). */
function utf8Length(input: string): number {
  return new TextEncoder().encode(input).length
}

/** Bound a string to `max` characters with an ellipsis (Unicode-safe slice). */
function bound(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}…`
}

/**
 * Truncate a string to a UTF-8 byte budget without splitting a Unicode code
 * point.
 */
export function truncateTitleUtf8(input: string, maxBytes: number): string {
  if (utf8Length(input) <= maxBytes) return input
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = utf8Length(character)
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * Normalize one model-produced title: strip terminal/control/invisible
 * sequences, collapse whitespace to a single trimmed line, and enforce the
 * UTF-8 byte budget.
 */
export function normalizeTitle(input: string, maxBytes: number): string {
  const cleaned = input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return truncateTitleUtf8(cleaned, maxBytes).trimEnd()
}

/**
 * Build the labeled `question / answer` input for the title model, each part
 * bounded. The labels are the ones `titleSystem` refers to, so both come from
 * the same bundle.
 */
export function buildTitleInput(
  question: string,
  answer: string,
  locale: PromptLocale = 'zh',
): string {
  const prompts = promptsOf(locale)
  const parts: string[] = []
  if (question.trim() !== '') parts.push(`${prompts.titleQuestionLabel}${bound(question, TITLE_QUESTION_MAX)}`)
  if (answer.trim() !== '') parts.push(`${prompts.titleAnswerLabel}${bound(answer, TITLE_ANSWER_MAX)}`)
  return parts.join('\n')
}

/** Defensive whole-input cap for the host route (idempotent with the framing). */
export function boundTitleInput(input: string): string {
  return bound(input, TITLE_INPUT_MAX)
}
