/**
 * Configuration for the host summarize service and the side-session answer
 * model. The user-facing knobs live in the DSH settings service under the
 * `sidebarqa` namespace (schemastery schema); deployments without a settings
 * service fall back to {@link SIDEBARQA_DEFAULTS}.
 */
import z from 'schemastery'

/** Settings namespace id. */
export const SIDEBARQA_SETTINGS_NS = 'sidebarqa'

/** DSH reasoning-effort vocabulary: Off / High / Max. */
export type SidebarqaReasoningEffort = 'off' | 'high' | 'max'

/**
 * The side-question history strategy: how the parent conversation's context
 * reaches the side session.
 * - `inherit`: fork the parent (full history seed → provider prefix-cache hits).
 * - `compressed`: compress the earlier window with the fast model + verbatim recent.
 * - `trim`: keep the last `trimWindowMessages` messages verbatim, zero LLM cost.
 */
export type SidebarqaHistoryStrategy = 'inherit' | 'compressed' | 'trim'

/** User-editable configuration. */
export interface SidebarqaConfig {
  // ── History strategy (how the parent context reaches the side session) ───
  /** 'inherit' | 'compressed' | 'trim'; the per-ask selector defaults to this. */
  historyStrategy: SidebarqaHistoryStrategy
  /** How many recent messages `trim` keeps verbatim (no model involved). */
  trimWindowMessages: number

  // ── Summarize (fast no-thinking compression) ─────────────────────────────
  /** Registered provider route for the fast model; '' = inherit the main session's provider. */
  summarizeProvider: string
  /** Fast no-thinking chat model id. */
  summarizeModel: string
  /** Thinking effort for the fast model: Off / High / Max. */
  summarizeReasoningEffort: SidebarqaReasoningEffort
  /** Output budget of the generated BACKGROUND summary, in tokens (soft bound). */
  summarizeBudgetTokens: number
  /** How many recent messages to keep VERBATIM (the current-state anchor). */
  recentWindowMessages: number
  /** How many earlier messages to send to the model for background compression. */
  backgroundWindowMessages: number

  // ── Answer (side-session conversation model) ─────────────────────────────
  /** Provider route for the side session's answer model. */
  answerProvider: string
  /** Model id for the side session's answer model. */
  answerModel: string
  /** Thinking effort for the answer model: Off / High / Max. */
  answerReasoningEffort: SidebarqaReasoningEffort

  // ── Title (post-answer retitle, reuses the summarize model route) ─────────
  /** Output-token cap for the post-answer title generation. */
  titleBudgetTokens: number
}

/** Schema-backed defaults (also used when the settings service is absent). */
export const SIDEBARQA_DEFAULTS: SidebarqaConfig = {
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

/** Schemastery schema for the `sidebarqa` settings namespace. */
export const SidebarqaPrefsSchema = z.object({
  historyStrategy: z.union(['inherit', 'compressed', 'trim']).default(SIDEBARQA_DEFAULTS.historyStrategy),
  trimWindowMessages: z.number().step(1).min(1).max(256).default(SIDEBARQA_DEFAULTS.trimWindowMessages),
  summarizeProvider: z.string().default(SIDEBARQA_DEFAULTS.summarizeProvider),
  summarizeModel: z.string().default(SIDEBARQA_DEFAULTS.summarizeModel),
  summarizeReasoningEffort: z.union(['off', 'high', 'max']).default(SIDEBARQA_DEFAULTS.summarizeReasoningEffort),
  summarizeBudgetTokens: z.number().step(1).min(64).max(8192).default(SIDEBARQA_DEFAULTS.summarizeBudgetTokens),
  recentWindowMessages: z.number().step(1).min(1).max(64).default(SIDEBARQA_DEFAULTS.recentWindowMessages),
  backgroundWindowMessages: z.number().step(1).min(1).max(256).default(SIDEBARQA_DEFAULTS.backgroundWindowMessages),
  answerProvider: z.string().default(SIDEBARQA_DEFAULTS.answerProvider),
  answerModel: z.string().default(SIDEBARQA_DEFAULTS.answerModel),
  answerReasoningEffort: z.union(['off', 'high', 'max']).default(SIDEBARQA_DEFAULTS.answerReasoningEffort),
  titleBudgetTokens: z.number().step(1).min(16).max(256).default(SIDEBARQA_DEFAULTS.titleBudgetTokens),
})
