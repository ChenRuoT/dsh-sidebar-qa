/**
 * Configuration for the host summarize service and the side-session answer
 * model. The user-facing knobs live in the DSH settings service under the
 * `sidebarqa` namespace (schemastery schema); deployments without a settings
 * service fall back to {@link SIDEBARQA_DEFAULTS}.
 */
import z from 'schemastery'

/** Settings namespace id. */
export const SIDEBARQA_SETTINGS_NS = 'sidebarqa'

/** User-editable configuration. */
export interface SidebarqaConfig {
  // ── Summarize (fast no-thinking compression) ─────────────────────────────
  /** Registered provider route for the fast model; '' = inherit the main session's provider. */
  summarizeProvider: string
  /** Fast no-thinking chat model id. */
  summarizeModel: string
  /** Thinking effort for the fast model; '' = omit (adapter default). */
  summarizeReasoningEffort: string
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
  /** Thinking effort for the answer model; 'off' = no thinking. */
  answerReasoningEffort: string
}

/** Schema-backed defaults (also used when the settings service is absent). */
export const SIDEBARQA_DEFAULTS: SidebarqaConfig = {
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

/** Schemastery schema for the `sidebarqa` settings namespace. */
export const SidebarqaPrefsSchema = z.object({
  summarizeProvider: z.string().default(SIDEBARQA_DEFAULTS.summarizeProvider),
  summarizeModel: z.string().default(SIDEBARQA_DEFAULTS.summarizeModel),
  summarizeReasoningEffort: z.string().default(SIDEBARQA_DEFAULTS.summarizeReasoningEffort),
  summarizeBudgetTokens: z.number().step(1).min(64).max(8192).default(SIDEBARQA_DEFAULTS.summarizeBudgetTokens),
  recentWindowMessages: z.number().step(1).min(1).max(64).default(SIDEBARQA_DEFAULTS.recentWindowMessages),
  backgroundWindowMessages: z.number().step(1).min(1).max(256).default(SIDEBARQA_DEFAULTS.backgroundWindowMessages),
  answerProvider: z.string().default(SIDEBARQA_DEFAULTS.answerProvider),
  answerModel: z.string().default(SIDEBARQA_DEFAULTS.answerModel),
  answerReasoningEffort: z.string().default(SIDEBARQA_DEFAULTS.answerReasoningEffort),
})
