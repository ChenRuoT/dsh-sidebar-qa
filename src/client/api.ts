/**
 * Typed fetch wrapper over the /sidebarqa JSON API (the host half's context
 * method — the three history strategies — plus title and config). Mirrors the
 * wire envelope `{ok: true, value} | {ok: false, error}`.
 */
import type { Context } from '../context-types.ts'
import type { SidebarqaHistoryStrategy } from '../config.ts'
import type { SidebarqaCatalog } from '../context-types.ts'

/** One wire failure. */
export class SidebarqaApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Result of one context call (mirror of the host SidebarqaContextResult). */
export interface ContextResult {
  degraded: boolean
  /** The injected context text (`null` for `inherit` or on failure). */
  text: string | null
  sourceSeq: number
  reason?: string
}

/** Result of one title call (mirror of the host TitleResult). */
export interface TitleResult {
  degraded: boolean
  title: string | null
  reason?: string
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/sidebarqa/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new SidebarqaApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarqaApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** Resolved sidebarqa configuration (mirror of the host SidebarqaConfig). */
export interface SidebarqaConfigView {
  historyStrategy: SidebarqaHistoryStrategy
  trimWindowMessages: number
  summarizeProvider: string
  summarizeModel: string
  summarizeReasoningEffort: string
  summarizeBudgetTokens: number
  recentWindowMessages: number
  backgroundWindowMessages: number
  answerProvider: string
  answerModel: string
  answerReasoningEffort: string
  titleBudgetTokens: number
}

/** The config namespace envelope (value + revision for revision-guarded writes). */
export interface SidebarqaConfigEnvelope {
  value?: SidebarqaConfigView
  revision?: number
}

/** The sidebarqa API surface (session scope-free; the route fences itself). */
export const sidebarqaApi = {
  context: (payload: Record<string, unknown>, signal?: AbortSignal) =>
    call<ContextResult>('context', payload, signal),
  title: (payload: Record<string, unknown>, signal?: AbortSignal) =>
    call<TitleResult>('title', payload, signal),
  config: (signal?: AbortSignal) =>
    call<SidebarqaConfigView>('config', {}, signal),
  catalog: (signal?: AbortSignal) =>
    call<SidebarqaCatalog>('catalog', {}, signal),
  configGet: (signal?: AbortSignal) =>
    call<SidebarqaConfigEnvelope>('config.get', {}, signal),
  configUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<SidebarqaConfigEnvelope>('config.update', {
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
}

/** Resolve a session's current model selection (used to inherit the summarize provider). */
export async function currentModelOf(ctx: Context, sessionId: string): Promise<{ provider: string; model: string; reasoningEffort?: string } | undefined> {
  try {
    const response = await ctx.connection.api.sessions.models({ sessionId })
    if (!response.result.ok) return undefined
    return response.result.value.current ?? undefined
  } catch {
    return undefined
  }
}
