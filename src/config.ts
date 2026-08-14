/**
 * Configuration for the host summarize service and the side-session answer
 * model. The user-facing knobs live in the DSH settings service under the
 * `sideqa` namespace (schemastery schema); deployments without a settings
 * service fall back to {@link SIDEQA_DEFAULTS}.
 */
import z from 'schemastery'

/** Settings namespace id. */
export const SIDEQA_SETTINGS_NS = 'sideqa'

/** User-editable configuration. */
export interface SideqaConfig {
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
export const SIDEQA_DEFAULTS: SideqaConfig = {
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

/** Schemastery schema for the `sideqa` settings namespace. */
export const SideqaPrefsSchema = z.object({
  summarizeProvider: z.string().default(SIDEQA_DEFAULTS.summarizeProvider),
  summarizeModel: z.string().default(SIDEQA_DEFAULTS.summarizeModel),
  summarizeReasoningEffort: z.string().default(SIDEQA_DEFAULTS.summarizeReasoningEffort),
  summarizeBudgetTokens: z.number().step(1).min(64).max(8192).default(SIDEQA_DEFAULTS.summarizeBudgetTokens),
  recentWindowMessages: z.number().step(1).min(1).max(64).default(SIDEQA_DEFAULTS.recentWindowMessages),
  backgroundWindowMessages: z.number().step(1).min(1).max(256).default(SIDEQA_DEFAULTS.backgroundWindowMessages),
  answerProvider: z.string().default(SIDEQA_DEFAULTS.answerProvider),
  answerModel: z.string().default(SIDEQA_DEFAULTS.answerModel),
  answerReasoningEffort: z.string().default(SIDEQA_DEFAULTS.answerReasoningEffort),
})
