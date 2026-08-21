/**
 * Declarative model of the webview config panel rows (pure and testable; its
 * only import is the dependency-free copy dictionary).
 * The panel edits the host's `sidebarqa` namespace through the revision-guarded
 * /sidebarqa/api config routes; this module only describes the field surface and
 * the number coercion, so it stays free of React and the fetch layer.
 *
 * The row tables are FUNCTIONS, not consts: module-level tables would freeze
 * their labels at import time and never follow a DSH language switch.
 */
import type { SidebarqaConfigView } from './api.ts'
import type { SidebarqaLlmModel, SidebarqaCatalogProvider } from '../context-types.ts'
import { t } from './locales.ts'

/** One editable config key. */
export type ConfigFieldKey = keyof SidebarqaConfigView

/** One config panel row control type. */
export type ConfigFieldType = 'text' | 'number' | 'select' | 'catalog'

/** One choice of a select row. */
export interface ConfigFieldOption {
  value: string
  label: string
}

/** What a `catalog` row draws its options from. */
export type CatalogFieldSource = 'answerProvider' | 'answerModel' | 'summarizeProvider' | 'summarizeModel'

/** The inherit sentinel stored for the summarize channel: '' (follow the asked session). */
export const CATALOG_INHERIT_VALUE = ''

/** One config panel row: a text field, a clamped number field, a select, or a
 *  provider/model dropdown sourced from the live model catalog. */
export interface ConfigField {
  key: ConfigFieldKey
  label: string
  type: ConfigFieldType
  /** Clamp bounds for number fields (mirror of the schemastery schema). */
  min?: number
  max?: number
  /** Input placeholder (text fields). */
  placeholder?: string
  /** One-line description under the label. */
  desc?: string
  /** Choices for select fields. */
  options?: readonly ConfigFieldOption[]
  /**
   * For `type: 'catalog'` rows, the role this row plays. A provider row names
   * the provider it lists; a model row names the provider whose `…Model`
   * options it is scoped by.
   */
  source?: CatalogFieldSource
}

/** DSH reasoning-effort vocabulary (mirror of the host `off | high | max`). */
export type SidebarqaReasoningEffort = 'off' | 'high' | 'max'

/** The three thinking modes shown as a dropdown. */
export const REASONING_EFFORT_OPTIONS: readonly ConfigFieldOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]

/** The three history strategies shown as a dropdown (mirror of the host union).
 *  A FUNCTION, not a const: a module-level table would freeze its labels at
 *  import time and never follow a locale switch. The `value`s are the persisted
 *  protocol keys and never change. */
export function historyStrategyOptions(): readonly ConfigFieldOption[] {
  return [
    { value: 'inherit', label: t('strategyInherit') },
    { value: 'compressed', label: t('strategyCompressed') },
    { value: 'trim', label: t('strategyTrim') },
  ]
}

/** The config panel's editable rows, in display order. Only the knobs users
 *  plausibly tune are surfaced; the compression internals (summary budget,
 *  window sizes, title budget) keep their defaults and stay settable through
 *  the `sidebarqa` settings namespace in settings.yaml.
 *
 *  A FUNCTION for the same reason as {@link historyStrategyOptions}: the copy
 *  is resolved per call, so the panel re-localizes on a language switch. */
export function configFields(): readonly ConfigField[] {
  return [
    { key: 'historyStrategy', label: t('cfgHistoryStrategyLabel'), type: 'select', options: historyStrategyOptions(), desc: t('cfgHistoryStrategyDesc') },
    { key: 'trimWindowMessages', label: t('cfgTrimWindowLabel'), type: 'number', min: 1, max: 256, desc: t('cfgTrimWindowDesc') },
    { key: 'answerProvider', label: t('cfgAnswerProviderLabel'), type: 'catalog', source: 'answerProvider', desc: t('cfgAnswerProviderDesc') },
    { key: 'answerModel', label: t('cfgAnswerModelLabel'), type: 'catalog', source: 'answerModel', desc: t('cfgAnswerModelDesc') },
    { key: 'answerReasoningEffort', label: t('cfgAnswerEffortLabel'), type: 'select', options: REASONING_EFFORT_OPTIONS, desc: t('cfgEffortDesc') },
    { key: 'summarizeProvider', label: t('cfgSummarizeProviderLabel'), type: 'catalog', source: 'summarizeProvider', desc: t('cfgSummarizeProviderDesc') },
    { key: 'summarizeModel', label: t('cfgSummarizeModelLabel'), type: 'catalog', source: 'summarizeModel', desc: t('cfgSummarizeModelDesc') },
    { key: 'summarizeReasoningEffort', label: t('cfgSummarizeEffortLabel'), type: 'select', options: REASONING_EFFORT_OPTIONS, desc: t('cfgEffortDesc') },
  ]
}

/**
 * Parse + clamp one number row's raw input. A non-finite input returns null so
 * the row can revert to the stored value (mirror of the host rows' behavior).
 */
export function coerceNumberField(raw: string, min?: number, max?: number): number | null {
  // An emptied number row is "no value", not 0 — revert to the stored value.
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  let clamped = Math.round(parsed)
  if (min !== undefined && clamped < min) clamped = min
  if (max !== undefined && clamped > max) clamped = max
  return clamped
}

/**
 * The provider catalog row's choices, in provider order. The summarize channel
 * prepends its "inherit the asked session" sentinel (empty value) so the
 * default `''` stays selectable from the dropdown.
 * @param catalog - the live model catalog.
 * @param source - the row's role; only `summarizeProvider` gets the inherit entry.
 */
export function providerOptionsOf(
  catalog: readonly SidebarqaCatalogProvider[],
  source: string,
): ConfigFieldOption[] {
  const rows = catalog.map(provider => ({ value: provider.provider, label: provider.displayName }))
  if (source === 'summarizeProvider') {
    return [{ value: CATALOG_INHERIT_VALUE, label: t('cfgCatalogInherit') }, ...rows]
  }
  return rows
}

/**
 * The model catalog row's choices for one provider route: that provider's
 * catalog models, or [] while the provider is unknown/unchosen.
 */
export function modelOptionsOf(
  catalog: readonly SidebarqaCatalogProvider[],
  provider: string,
): ConfigFieldOption[] {
  if (provider !== '') {
    const match = catalog.find(candidate => candidate.provider === provider)
    if (match === undefined) return []
    return match.models.map((model: SidebarqaLlmModel) => ({ value: model.id, label: model.name }))
  }
  // Empty provider = the sentinel "inherit the asked session's channel": the
  // model id is picked from ANY configured channel, so offer the union of all
  // catalog models (deduplicated by id, first channel wins the label).
  const seen = new Set<string>()
  const rows: ConfigFieldOption[] = []
  for (const group of catalog) {
    for (const model of group.models) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      rows.push({ value: model.id, label: model.name })
    }
  }
  return rows
}
