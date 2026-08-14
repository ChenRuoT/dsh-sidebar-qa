/**
 * Typed fetch wrapper over the /sidebarqa JSON API (the host half's summarize
 * route). Mirrors the wire envelope `{ok: true, value} | {ok: false, error}`.
 */
import type { Context } from '../context-types.ts'

/** One wire failure. */
export class SidebarqaApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Result of one summarize call (mirror of the host SummarizeResult). */
export interface SummarizeResult {
  degraded: boolean
  summary: string | null
  sourceSeq: number
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
  summarizeProvider: string
  summarizeModel: string
  summarizeReasoningEffort: string
  summarizeBudgetTokens: number
  recentWindowMessages: number
  backgroundWindowMessages: number
  answerProvider: string
  answerModel: string
  answerReasoningEffort: string
}

/** The sidebarqa API surface (session scope-free; the route fences itself). */
export const sidebarqaApi = {
  summarize: (payload: Record<string, unknown>, signal?: AbortSignal) =>
    call<SummarizeResult>('summarize', payload, signal),
  config: (signal?: AbortSignal) =>
    call<SidebarqaConfigView>('config', {}, signal),
}

/** Resolve a session's current model selection (used to inherit the summarize provider). */
export async function currentModelOf(ctx: Context, sessionId: string): Promise<{ provider: string; model: string; reasoningEffort?: string } | undefined> {
  try {
    const response = await ctx.connection.api.sessions.models({ sessionId })
    if (!response.result.ok) return undefined
    return response.result.value.current
  } catch {
    return undefined
  }
}
