/**
 * Compact relative-time formatting for the 追问记录 (history) rows — the same
 * presentation as the DSH left (workspace browser) panel: a bucketed relative
 * label ("刚刚"/"5分钟"/"3小时"/"2天"/"4个月"/"1年" in zh) computed from the
 * session's last-activity `updatedAt`. Zero dependencies, unit-tested.
 *
 * The bucketing mirrors `relativeTime` from @deepseek-ai/dsh-client-ui-workspace
 * (the left panel's source of truth), restated here so the client bundle stays
 * free of a value-import from another plugin package.
 */

export type HistoryTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

export interface HistoryRelativeTime {
  unit: HistoryTimeUnit
  n: number
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Bucket an epoch-ms `updatedAt` relative to `now` (both injected for pure rendering). */
export function relativeTime(updatedAt: number, now: number): HistoryRelativeTime {
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** The zh compact label ("刚刚" / "5分钟" / "3小时" / …) — mirror of the left panel row label. */
export function timeLabel(updatedAt: number, now: number): string {
  const { unit, n } = relativeTime(updatedAt, now)
  switch (unit) {
    case 'now': return '刚刚'
    case 'minutes': return `${n}分钟`
    case 'hours': return `${n}小时`
    case 'days': return `${n}天`
    case 'months': return `${n}个月`
    case 'years': return `${n}年`
  }
}
