/**
 * Declarative model of the webview config panel rows (pure, zero deps, testable).
 * The panel edits the host's `sidebarqa` namespace through the revision-guarded
 * /sidebarqa/api config routes; this module only describes the field surface and
 * the number coercion, so it stays free of React and the fetch layer.
 */
import type { SidebarqaConfigView } from './api.ts'

/** One editable config key. */
export type ConfigFieldKey = keyof SidebarqaConfigView

/** One config panel row control type. */
export type ConfigFieldType = 'text' | 'number' | 'select'

/** One choice of a select row. */
export interface ConfigFieldOption {
  value: string
  label: string
}

/** One config panel row: a text field, a clamped number field, or a select. */
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
  { key: 'answerProvider', label: '回答模型渠道', type: 'text', desc: '子对话回答模型的 provider' },
  { key: 'answerModel', label: '回答模型', type: 'text', desc: '子对话回答模型的 id' },
  { key: 'answerReasoningEffort', label: '回答思考模式', type: 'select', options: REASONING_EFFORT_OPTIONS, desc: 'Off 关闭思考；High / Max 逐级增强推理' },
  { key: 'summarizeProvider', label: '摘要模型渠道', type: 'text', placeholder: '留空 = 继承被追问会话', desc: '快速无思考摘要/标题模型的 provider' },
  { key: 'summarizeModel', label: '摘要模型', type: 'text', desc: '快速无思考模型的 id' },
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
