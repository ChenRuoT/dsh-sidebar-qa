/**
 * "Which session is the main pane showing?"
 *
 * This plugin needs that answer in three places — the selection popover (which
 * session a quote belongs to), the sidebar opener (which session an open lands
 * in), and the re-activation quote clear — and there is no field for it on the
 * session list. An earlier revision read `sessions.list.getSnapshot().current`,
 * a property that **does not exist** on `SessionListState`
 * (`api/session-controller/src/client/sessions/service.ts:53`), so every one of
 * those reads returned `undefined` and the 「添加到对话」 button could never find
 * its target.
 *
 * The real definition lives in DSH's own workspace tree
 * (`client/ui-workspace/src/client/tree.ts:41`): the main session is the one the
 * main view retains.
 *
 *     Object.values(list.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id
 *
 * Kept pure and dependency-free so the rule can be tested without a DOM or a
 * live session service.
 */

/** The slice of a session row this rule reads. */
export interface CurrentSessionRow {
  /** The row's id; a row without one is identified by its key in `byId`. */
  readonly id?: string
  /**
   * Local ownership counts by consumer source; `mainView` counts the main pane's
   * reference to the session. Absent keys mean zero.
   */
  readonly retainedBy?: Readonly<Partial<Record<string, number>>>
  /** Latest activity, the tiebreaker when several rows claim the main view. */
  readonly updatedAt?: number
}

/** The slice of the session list this rule reads. */
export interface CurrentSessionList {
  readonly ids?: readonly string[]
  readonly byId?: Readonly<Record<string, CurrentSessionRow>>
}

/**
 * The session the main pane retains, or undefined when none does.
 *
 * More than one row can hold a `mainView` reference during a switch (the outgoing
 * session is released after the incoming one is retained), so the newest
 * `updatedAt` wins; rows without one sort last, and `ids` order breaks the
 * remaining ties so the answer is deterministic.
 * @param list - the session list snapshot.
 * @returns the session id, or undefined.
 */
export function resolveCurrentSessionId(list: CurrentSessionList | undefined): string | undefined {
  if (list === undefined) return undefined
  const rows = list.byId ?? {}
  const order = list.ids ?? Object.keys(rows)
  const rank = new Map(order.map((id, index) => [id, index]))

  let best: { id: string; updatedAt: number; rank: number } | undefined
  for (const [key, row] of Object.entries(rows)) {
    if ((row.retainedBy?.mainView ?? 0) <= 0) continue
    // A row without its own id is identified by its key in `byId`.
    const id = row.id === undefined || row.id === '' ? key : row.id
    const candidate = {
      id,
      updatedAt: row.updatedAt ?? Number.NEGATIVE_INFINITY,
      rank: rank.get(id) ?? Number.POSITIVE_INFINITY,
    }
    if (best === undefined
      || candidate.updatedAt > best.updatedAt
      || (candidate.updatedAt === best.updatedAt && candidate.rank < best.rank)) {
      best = candidate
    }
  }
  return best?.id
}
