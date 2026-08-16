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
  { value: 'off', label: 'Off（关闭思考）' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]

/** The config panel's editable rows, in display order. */
export const CONFIG_FIELDS: readonly ConfigField[] = [
  { key: 'answerProvider', label: '回答模型渠道', type: 'text', desc: '子对话回答模型的 provider' },
  { key: 'answerModel', label: '回答模型', type: 'text', desc: '子对话回答模型的 id' },
  { key: 'answerReasoningEffort', label: '回答思考模式', type: 'select', options: REASONING_EFFORT_OPTIONS, desc: 'Off 关闭思考；High / Max 逐级增强推理' },
  { key: 'summarizeProvider', label: '摘要模型渠道', type: 'text', placeholder: '留空 = 继承被追问会话', desc: '快速无思考摘要/标题模型的 provider' },
  { key: 'summarizeModel', label: '摘要模型', type: 'text', desc: '快速无思考模型的 id' },
  { key: 'summarizeReasoningEffort', label: '摘要思考模式', type: 'select', options: REASONING_EFFORT_OPTIONS, desc: 'Off 关闭思考；High / Max 逐级增强推理' },
  { key: 'summarizeBudgetTokens', label: '摘要预算', type: 'number', min: 64, max: 8192, desc: '背景摘要输出 token 上限（64–8192）' },
  { key: 'recentWindowMessages', label: '近期保留条数', type: 'number', min: 1, max: 64, desc: '近原文不压缩、原样保留的消息条数（1–64）' },
  { key: 'backgroundWindowMessages', label: '背景压缩条数', type: 'number', min: 1, max: 256, desc: '交给模型压缩的较早消息条数（1–256）' },
  { key: 'titleBudgetTokens', label: '标题预算', type: 'number', min: 16, max: 256, desc: '回答完成后重命名标题的输出 token 上限（16–256）' },
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
