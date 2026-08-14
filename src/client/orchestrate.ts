/**
 * The ask orchestration: resolve the parent session's workspace and model,
 * summarize the parent surface (host route), create the side session in the
 * same workspace, rename it `❓追问·<主题>`, set its answer model from the
 * plugin config (default deepseek-v4-flash, thinking off), then prompt with
 * the summary + quoted context + question. The parent session is never opened
 * — its agent, message stream, and queue are untouched.
 *
 * `parentSessionId` is ANY session (main or a nested 追问 session): nested
 * follow-ups are supported by the same flow.
 */
import type { Context } from '../context-types.ts'
import { currentModelOf, sideqaApi, type SideqaConfigView, type SummarizeResult } from './api.ts'
import { buildFirstMessage, followUpTitle, topicFromQuote } from './injection.ts'
import type { PendingQuote, SideqaStore } from './store.ts'

/** Result of one ask. */
export interface AskResult {
  sideSessionId: string
  parentSessionId: string
  degraded: boolean
}

/** Progress phases reported to the panel (摘要生成中 → 回答中). */
export type AskPhase = 'summarizing' | 'answering'

/** Find the workspace id owning a session (undefined when ungrouped). */
function resolveWorkspaceId(ctx: Context, sessionId: string): string | undefined {
  try {
    return ctx.workspaces.list.getSnapshot().items
      .find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
  } catch {
    return undefined
  }
}

/** A session's cwd (fallback create target when it has no workspace). */
function sessionCwd(ctx: Context, sessionId: string): string | undefined {
  try {
    return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
  } catch {
    return undefined
  }
}

/** Best-effort rename that never blocks the ask. */
async function tryRename(ctx: Context, sideSessionId: string, title: string): Promise<void> {
  try {
    const response = await ctx.connection.api.sessions.rename({ sessionId: sideSessionId, title })
    if (!response.result.ok) console.warn('[dsh-side-qa] rename failed:', response.result.error.message)
  } catch (error) {
    console.warn('[dsh-side-qa] rename failed:', error)
  }
}

/** Best-effort model selection (default deepseek-v4-flash, thinking off). */
async function trySelectModel(ctx: Context, sideSessionId: string, config: SideqaConfigView): Promise<void> {
  try {
    const response = await ctx.connection.api.sessions.selectModel({
      sessionId: sideSessionId,
      provider: config.answerProvider,
      model: config.answerModel,
      ...(config.answerReasoningEffort !== '' ? { reasoningEffort: config.answerReasoningEffort } : {}),
    })
    if (!response.result.ok) console.warn('[dsh-side-qa] selectModel failed:', response.result.error.message)
  } catch (error) {
    console.warn('[dsh-side-qa] selectModel failed:', error)
  }
}

/** Read the resolved plugin config (fall back to safe defaults on failure). */
async function loadConfig(ctx: Context): Promise<SideqaConfigView> {
  try {
    return await sideqaApi.config()
  } catch {
    // Keep the ask working even if the host route is unavailable.
    return {
      summarizeProvider: '',
      summarizeModel: 'deepseek-v4-flash',
      summarizeReasoningEffort: 'off',
      summarizeBudgetTokens: 160,
      recentWindowMessages: 2,
      backgroundWindowMessages: 12,
      answerProvider: 'deepseek-official',
      answerModel: 'deepseek-v4-flash',
      answerReasoningEffort: 'off',
    }
  }
}

/**
 * Run the full ask flow and return the created side session id.
 * @throws when create or prompt fails (the panel surfaces the error).
 */
export async function askFollowUp(
  ctx: Context,
  store: SideqaStore,
  input: { parentSessionId: string; quote: PendingQuote; question: string },
  onPhase?: (phase: AskPhase) => void,
): Promise<AskResult> {
  const { parentSessionId, quote, question } = input
  onPhase?.('summarizing')

  const [config, currentModel] = await Promise.all([
    loadConfig(ctx),
    currentModelOf(ctx, parentSessionId),
  ])
  const workspaceId = resolveWorkspaceId(ctx, parentSessionId)
  const cwd = workspaceId === undefined ? sessionCwd(ctx, parentSessionId) : undefined

  // Summarize + create run in parallel (independent).
  const summarizePromise = sideqaApi.summarize({
    mainSessionId: parentSessionId,
    ...(config.summarizeProvider !== ''
      ? { provider: config.summarizeProvider }
      : currentModel !== undefined
        ? { provider: currentModel.provider }
        : {}),
  }).catch((): SummarizeResult => ({ degraded: true, summary: null, sourceSeq: -1, reason: 'network' }))

  const createResponse = await ctx.connection.api.sessions.create(
    workspaceId !== undefined
      ? { workspaceId }
      : cwd !== undefined
        ? { cwd }
        : {},
  )
  if (!createResponse.result.ok) {
    throw new Error(`create session failed: ${createResponse.result.error.code}: ${createResponse.result.error.message}`)
  }
  const sideSessionId = createResponse.result.value.sessionId
  const summarize = await summarizePromise

  await tryRename(ctx, sideSessionId, followUpTitle(topicFromQuote(quote.text)))
  await trySelectModel(ctx, sideSessionId, config)

  const label = quote.role === 'user' ? '用户消息' : 'Agent 回复'
  const text = buildFirstMessage(summarize.summary, quote, question, label)
  const promptResponse = await ctx.connection.api.sessions.prompt({
    sessionId: sideSessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  })
  if (!promptResponse.result.ok) {
    throw new Error(`prompt failed: ${promptResponse.result.error.code}: ${promptResponse.result.error.message}`)
  }

  store.addChild(parentSessionId, sideSessionId)
  onPhase?.('answering')
  return { sideSessionId, parentSessionId, degraded: summarize.degraded }
}

/**
 * Send a follow-up message inside an existing side session (no summary — only
 * the first message carries the compressed parent context, per PRD 6).
 */
export async function sendFollowUp(ctx: Context, sideSessionId: string, question: string): Promise<void> {
  const response = await ctx.connection.api.sessions.prompt({
    sessionId: sideSessionId,
    mode: 'queue',
    content: [{ type: 'text', text: question }],
  })
  if (!response.result.ok) {
    throw new Error(`prompt failed: ${response.result.error.code}: ${response.result.error.message}`)
  }
}
