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
import { currentModelOf, sidebarqaApi, type SidebarqaConfigView, type SummarizeResult } from './api.ts'
import { buildFirstMessage, followUpTitle, parseUserMessage, topicFromQuote } from './injection.ts'
import { hasTurnEnded, transcriptOf } from './answer.ts'
import { buildTitleInput } from '../title.ts'
import type { PendingQuote, SidebarqaStore } from './store.ts'
import type { SidebarqaHistoryEntry } from '../context-types.ts'

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
    if (!response.result.ok) console.warn('[dsh-sidebar-qa] rename failed:', response.result.error.message)
  } catch (error) {
    console.warn('[dsh-sidebar-qa] rename failed:', error)
  }
}

/** Best-effort model selection (default deepseek-v4-flash, thinking off). */
async function trySelectModel(ctx: Context, sideSessionId: string, config: SidebarqaConfigView): Promise<void> {
  try {
    const response = await ctx.connection.api.sessions.selectModel({
      sessionId: sideSessionId,
      provider: config.answerProvider,
      model: config.answerModel,
      ...(config.answerReasoningEffort !== '' ? { reasoningEffort: config.answerReasoningEffort } : {}),
    })
    if (!response.result.ok) console.warn('[dsh-sidebar-qa] selectModel failed:', response.result.error.message)
  } catch (error) {
    console.warn('[dsh-sidebar-qa] selectModel failed:', error)
  }
}

/** Read the resolved plugin config (fall back to safe defaults on failure). */
async function loadConfig(ctx: Context): Promise<SidebarqaConfigView> {
  try {
    return await sidebarqaApi.config()
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
      titleBudgetTokens: 64,
    }
  }
}

/**
 * Run the full ask flow and return the created side session id.
 * @throws when create or prompt fails (the panel surfaces the error).
 */
export async function askFollowUp(
  ctx: Context,
  store: SidebarqaStore,
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
  const summarizePromise = sidebarqaApi.summarize({
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

/**
 * Fold one history page into the clean question + answer for the title model.
 * The question is recovered via {@link parseUserMessage} (summary + quote
 * stripped); the answer is every settled assistant message's text.
 */
function questionAndAnswerOf(events: readonly SidebarqaHistoryEntry[]): { question: string; answer: string } {
  const transcript = transcriptOf(events)
  const question = transcript
    .filter(message => message.role === 'user')
    .map(message => parseUserMessage(message.text).question)
    .filter(text => text.trim() !== '')
    .join(' / ')
  const answer = transcript
    .filter(message => message.role === 'assistant')
    .map(message => message.text)
    .filter(text => text.trim() !== '')
    .join('\n')
  return { question, answer }
}

/**
 * One-shot post-answer retitle: after the side session's FIRST turn completes,
 * fold the question + answer into a compact input, ask the fast no-thinking
 * title model (the summarize route: fixed flash / thinking off) for a ≤15-char
 * subject, and overwrite the placeholder `❓追问·<topicFromQuote>` title.
 * Fires at most once per side session (the store flag), never blocks the
 * panel, and degrades silently to the placeholder on any failure.
 */
export async function titleSideSessionOnce(
  ctx: Context,
  store: SidebarqaStore,
  input: { sideSessionId: string; parentSessionId: string; events: readonly SidebarqaHistoryEntry[] },
): Promise<void> {
  const { sideSessionId, parentSessionId, events } = input
  if (!hasTurnEnded(events)) return
  if (store.isTitled(sideSessionId)) return
  store.markTitled(sideSessionId)

  const { question, answer } = questionAndAnswerOf(events)
  const text = buildTitleInput(question, answer)
  if (text.trim() === '') return

  try {
    const [config, parentModel] = await Promise.all([
      loadConfig(ctx),
      currentModelOf(ctx, parentSessionId),
    ])
    const provider = config.summarizeProvider !== ''
      ? config.summarizeProvider
      : parentModel?.provider ?? config.answerProvider
    if (provider === '') return
    const result = await sidebarqaApi.title({
      text,
      provider,
      model: config.summarizeModel,
    })
    if (result.degraded || result.title === null || result.title === '') return
    await tryRename(ctx, sideSessionId, followUpTitle(result.title))
  } catch {
    // Retitle is best-effort: the placeholder title remains.
  }
}
