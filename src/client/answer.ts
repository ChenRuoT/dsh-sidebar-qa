/**
 * Conversation-stream extraction from a side session's history feed. The panel
 * polls `ctx.connection.api.sessions.history` (the same tail-feed pattern
 * better-sidebar's SubagentView uses) and folds the raw events into an ordered
 * message transcript: user messages, settled assistant messages, plus the
 * in-flight chunk deltas of the running answer. Pure helpers here are
 * unit-testable without a runtime.
 */
import type { SidebarqaHistoryEntry, SidebarqaSessionEvent } from '../context-types.ts'

/** Extract the text blocks of an assistant/message event (reasoning excluded). */
export function textOfAssistantMessage(event: SidebarqaSessionEvent): string {
  if (event.type !== 'assistant/message') return ''
  const data = event.data as { message?: { content?: unknown } }
  const content = data.message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** Extract the text blocks of a user/message event. */
export function textOfUserMessage(event: SidebarqaSessionEvent): string {
  if (event.type !== 'user/message') return ''
  const data = event.data as { content?: unknown; source?: { kind?: unknown } }
  const kind = data.source?.kind
  // Only genuine human prompts are shown. DSH-injected context rides the surface
  // as user/message with source.kind 'plugin' (the "Current runtime context"
  // snapshot, agent notices) or 'skill-catalog' (the <system-reminder> skills
  // block) — skip every non-'user' kind. `undefined` (test fixtures) is kept.
  if (kind !== undefined && kind !== 'user') return ''
  const content = data.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** Whether one event is a text-delta chunk (in-flight answer token). */
function chunkText(event: SidebarqaSessionEvent): string {
  if (event.type !== 'assistant/chunk') return ''
  const data = event.data as { chunk?: { type?: unknown; text?: unknown } }
  if (data.chunk?.type === 'text-delta' && typeof data.chunk.text === 'string') return data.chunk.text
  return ''
}

/** One transcript message (user or assistant). */
export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
}

/** One transcript row plus the seq of its last event (anchoring + pagination). */
export interface TranscriptRow extends TranscriptMessage {
  seq: number
}

/**
 * Locate the LAST `session/end-seed` event in a history page. A fork child's
 * log is `[seed…, session/end-seed, live…]`; the end-seed marks where the
 * inherited parent history ends and the child's own messages begin. Nested
 * forks can carry several markers, so the LAST one is the child's own
 * boundary (mirror of the core session contract's rule for stored history).
 * @returns the index of the last marker, or -1 when the page has none.
 */
export function lastEndSeedIndex(events: readonly SidebarqaHistoryEntry[]): number {
  let index = -1
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.event.type === 'session/end-seed') index = i
  }
  return index
}

/** Whether the page contains a fork-seed boundary (i.e. inherited history). */
export function hasSeedHistory(events: readonly SidebarqaHistoryEntry[]): boolean {
  return lastEndSeedIndex(events) !== -1
}

/**
 * Fold one history page into an ordered message transcript. Chunks belonging
 * to the in-flight answer (seq past the last settled assistant message) are
 * appended as a trailing assistant message marked with `streaming`.
 */
export function transcriptOf(events: readonly SidebarqaHistoryEntry[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  let lastAssistantSeq = -1

  for (const entry of events) {
    const event = entry.event
    if (event.type === 'user/message') {
      const text = textOfUserMessage(event)
      if (text !== '') messages.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const text = textOfAssistantMessage(event)
      lastAssistantSeq = event.seq
      if (text !== '') messages.push({ role: 'assistant', text })
    }
  }

  // In-flight chunks (the running answer) append to a trailing assistant message.
  let inFlight = ''
  for (const entry of events) {
    const event = entry.event
    if (event.type === 'assistant/chunk' && event.seq > lastAssistantSeq) {
      inFlight += chunkText(event)
    }
  }
  if (inFlight !== '') messages.push({ role: 'assistant', text: inFlight })

  return messages
}

/**
 * Like {@link transcriptOf}, but each row also carries the seq of its last
 * event: settled messages use their event seq, the in-flight chunk aggregate
 * uses the last chunk's seq. The panel uses the seq to split inherited
 * (fork-seed) rows from the child's own rows and to anchor the initial view.
 */
export function transcriptRowsOf(events: readonly SidebarqaHistoryEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let lastAssistantSeq = -1

  for (const entry of events) {
    const event = entry.event
    if (event.type === 'user/message') {
      const text = textOfUserMessage(event)
      if (text !== '') rows.push({ role: 'user', text, seq: event.seq })
    } else if (event.type === 'assistant/message') {
      const text = textOfAssistantMessage(event)
      lastAssistantSeq = event.seq
      if (text !== '') rows.push({ role: 'assistant', text, seq: event.seq })
    }
  }

  let inFlight = ''
  let inFlightSeq = -1
  for (const entry of events) {
    const event = entry.event
    if (event.type === 'assistant/chunk' && event.seq > lastAssistantSeq) {
      inFlight += chunkText(event)
      inFlightSeq = event.seq
    }
  }
  if (inFlight !== '') rows.push({ role: 'assistant', text: inFlight, seq: inFlightSeq })

  return rows
}

/**
 * Fold one history page into the current answer text: every settled assistant
 * message (in order) plus the in-flight chunk deltas that follow the last
 * settled message. (Legacy single-string form; transcriptOf is preferred.)
 */
export function answerTextOf(events: readonly SidebarqaHistoryEntry[]): string {
  return transcriptOf(events)
    .filter(message => message.role === 'assistant')
    .map(message => message.text)
    .filter(text => text !== '')
    .join('\n\n')
}

/** Whether the history feed contains a finished answering turn. */
export function hasTurnEnded(events: readonly SidebarqaHistoryEntry[]): boolean {
  return events.some(entry => entry.event.type === 'turn/end')
}
