/**
 * Pure helpers for the AskPanel's context-occupancy meter (port of the host
 * composer's ContextMeter arithmetic). Dependency-free for unit testing; the
 * projection value shape is the structural mirror from context-types.
 */
import type { SidebarqaContextPressure } from '../context-types.ts'

/** One meter reading: occupancy percent + its numerator/denominator. */
export interface SidebarqaContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits). Port of the host StatsLine helper so both meters read identically.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Approximate context occupancy: `projectedTokens` (the provider sample
 * carried forward over the surface's movement since) falls back to the bare
 * `pressureTokens`; both numerator and capacity must be known, else null.
 * @param pressure - the session's `contextPressure` projection value.
 * @returns occupancy, or null until both values are known.
 */
export function contextOccupancy(
  pressure: SidebarqaContextPressure | undefined,
): SidebarqaContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}
