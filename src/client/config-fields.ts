/**
 * Declarative model of the webview config panel rows (pure, zero deps, testable).
 * The panel edits the host's `sidebarqa` namespace through the revision-guarded
 * /sidebarqa/api config routes; this module only describes the field surface and
 * the number coercion, so it stays free of React and the fetch layer.
 */
import type { SidebarqaConfigView } from './api.ts'
import type { SidebarqaLlmModel, SidebarqaCatalogProvider } from '../context-types.ts'

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

/** Label of the summarize channel's "inherit the asked session" option. */
export const CATALOG_INHERIT_LABEL = '继承被追问会话'

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

/** The three history strategies shown as a dropdown (mirror of the host union). */
export const HISTORY_STRATEGY_OPTIONS: readonly ConfigFieldOption[] = [
  { value: 'inherit', label: '全量继承' },
  { value: 'compressed', label: '压缩对话' },
  { value: 'trim', label: '机械裁切' },
]

/** The config panel's editable rows, in display order. Only the knobs users
 *  plausibly tune are surfaced; the compression internals (summary budget,
 *  window sizes, title budget) keep their defaults and stay settable through
 *  the `sidebarqa` settings namespace in settings.yaml. */
export const CONFIG_FIELDS: readonly ConfigField[] = [
  { key: 'historyStrategy', label: '上下文策略', type: 'select', options: HISTORY_STRATEGY_OPTIONS, desc: '追问如何继承主对话上下文：全量（fork+缓存命中）/ 压缩 / 机械裁切' },
  { key: 'trimWindowMessages', label: '裁切保留条数', type: 'number', min: 1, max: 256, desc: '机械裁切模式保留的最近消息条数（1–256）' },
  { key: 'answerProvider', label: '回答模型渠道', type: 'catalog', source: 'answerProvider', desc: '子对话回答模型的 provider（从已配置渠道中选择）' },
  { key: 'answerModel', label: '回答模型', type: 'catalog', source: 'answerModel', desc: '子对话回答模型的 id（随所选渠道切换）' },
  { key: 'answerReasoningEffort', label: '回答思考模式', type: 'select', options: REASONING_EFFORT_OPTIONS, desc: 'Off 关闭思考；High / Max 逐级增强推理' },
  { key: 'summarizeProvider', label: '摘要模型渠道', type: 'catalog', source: 'summarizeProvider', desc: '快速无思考摘要/标题模型的 provider（空 = 继承被追问会话）' },
  { key: 'summarizeModel', label: '摘要模型', type: 'catalog', source: 'summarizeModel', desc: '快速无思考模型的 id（随所选渠道切换）' },
  { key: 'summarizeReasoningEffort', label: '摘要思考模式', type: 'select', options: REASONING_EFFORT_OPTIONS, desc: 'Off 关闭思考；High / Max 逐级增强推理' },
]

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
    return [{ value: CATALOG_INHERIT_VALUE, label: CATALOG_INHERIT_LABEL }, ...rows]
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
  // Empty provider = the sentence "inherit the asked session's channel": the
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
