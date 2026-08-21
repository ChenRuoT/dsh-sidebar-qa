/**
 * Pure helpers for the host summarize service. Kept dependency-free so they
 * are unit-testable without a cordis runtime.
 *
 * Context-engineering strategy (asymmetric window):
 * - The surface is split into a RECENT window (near-verbatim, no model) and
 *   an EARLIER background (heavy compression by the fast model).
 * - The model only ever compresses the EARLIER part; the recent part carries
 *   the current state verbatim, so "对最新一条消息提问" keeps its anchor.
 */
import type { SidebarqaStreamChunk, SidebarqaSurfaceEvent } from './context-types.ts'

import { promptsOf, type PromptLocale } from './prompt-locale.ts'

/** Per-segment char cap for the verbatim recent window. */
export const RECENT_SEGMENT_MAX = 400

/** Per-segment char cap for the background window handed to the model. */
export const BACKGROUND_SEGMENT_MAX = 400

/** Per-segment char cap for the `trim` strategy's verbatim tail. */
export const TRIM_SEGMENT_MAX = 1000

/** One user/assistant text segment in model-history order. */
export interface SurfaceSegment {
  role: 'user' | 'assistant'
  text: string
}

/** Bound a string to `max` characters (Unicode-safe slice + ellipsis). */
function bound(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}…`
}

/** Join the text blocks of one content array, skipping reasoning/tool noise. */
function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string' && record.text !== '') {
      parts.push(record.text)
    }
  }
  return parts.join('\n')
}

/** Extract the semantic text of one surface event ('' when non-text). */
export function textOfEvent(event: SidebarqaSurfaceEvent): string {
  switch (event.type) {
    case 'user/message': {
      const data = event.data as { content?: unknown; source?: { kind?: unknown } }
      const kind = data.source?.kind
      // Skip every non-human user/message: runtime-context snapshots and agent
      // notices (kind 'plugin') and the skills catalog (kind 'skill-catalog').
      if (kind !== undefined && kind !== 'user') return ''
      return textOfBlocks(data.content)
    }
    case 'assistant/message': {
      const data = event.data as { message?: { content?: unknown } }
      return textOfBlocks(data.message?.content)
    }
    default:
      // tool/result and anything else is tool/derived noise — excluded.
      return ''
  }
}

/** The role of one surface event ('assistant' for anything non-user). */
function roleOfEvent(event: SidebarqaSurfaceEvent): 'user' | 'assistant' {
  return event.type === 'user/message' ? 'user' : 'assistant'
}

/**
 * Fold the surface into ordered user/assistant segments (newest-last).
 * @param events - current surface events in model-history order.
 */
export function extractSegments(events: readonly SidebarqaSurfaceEvent[]): SurfaceSegment[] {
  const segments: SurfaceSegment[] = []
  for (const event of events) {
    const text = textOfEvent(event)
    if (text !== '') segments.push({ role: roleOfEvent(event), text })
  }
  return segments
}

/** Split segments into the EARLIER background and the RECENT verbatim window. */
export function splitRecent(
  segments: readonly SurfaceSegment[],
  recentCount: number,
): { earlier: SurfaceSegment[]; recent: SurfaceSegment[] } {
  const count = Math.max(0, recentCount)
  const recent = segments.slice(Math.max(0, segments.length - count))
  const earlier = segments.slice(0, Math.max(0, segments.length - count))
  return { earlier, recent }
}

/**
 * Render segments as role-labeled, turn-separated text (the model input for
 * the background, or the verbatim recent window).
 */
export function formatSegments(
  segments: readonly SurfaceSegment[],
  maxPerSegment: number,
  locale: PromptLocale = 'zh',
): string {
  // These role prefixes are NAMED verbatim by `backgroundSystem` — the prompt
  // and the formatter are one atomic unit (see prompt-locale.ts).
  const prompts = promptsOf(locale)
  return segments
    .map(segment => `${segment.role === 'user' ? prompts.roleUser : prompts.roleAssistant}${bound(segment.text, maxPerSegment)}`)
    .join('\n\n')
}

/**
 * The `trim` strategy's injected context: the last `count` segments VERBATIM
 * (role-labeled, per-segment bounded) — deterministic, zero LLM cost. A count
 * of 0 or negative yields an empty string; a count ≥ the segment count keeps
 * the whole tail.
 */
export function buildTrimContext(
  segments: readonly SurfaceSegment[],
  count: number,
  maxPerSegment: number = TRIM_SEGMENT_MAX,
  locale: PromptLocale = 'zh',
): string {
  const take = Math.max(0, count)
  const tail = segments.slice(Math.max(0, segments.length - take))
  return formatSegments(tail, maxPerSegment, locale)
}

/**
 * Render the EARLIER background window for the model, NEWEST-FIRST. We want
 * the current progress (the tail of the earlier window — the messages just
 * before the verbatim recent band) to land at the model's strongest attention
 * position, instead of a flat chronological wall that ends with the opening
 * topic. The newest `count` of `earlier` are taken and reversed.
 */
export function formatBackground(
  earlier: readonly SurfaceSegment[],
  count: number,
  maxPerSegment: number,
  locale: PromptLocale = 'zh',
): string {
  const take = Math.max(0, count)
  const newest = earlier.slice(Math.max(0, earlier.length - take)).reverse()
  return formatSegments(newest, maxPerSegment, locale)
}

/**
 * Compose the final injected context: the model-compressed background plus the
 * verbatim recent window. Either part may be absent.
 */
export function composeSummary(
  background: string,
  recent: string,
  locale: PromptLocale = 'zh',
): string {
  const prompts = promptsOf(locale)
  const parts: string[] = []
  if (background.trim() !== '') parts.push(`${prompts.sectionBackground}\n${background}`)
  if (recent.trim() !== '') parts.push(`${prompts.sectionRecent}\n${recent}`)
  return parts.join('\n\n')
}

/** Result of assembling one stream: the accumulated text plus the terminal outcome. */
export interface AssembledText {
  text: string
  failed: boolean
}

/**
 * Accumulate the text deltas of one model stream until the terminal finish.
 * @param chunks - the `ctx.llm.stream` chunk iterable.
 * @returns the assembled text and whether the call errored or was aborted.
 */
export async function assembleText(chunks: AsyncIterable<SidebarqaStreamChunk>): Promise<AssembledText> {
  let text = ''
  let failed = false
  for await (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      const kind = chunk.reason.kind
      if (kind === 'error' || kind === 'aborted') failed = true
    }
  }
  return { text, failed }
}

/**
 * The system prompt for the background compression. It only ever sees the
 * EARLIER part; the recent state is handled verbatim elsewhere. The prompt
 * forces a done/current/pending split so an early instruction already carried
 * out (e.g. "生成计划" before the plan was actually produced) is never
 * reported as a pending task.
 *
 * The input is handed NEWEST-FIRST (see the background helper in index.ts), so
 * the current progress sits at the model's strongest attention position. The
 * prompt mirrors that ordering and tells the model to anchor on the newest
 * state first, not on the opening topic.
 */
export function backgroundSystem(locale: PromptLocale = 'zh'): string {
  return promptsOf(locale).backgroundSystem
}

/** The zh system prompt — the pre-i18n constant, kept for callers and tests
 *  that predate the locale parameter. */
export const BACKGROUND_SYSTEM = backgroundSystem('zh')
