/**
 * Configuration for the host summarize service and the side-session answer
 * model.
 *
 * The user-facing knobs are declared ONCE, as the plugin's own cordis `Config`
 * schema ({@link SidebarqaPrefsSchema}, re-exported as `Config` by
 * `src/index.ts`) — that is the shape DSH ≥ `0.1.7-alpha.1` derives its
 * editable form from, addresses by PROFILE ENTRY ID, and writes into the
 * profile patch. Every field is `volatile()`, so the running plugin reads the
 * value the last write committed through the refs the runtime hands `apply`
 * (see `src/live-config.ts`) instead of being remounted per edit.
 *
 * On a host that still offers runtime namespace registration
 * (`dsh-settings` ≤ `0.1.6`, i.e. below this package's declared floor) the SAME
 * schema is registered under {@link SIDEBARQA_SETTINGS_NS} and the plugin reads
 * that namespace instead. Deployments with no settings service at all — and
 * every failure of either seam — fall back to {@link SIDEBARQA_DEFAULTS}.
 *
 * Schemastery comes from `@deepseek-ai/schemastery`: `volatile()` exists only in
 * that fork (the npm `schemastery` line stops at `3.18.0`), and the host reads
 * nothing but the schema's `meta` / `dict` / `toJSON()` output, so the copy is
 * bundled into `lib/index.js` (`tsdown.config.ts`) and can never drift.
 */
import z from '@deepseek-ai/schemastery'

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

/**
 * The plugin's `Config` schema: every knob declared ONCE, volatile.
 *
 * `volatile()` per field (not on the root object) is the documented shape
 * (`docs/cookbook/adding-a-settings-card.md`): the runtime hands `apply` one
 * stable ref per field, updates those refs in place when a write lands, and
 * the host's `volatileForm` projection exposes exactly these fields.
 *
 * Fields keep their `default(...)`, so an entry with no config — a fresh
 * install, or the bundle patch's bare `insert` row — resolves to
 * {@link SIDEBARQA_DEFAULTS} without the plugin doing any merging of its own.
 */
export const SidebarqaPrefsSchema = z.object({
  historyStrategy: z.union(['inherit', 'compressed', 'trim']).default(SIDEBARQA_DEFAULTS.historyStrategy).volatile(),
  trimWindowMessages: z.number().step(1).min(1).max(256).default(SIDEBARQA_DEFAULTS.trimWindowMessages).volatile(),
  summarizeProvider: z.string().default(SIDEBARQA_DEFAULTS.summarizeProvider).volatile(),
  summarizeModel: z.string().default(SIDEBARQA_DEFAULTS.summarizeModel).volatile(),
  summarizeReasoningEffort: z.union(['off', 'high', 'max']).default(SIDEBARQA_DEFAULTS.summarizeReasoningEffort).volatile(),
  summarizeBudgetTokens: z.number().step(1).min(64).max(8192).default(SIDEBARQA_DEFAULTS.summarizeBudgetTokens).volatile(),
  recentWindowMessages: z.number().step(1).min(1).max(64).default(SIDEBARQA_DEFAULTS.recentWindowMessages).volatile(),
  backgroundWindowMessages: z.number().step(1).min(1).max(256).default(SIDEBARQA_DEFAULTS.backgroundWindowMessages).volatile(),
  answerProvider: z.string().default(SIDEBARQA_DEFAULTS.answerProvider).volatile(),
  answerModel: z.string().default(SIDEBARQA_DEFAULTS.answerModel).volatile(),
  answerReasoningEffort: z.union(['off', 'high', 'max']).default(SIDEBARQA_DEFAULTS.answerReasoningEffort).volatile(),
  titleBudgetTokens: z.number().step(1).min(16).max(256).default(SIDEBARQA_DEFAULTS.titleBudgetTokens).volatile(),
})

/**
 * One live config reference (mirror of the runtime's `Volatile<T>`):
 * `get()` returns the current immutable snapshot. Captured ONCE at apply time
 * and read per operation — the reference identity never changes, only its
 * value does.
 *
 * Upstream: `vendor/cosmokit/src/volatile.ts` (`interface Volatile<T>`); the
 * DSH fork of schemastery creates these for `.volatile()` fields
 * (`vendor/schemastery/src/index.ts`: `schema.meta.volatile ? createVolatile(…)
 * : schema.meta.default`). Restated here for the same reason as every other
 * mirror in `context-types.ts`: a third-party bundle cannot resolve the DSH
 * monorepo's own types.
 */
export interface SidebarqaConfigRef<T> {
  get(): T
}

/** The config object the runtime hands a plugin whose `Config` declares volatile fields. */
export type SidebarqaLiveConfig = {
  [K in keyof SidebarqaConfig]: SidebarqaConfigRef<SidebarqaConfig[K]>
}
