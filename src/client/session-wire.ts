/**
 * The client wire seam over `ctx.remote.session` — the typed Remote namespace
 * that replaced the removed `ctx.connection.api.sessions` surface.
 *
 * Two things changed with that host refactor and both are absorbed here so no
 * call site has to know:
 *
 * 1. **Envelope.** Remote methods resolve to a FLAT
 *    `{ ok: true, value } | { ok: false, error }`; the old `{ result: … }`
 *    wrapper is gone. {@link unwrapRemote} / {@link remoteErrorText} are the
 *    single place that shape is read.
 * 2. **History.** `sessions.history` is gone. A page now needs a `throughSeq`
 *    the host itself handed out, so the transcript is read by OPENING
 *    `session.follow` (opening window + live appends) and quoting its snapshot
 *    `cursor` on every later `session.page` call. The wire also packs runs of
 *    consecutive assistant deltas into single records, so
 *    {@link eventsOfRecords} unpacks them back into per-seq `assistant/chunk`
 *    events — which keeps `answer.ts` a pure fold over scalar events.
 *
 * Everything except {@link followSession} is pure and unit-tested; the module
 * imports nothing node-only (the purity gate and the `node` test environment
 * both apply).
 */
import type {
  Context,
  SidebarqaChunkRunEvent,
  SidebarqaHistoryEntry,
  SidebarqaHistoryRecord,
  SidebarqaModelSelection,
  SidebarqaObservableSnapshot,
  SidebarqaRemoteResult,
  SidebarqaSessionAddress,
  SidebarqaSessionEvent,
} from '../context-types.ts'

/** Address one ordinary session on the journal RPCs. */
export function sessionAddress(sessionId: string): SidebarqaSessionAddress {
  return { kind: 'session', sessionId }
}

/** Render one Remote failure as `code: message` (the panel's error strips). */
export function remoteErrorText(error: { code: string; message: string }): string {
  return `${error.code}: ${error.message}`
}

/**
 * Read a Remote result's value, or throw with the failure text.
 * @param result - the flat Remote envelope.
 * @param what - operation name used in the thrown message (`create session`).
 */
export function unwrapRemote<T>(result: SidebarqaRemoteResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what} failed: ${remoteErrorText(result.error)}`)
  return result.value
}

/**
 * A UUID v4 for one prompt's client-minted identity (`requestId`, now a
 * REQUIRED field of `session.prompt`). `crypto.getRandomValues` is used rather
 * than `crypto.randomUUID` because the latter needs a secure context and DSH
 * is routinely served over plain http on a LAN address.
 * @param bytes - injectable 16-byte source (tests); defaults to WebCrypto.
 */
export function mintRequestId(bytes?: Uint8Array): string {
  const value = Uint8Array.from(bytes ?? globalThis.crypto.getRandomValues(new Uint8Array(16)))
  value[6] = ((value[6] ?? 0) & 0x0f) | 0x40
  value[8] = ((value[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The `chunkrow/*` payload shape (mirror of the persistence layer's ChunkRow data). */
interface ChunkRunData {
  turn?: unknown
  step?: unknown
  index?: unknown
  dt?: unknown
  texts?: unknown
  args?: unknown
  id?: unknown
  name?: unknown
}

/**
 * Unpack one packed delta run back into the scalar `assistant/chunk` events it
 * represents (mirror of the persistence codec's `expandRow`): member `i` sits
 * at `seq0 + i`, and `dt[i - 1]` is the gap to the previous member's time.
 * Malformed runs yield nothing rather than a broken event.
 */
export function eventsOfChunkRun(run: SidebarqaChunkRunEvent): SidebarqaSessionEvent[] {
  const data = run.data as ChunkRunData
  const toolCall = run.type === 'chunkrow/tool-call-chunks'
  const members = toolCall ? data.args : data.texts
  if (!Array.isArray(members)) return []
  const deltas = Array.isArray(data.dt) ? data.dt : []
  const events: SidebarqaSessionEvent[] = []
  let time = run.time
  for (let index = 0; index < members.length; index++) {
    if (index > 0) {
      const gap: unknown = deltas[index - 1]
      time += typeof gap === 'number' ? gap : 0
    }
    const member: unknown = members[index]
    if (typeof member !== 'string') continue
    const chunk = toolCall
      ? {
        type: 'tool-call-delta',
        index: data.index,
        id: data.id,
        ...typeof data.name === 'string' ? { name: data.name } : {},
        argumentsDelta: member,
      }
      : {
        type: run.type === 'chunkrow/reasoning-chunks' ? 'reasoning-delta' : 'text-delta',
        index: data.index,
        text: member,
      }
    events.push({
      type: 'assistant/chunk',
      seq: run.seq + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return events
}

/**
 * Flatten one history page's wire records into the scalar-event entries the
 * transcript folder consumes. Scalar records pass through untouched; packed
 * delta runs expand in place, so the result stays ordered by seq.
 */
export function eventsOfRecords(
  records: readonly SidebarqaHistoryRecord[],
): SidebarqaHistoryEntry[] {
  const entries: SidebarqaHistoryEntry[] = []
  for (const record of records) {
    if (record.type === 'event') {
      entries.push({ event: record.event })
      continue
    }
    for (const event of eventsOfChunkRun(record.event)) entries.push({ event })
  }
  return entries
}

/**
 * Fold a freshly published window into the entries already on screen: unseen
 * seqs are added, seen ones are left alone, and the result stays seq-ordered.
 *
 * A follow republishes its complete opening window every time it is reopened
 * (tab hidden then shown, a dropped carrier reconnecting), while `loadedEvents`
 * may already hold pages loaded UPWARD past that window's start — so neither
 * side may simply replace the other. Session seqs are unique per log, which is
 * what makes the seq the whole identity here.
 */
export function mergeEntries(
  prev: SidebarqaHistoryEntry[],
  next: readonly SidebarqaHistoryEntry[],
): SidebarqaHistoryEntry[] {
  if (prev.length === 0) return [...next]
  const seen = new Set(prev.map(entry => entry.event.seq))
  const merged = [...prev]
  for (const entry of next) {
    if (seen.has(entry.event.seq)) continue
    seen.add(entry.event.seq)
    merged.push(entry)
  }
  // Nothing new: hand back the SAME array so `setState` bails out instead of
  // re-rendering the whole transcript on every republished window.
  if (merged.length === prev.length) return prev
  merged.sort((a, b) => a.event.seq - b.event.seq)
  return merged
}

/**
 * The selection a session will actually run with, from its `modelSelection`
 * projection value: the selection pinned for the NEXT request, else the one
 * the last request used. Unknown or absent projections read null.
 */
export function modelSelectionOfProjection(value: unknown): SidebarqaModelSelection | null {
  if (value === null || typeof value !== 'object') return null
  const projection = value as { next?: unknown; lastUsed?: unknown }
  for (const candidate of [projection.next, projection.lastUsed]) {
    if (candidate === null || typeof candidate !== 'object') continue
    const selection = candidate as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
    if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') continue
    return {
      provider: selection.provider,
      model: selection.model,
      ...typeof selection.reasoningEffort === 'string'
        ? { reasoningEffort: selection.reasoningEffort }
        : {},
    }
  }
  return null
}

/**
 * The identity-stable observable for one host-computed projection key of one
 * session — the read path every panel surface shares (the context meter's
 * occupancy, the model seat's current selection).
 *
 * The session is resolved through `sessions.scope → sessionOf`, so the value
 * arrives for a follow-up the plugin never opens: projections are published
 * Host-wide by the session control stream, not by the on-screen session's
 * event window.
 * @returns the key's face, or undefined when the session resolves no scope.
 */
export function projectionFaceOf(
  ctx: Context,
  sessionId: string,
  key: string,
): SidebarqaObservableSnapshot<unknown> | undefined {
  try {
    const scoped = ctx.sessions.scope(sessionId)
    if (scoped === undefined) return undefined
    return ctx.sessions.sessionOf(scoped)?.projections.faceOf(key)
  } catch {
    return undefined
  }
}

/** The selection one session will run with, read once (no subscription). */
export function currentModelOf(ctx: Context, sessionId: string): SidebarqaModelSelection | undefined {
  const face = projectionFaceOf(ctx, sessionId, 'modelSelection')
  if (face === undefined) return undefined
  try {
    return modelSelectionOfProjection(face.getSnapshot()) ?? undefined
  } catch {
    return undefined
  }
}

/** Sinks one followed transcript publishes into. */
export interface FollowSinks {
  /** The complete opening window; `cursor` pins every later page read. */
  snapshot(input: { entries: SidebarqaHistoryEntry[]; cursor: number; hasMore: boolean }): void
  /** One event appended after the opening window. */
  append(entry: SidebarqaHistoryEntry): void
}

/**
 * Follow one session's journal until the returned disposer is called: the
 * opening window lands on `snapshot`, every later append on `append`. This is
 * what replaced the 1.2s history poll — the transcript now streams.
 *
 * Failures are swallowed (the panel keeps the transcript it has): a follow is
 * a view, never a step of the ask.
 * @returns the disposer (aborts the stream and silences late frames).
 */
export function followSession(
  ctx: Context,
  sessionId: string,
  sinks: FollowSinks,
  maxMessages = 60,
): () => void {
  const controller = new AbortController()
  let cancelled = false
  void (async () => {
    try {
      const frames = ctx.remote.session.follow(
        { address: sessionAddress(sessionId), maxMessages },
        controller.signal,
      )
      for await (const frame of frames) {
        if (cancelled) return
        if (frame.type === 'snapshot') {
          sinks.snapshot({
            entries: eventsOfRecords(frame.records),
            cursor: frame.cursor,
            hasMore: frame.hasMore,
          })
        } else {
          sinks.append({ event: frame.event })
        }
      }
    } catch {
      // A dropped follow leaves the last known transcript on screen; the next
      // mount (tab switch, session switch) reopens it.
    }
  })()
  return () => {
    cancelled = true
    controller.abort()
  }
}
