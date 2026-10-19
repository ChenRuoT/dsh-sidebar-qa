/**
 * Conversation-stream extraction from a side session's history feed. The panel
 * follows `ctx.remote.session` (see `session-wire.ts`) and folds the raw events
 * into an ordered message transcript: user messages, settled assistant messages,
 * failed/aborted attempts, plus the in-flight stream of the running answer.
 * Pure helpers here are unit-testable without a runtime.
 *
 * Since DSH 0.2.x the agent loop no longer writes durable `assistant/chunk`
 * events: a successful attempt commits `assistant/message`, a failed/aborted one
 * commits `assistant/attempt` (whose `stream` holds the compact record list),
 * and the live deltas are process-local presentation frames delivered only when
 * the follow opts in with `assistantStream: true`. The transcript therefore
 * folds BOTH generations: the old chunk events (still present in older session
 * logs) and the new attempt events / live frames.
 */
import type {
  SidebarqaAssistantStreamBaseline,
  SidebarqaAssistantStreamFrame,
  SidebarqaHistoryEntry,
  SidebarqaSessionEvent,
} from '../context-types.ts'

/** Extract the text blocks of an assistant/message event (reasoning excluded). */
export function textOfAssistantMessage(event: SidebarqaSessionEvent): string {
  if (event.type !== 'assistant/message') return ''
  const data = event.data as { message?: { content?: unknown } }
  return textOfContent(data.message?.content)
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
  return textOfContent(data.content)
}

/** Text blocks of one content array (shared by user/assistant messages). */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** Answer text carried by one live `StreamChunk` (only text deltas count). */
export function textOfStreamChunk(chunk: unknown): string {
  if (chunk === null || typeof chunk !== 'object') return ''
  const record = chunk as { type?: unknown; text?: unknown }
  return record.type === 'text-delta' && typeof record.text === 'string' ? record.text : ''
}

/**
 * The human-readable failure carried by a terminal `finish` stream chunk, or
 * undefined when the attempt finished normally. Upstream's `FinishReason` is
 * `error` / `aborted` with an `LlmFailure { message, code? }`.
 */
export function failureOfStreamChunk(chunk: unknown): string | undefined {
  if (chunk === null || typeof chunk !== 'object') return undefined
  const record = chunk as { type?: unknown; reason?: unknown }
  if (record.type !== 'finish' || record.reason === null || typeof record.reason !== 'object') return undefined
  const reason = record.reason as { kind?: unknown; failure?: unknown }
  if (reason.kind !== 'error' && reason.kind !== 'aborted') return undefined
  const failure = reason.failure
  if (failure !== null && typeof failure === 'object') {
    const facts = failure as { message?: unknown; code?: unknown }
    if (typeof facts.message === 'string' && facts.message !== '') return facts.message
    if (typeof facts.code === 'string' && facts.code !== '') return facts.code
  }
  return reason.kind === 'aborted' ? 'aborted' : 'error'
}

/** One folded stream: its visible text and, for a failed attempt, the reason. */
export interface FoldedStream {
  text: string
  failure?: string
}

/**
 * Fold one compact assistant stream (`AssistantStreamRecord[]`) into visible
 * text + an optional failure. Records are the durable `assistant/attempt.stream`
 * shape: packed `text-chunks` runs, plus raw `chunk` records whose `finish`
 * carries the failure. Reasoning and tool-call records are deliberately ignored
 * here (the panel renders answer text; the whole turn is visible in the main
 * conversation).
 */
export function foldAssistantStreamRecords(records: unknown): FoldedStream {
  if (!Array.isArray(records)) return { text: '' }
  let text = ''
  let failure: string | undefined
  for (const record of records) {
    if (record === null || typeof record !== 'object') continue
    const item = record as { type?: unknown; texts?: unknown; chunk?: unknown }
    if (item.type === 'text-chunks' && Array.isArray(item.texts)) {
      text += item.texts.filter((part): part is string => typeof part === 'string').join('')
    } else if (item.type === 'chunk') {
      text += textOfStreamChunk(item.chunk)
      failure ??= failureOfStreamChunk(item.chunk)
    }
  }
  return failure === undefined ? { text } : { text, failure }
}

/**
 * Fold one durable `assistant/attempt` event into visible text + failure.
 * @param event - a session event (returns empty for any other type).
 */
export function assistantAttemptOf(event: SidebarqaSessionEvent): FoldedStream {
  if (event.type !== 'assistant/attempt') return { text: '' }
  const data = event.data as { stream?: unknown }
  return foldAssistantStreamRecords(data.stream)
}

/** One transcript message (user or assistant). */
export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  /** Why the attempt failed; absent on a normal message. */
  failure?: string
}

/** One transcript row plus the seq of its last event (anchoring + pagination). */
export interface TranscriptRow extends TranscriptMessage {
  seq: number
  /** True for the live (not yet durable) streaming row. */
  live?: boolean
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
 * Fold one history page into an ordered message transcript. A failed/aborted
 * attempt becomes an assistant row carrying `failure`; old in-flight chunk
 * events past the last settled row append as a trailing assistant message.
 */
export function transcriptOf(events: readonly SidebarqaHistoryEntry[]): TranscriptMessage[] {
  const rows = transcriptRowsOf(events)
  return rows.map(({ role, text, failure }) => failure === undefined
    ? { role, text }
    : { role, text, failure })
}

/**
 * Like {@link transcriptOf}, but each row also carries the seq of its last
 * event: settled messages use their event seq, the legacy in-flight chunk
 * aggregate uses the last chunk's seq. The panel uses the seq to split inherited
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
    } else if (event.type === 'assistant/attempt') {
      const { text, failure } = assistantAttemptOf(event)
      lastAssistantSeq = event.seq
      if (text !== '' || failure !== undefined) {
        rows.push(failure === undefined
          ? { role: 'assistant', text, seq: event.seq }
          : { role: 'assistant', text, seq: event.seq, failure })
      }
    }
  }

  // Legacy in-flight chunks (pre-0.2 durable logs) append to a trailing row.
  let inFlight = ''
  let inFlightSeq = -1
  for (const entry of events) {
    const event = entry.event
    if (event.type === 'assistant/chunk' && event.seq > lastAssistantSeq) {
      inFlight += textOfStreamChunk((event.data as { chunk?: unknown }).chunk)
      inFlightSeq = event.seq
    }
  }
  if (inFlight !== '') rows.push({ role: 'assistant', text: inFlight, seq: inFlightSeq })

  return rows
}

/**
 * Fold the live stream baseline a reconnect opening snapshot carries into the
 * in-flight row's initial text (empty when no attempt is running).
 * @param baseline - the snapshot's `assistantStream` (absent on older hosts).
 * @returns the live row state, or null when there is no active attempt.
 */
export function liveStreamOf(
  baseline: SidebarqaAssistantStreamBaseline | undefined,
): { startedAfterSeq: number; text: string; failure?: string } | null {
  const attempt = baseline?.activeAttempt
  if (attempt === undefined) return null
  const folded = foldAssistantStreamRecords(attempt.stream)
  return folded.failure === undefined
    ? { startedAfterSeq: attempt.startedAfterSeq, text: folded.text }
    : { startedAfterSeq: attempt.startedAfterSeq, text: folded.text, failure: folded.failure }
}

/**
 * Apply one live assistant frame to the in-flight row state.
 * @param state - the current row state (null before `start`).
 * @param frame - one `assistant-stream` frame.
 * @returns the next state (null after a terminal/abandoned frame).
 */
export function applyAssistantStreamFrame(
  state: { startedAfterSeq: number; text: string; failure?: string } | null,
  frame: SidebarqaAssistantStreamFrame,
): { startedAfterSeq: number; text: string; failure?: string } | null {
  if (frame.type === 'start') {
    return { startedAfterSeq: frame.startedAfterSeq, text: '' }
  }
  if (frame.type === 'chunk') {
    if (state === null) return null
    const text = state.text + textOfStreamChunk(frame.chunk)
    const failure = state.failure ?? failureOfStreamChunk(frame.chunk)
    return failure === undefined ? { startedAfterSeq: state.startedAfterSeq, text } : { startedAfterSeq: state.startedAfterSeq, text, failure }
  }
  // `end`: a committed attempt is followed by its durable message/attempt event,
  // which will replace the live row; an abandoned one never gets one.
  return frame.outcome.kind === 'abandoned' ? null : state
}

/**
 * Fold one history page into the current answer text: every settled assistant
 * message (in order) plus the in-flight chunk deltas that follow the last
 * settled message. (Legacy single-string form; transcriptOf is preferred.)
 */
export function answerTextOf(events: readonly SidebarqaHistoryEntry[]): string {
  return transcriptOf(events)
    .filter(message => message.role === 'assistant' && message.failure === undefined)
    .map(message => message.text)
    .filter(text => text !== '')
    .join('\n\n')
}

/** Whether the history feed contains a finished answering turn. */
export function hasTurnEnded(events: readonly SidebarqaHistoryEntry[]): boolean {
  return events.some(entry => entry.event.type === 'turn/end')
}
