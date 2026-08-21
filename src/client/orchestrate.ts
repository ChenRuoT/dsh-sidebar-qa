/**
 * The ask orchestration: resolve the parent session's workspace and model,
 * assemble the parent context per the chosen history strategy, create the
 * side session, rename it `❓<主题>`, then prompt with the context +
 * quoted text + question. The parent session is never opened — its agent,
 * message stream, and queue are untouched.
 *
 * History strategies:
 * - `inherit`: fork the parent from its latest completed-turn boundary. The
 *   child inherits the FULL history as a frozen seed, so its first request
 *   reuses the parent's message prefix — DeepSeek's automatic prefix cache
 *   hits, no compression loss. The child keeps the parent's model (no
 *   selectModel — a different model would break the shared prefix). When the
 *   parent has no completed turn yet (agent mid-turn), the fork fails with
 *   `fork-unavailable` and the flow DEGRADES to `compressed`.
 * - `compressed`: the host compresses the earlier window with the fast model
 *   and keeps the recent band verbatim (default; existing behavior).
 * - `trim`: the host keeps the last N messages verbatim — no model, no cost.
 *
 * `parentSessionId` is ANY session (main or a nested 追问 session): nested
 * follow-ups are supported by the same flow.
 */
import type { Context } from '../context-types.ts'
import type { SidebarqaHistoryStrategy } from '../config.ts'
import { workspaceOwningSession } from './history-scope.ts'
import { currentModelOf, sidebarqaApi, type ContextResult, type SidebarqaConfigView } from './api.ts'
import { buildFirstMessage, followUpTitle, parseUserMessage, topicFromQuote } from './injection.ts'
import { hasTurnEnded, transcriptOf } from './answer.ts'
import { buildTitleInput } from '../title.ts'
import { promptsOf } from '../prompt-locale.ts'
import { promptLocale } from './locales.ts'
import type { PendingQuote, SidebarqaStore } from './store.ts'
import type { SidebarqaHistoryEntry, SidebarqaModelSelection } from '../context-types.ts'

/** Result of one ask. */
export interface AskResult {
  sideSessionId: string
  parentSessionId: string
  degraded: boolean
  /** The strategy actually used (equals the requested one unless a fallback fired). */
  strategy: SidebarqaHistoryStrategy
}

/** Progress phases reported to the panel (准备中 → 回答中). */
export type AskPhase = 'preparing' | 'answering'

/** Find the workspace id owning a session (undefined when ungrouped). */
function resolveWorkspaceId(ctx: Context, sessionId: string): string | undefined {
  try {
    return workspaceOwningSession(ctx.workspaces.list.getSnapshot().items, sessionId)?.workspaceId
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

/** Best-effort model selection (default deepseek-v4-flash, thinking off; a
 *  panel-picked override wins when present). */
async function trySelectModel(
  ctx: Context,
  sideSessionId: string,
  config: SidebarqaConfigView,
  override?: SidebarqaModelSelection,
): Promise<void> {
  try {
    const response = await ctx.connection.api.sessions.selectModel({
      sessionId: sideSessionId,
      provider: override?.provider ?? config.answerProvider,
      model: override?.model ?? config.answerModel,
      // All-or-nothing on the effort axis: an override that deliberately carries
      // NO effort means "follow the provider default" and must not be topped up
      // with the configured effort (which would force `off` onto a thinking
      // model the user just picked).
      ...(override === undefined
        ? { reasoningEffort: config.answerReasoningEffort }
        : override.reasoningEffort === undefined ? {} : { reasoningEffort: override.reasoningEffort }),
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
      historyStrategy: 'compressed',
      trimWindowMessages: 10,
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

/** Best-effort fork of the parent (the `inherit` strategy's session creation). */
async function tryForkParent(ctx: Context, parentSessionId: string): Promise<string> {
  const response = await ctx.connection.api.sessions.fork({ sessionId: parentSessionId })
  if (!response.result.ok) {
    throw new Error(`fork failed: ${response.result.error.code}: ${response.result.error.message}`)
  }
  return response.result.value.sessionId
}

/** Prompt a side session with the assembled first message (throws on failure). */
async function tryPrompt(ctx: Context, sideSessionId: string, text: string): Promise<void> {
  const response = await ctx.connection.api.sessions.prompt({
    sessionId: sideSessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  })
  if (!response.result.ok) {
    throw new Error(`prompt failed: ${response.result.error.code}: ${response.result.error.message}`)
  }
}

/**
 * Run the full ask flow and return the created side session id.
 * @throws when create or prompt fails (the panel surfaces the error).
 */
export async function askFollowUp(
  ctx: Context,
  store: SidebarqaStore,
  input: {
    parentSessionId: string
    quote: PendingQuote
    question: string
    strategy?: SidebarqaHistoryStrategy
    /** Model picked in the panel for the next ask (compressed/trim children;
     *  inherit children keep the parent's model by construction). */
    modelOverride?: SidebarqaModelSelection
  },
  onPhase?: (phase: AskPhase) => void,
): Promise<AskResult> {
  const { parentSessionId, quote, question } = input
  onPhase?.('preparing')

  const [config, currentModel] = await Promise.all([
    loadConfig(ctx),
    currentModelOf(ctx, parentSessionId),
  ])
  const workspaceId = resolveWorkspaceId(ctx, parentSessionId)
  const cwd = workspaceId === undefined ? sessionCwd(ctx, parentSessionId) : undefined
  // The model-facing language of THIS ask (the answer language itself follows
  // the user's question — see prompt-locale.ts — not this setting).
  const locale = promptLocale()
  const prompts = promptsOf(locale)
  const label = quote.role === 'user' ? prompts.quoteLabelUser : prompts.quoteLabelAgent

  let strategy: SidebarqaHistoryStrategy = input.strategy ?? config.historyStrategy ?? 'compressed'

  // ── inherit: fork the parent — full context, prefix-cache hits ──────────
  if (strategy === 'inherit') {
    let forkedId: string | undefined
    try {
      forkedId = await tryForkParent(ctx, parentSessionId)
    } catch (error) {
      // Mid-turn (fork-unavailable) or any fork failure → degrade to the
      // battle-tested compressed path; the ask still goes through. Only the
      // FORK is forgiven — later rename/prompt failures must surface, not
      // silently create a duplicate session.
      console.warn('[dsh-sidebar-qa] inherit fork failed, degrading to compressed:', error)
      strategy = 'compressed'
    }
    if (forkedId !== undefined) {
      const sideSessionId = forkedId
      await tryRename(ctx, sideSessionId, followUpTitle(topicFromQuote(quote.text, prompts.fallbackTopic)))
      // No selectModel: the child keeps the parent's model so the first
      // request shares the parent's message prefix (cache hits preserved).
      const text = buildFirstMessage(null, quote, question, label, locale)
      await tryPrompt(ctx, sideSessionId, text)
      store.addChild(parentSessionId, sideSessionId)
      onPhase?.('answering')
      return { sideSessionId, parentSessionId, degraded: false, strategy }
    }
  }

  // ── compressed / trim: assemble the context text + create a fresh session ─
  const contextPromise = sidebarqaApi.context({
    mainSessionId: parentSessionId,
    strategy,
    locale,
    ...(config.summarizeProvider !== ''
      ? { provider: config.summarizeProvider }
      : currentModel !== undefined
        ? { provider: currentModel.provider }
        : {}),
  }).catch((): ContextResult => ({ degraded: true, text: null, sourceSeq: -1, reason: 'network' }))

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
  const context = await contextPromise

  await tryRename(ctx, sideSessionId, followUpTitle(topicFromQuote(quote.text, prompts.fallbackTopic)))
  await trySelectModel(ctx, sideSessionId, config, input.modelOverride)

  const text = buildFirstMessage(context.text, quote, question, label, locale)
  await tryPrompt(ctx, sideSessionId, text)

  store.addChild(parentSessionId, sideSessionId)
  onPhase?.('answering')
  return { sideSessionId, parentSessionId, degraded: context.degraded, strategy }
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
 * subject, and overwrite the placeholder `❓<topicFromQuote>` title.
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

  const locale = promptLocale()
  const { question, answer } = questionAndAnswerOf(events)
  const text = buildTitleInput(question, answer, locale)
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
      locale,
    })
    if (result.degraded || result.title === null || result.title === '') return
    await tryRename(ctx, sideSessionId, followUpTitle(result.title))
  } catch {
    // Retitle is best-effort: the placeholder title remains.
  }
}
