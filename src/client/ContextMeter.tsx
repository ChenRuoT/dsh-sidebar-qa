/**
 * The AskPanel's context-occupancy meter: a ring beside the send button fed by
 * the host-computed `contextPressure` projection, with a click-open panel of
 * the `contextBreakdown` composition (system prompt / tools / conversation).
 * Reads the per-session projection store through `ctx.sessions.scope →
 * sessionOf → projections.faceOf` — the same projection values the host
 * composer's ContextMeter renders, reached without any plugin-to-plugin
 * import. Renders nothing until a provider reports both pressure and a route
 * capacity.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Context,
  SidebarqaContextBreakdown,
  SidebarqaContextPressure,
} from '../context-types.ts'
import { contextOccupancy, formatTokens } from './context-meter.ts'
import { t } from './locales.ts'
import css from './ask-panel.module.css'

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Panel legend rows, in bar-segment order (each color class pairs swatch +
 *  segment). The rows carry the copy KEY, not the copy: a module-level table
 *  holding resolved text would never follow a language switch. */
const ROWS = [
  { key: 'systemTokens', labelKey: 'meterSystem', color: css.meterColorSystem },
  { key: 'toolsTokens', labelKey: 'meterTools', color: css.meterColorTools },
  { key: 'messageTokens', labelKey: 'meterMessages', color: css.meterColorMessages },
] as const

/**
 * One projection key's value for a session, as a React observable.
 * Absent projections (face undefined or value undefined) read `undefined`.
 */
function useProjectionValue(ctx: Context, sessionId: string, key: string): unknown {
  const face = useMemo(() => {
    try {
      const scoped = ctx.sessions.scope(sessionId)
      if (scoped === undefined) return undefined
      return ctx.sessions.sessionOf(scoped)?.projections.faceOf(key)
    } catch {
      return undefined
    }
  }, [ctx, sessionId, key])
  return useSyncExternalStore(
    (cb) => face?.subscribe(cb) ?? (() => {}),
    () => face?.getSnapshot(),
  )
}

export interface ContextMeterProps {
  ctx: Context
  /** The session whose context occupancy is shown. */
  sessionId: string
}

export function ContextMeter({ ctx, sessionId }: ContextMeterProps) {
  const pressure = useProjectionValue(ctx, sessionId, 'contextPressure') as SidebarqaContextPressure | undefined
  const breakdown = useProjectionValue(ctx, sessionId, 'contextBreakdown') as SidebarqaContextBreakdown | undefined
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  const context = contextOccupancy(pressure)
  const available = context !== null

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  if (context === null) return null
  const percent = context.percent
  const reading = `${percent}%`

  // The bar's overall length stays the provider-exact percent; the heuristic
  // breakdown only proportions its colored parts.
  const breakdownTotal = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const parts = breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: undefined, width: percent }]
    : ROWS.map(row => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / breakdownTotal }))
  const segments = parts.filter(part => part.width > 0)

  return (
    <span ref={rootRef} className={css.meterRoot}>
      <Tooltip label={t('meterUsed', { reading })} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.meterTrigger}
          aria-label={t('meterUsed', { reading })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.meterTrack} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.meterFill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
        </button>
      </Tooltip>
      {open && (
        <div className={css.meterPanel} role="dialog" aria-label={t('meterPanelLabel')}>
          <div className={css.meterHeader}>
            <span className={css.meterHeadline}>{t('meterHeadline')}</span>
            <span className={css.meterPercent}>{reading}</span>
            <span className={css.meterFigures}>
              {`~${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`}
            </span>
          </div>
          <div className={css.meterBar}>
            {segments.map(segment => (
              <div
                key={segment.key}
                className={segment.color === undefined ? css.meterSegment : `${css.meterSegment} ${segment.color}`}
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          {breakdown !== undefined && (
            <dl className={css.meterRows}>
              {ROWS.map(row => (
                <div key={row.key} className={css.meterRow}>
                  <dt>
                    <span className={`${css.meterSwatch} ${row.color}`} aria-hidden />
                    {t(row.labelKey)}
                  </dt>
                  <dd>{`~${formatTokens(breakdown[row.key])}`}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </span>
  )
}
