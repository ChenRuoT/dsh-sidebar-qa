/**
 * The React adapter over one session's host-computed projection values.
 *
 * Two panel surfaces read projections and both go through here: the context
 * meter (`contextPressure` / `contextBreakdown`) and the model seat
 * (`modelSelection`, which replaced the removed `session.models` RPC's
 * `current` field). The resolution itself lives in `session-wire.ts` so the
 * "which session, which key" rule stays testable without React.
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { Context } from '../context-types.ts'
import { projectionFaceOf } from './session-wire.ts'

/**
 * One projection key's value for a session, as a React observable. Absent
 * projections (unresolvable session, face undefined, value undefined) read
 * `undefined` — never throw: a projection is always advisory.
 * @param ctx - the plugin's client context.
 * @param sessionId - the session whose projection is read.
 * @param key - the projection key (`contextPressure`, `modelSelection`, …).
 */
export function useProjectionValue(ctx: Context, sessionId: string, key: string): unknown {
  const face = useMemo(() => projectionFaceOf(ctx, sessionId, key), [ctx, sessionId, key])
  return useSyncExternalStore(
    (cb) => face?.subscribe(cb) ?? (() => {}),
    () => face?.getSnapshot(),
  )
}
