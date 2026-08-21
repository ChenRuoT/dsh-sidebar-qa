/**
 * The plugin's zh/en copy dictionary and the module-level `t()` it resolves
 * through. ZERO imports by design: every pure module and every component may
 * read copy from here without dragging a dependency (and without tripping the
 * client-bundle purity gate).
 *
 * The active language follows the DSH locale service (`ctx.locale`, attached by
 * the client `apply()`): the Host-backed preference (`locale.preference` in
 * settings.yaml) wins over the browser language, exactly like every first-party
 * DSH surface. Without the service — a build without the locale plugin, or a
 * unit test — `activeLocaleId()` degrades to `navigator.language`, then `'en'`.
 *
 * `zh` is the key-set source of truth; `en` is typed as `Record<CopyKey, string>`,
 * so a missing translation is a COMPILE error, and `tests/locales.spec.ts`
 * additionally pins key parity and rejects empty values at runtime.
 *
 * This dictionary holds UI copy only. Model-facing prompt text lives in
 * `src/prompt-locale.ts` — it is protocol (markers the prompts name and the
 * transcript parser reads back), not translatable chrome, and must never be
 * mixed in here.
 */

/** Namespace this plugin's dictionaries register under in the DSH locale
 *  registry. `sidebar` is DSH's own ui-sidebar and `betterSidebar` is the
 *  framework's, so neither is available. */
export const LOCALE_NS = 'sidebarQa'

/** Chinese copy — the key-set source of truth. */
export const zh = {
  // ── Shared vocabulary ─────────────────────────────────────────────────────
  commonCancel: '取消',
  commonRetry: '重试',
  commonRemove: '移除',
  commonLoading: '加载中…',
  commonCopy: '复制',
  commonCopied: '已复制',
  commonDefault: '默认',

  // ── 追问 tab (AskPanel) + the selection popover ───────────────────────────
  askTabTitle: '追问',
  askPopoverButton: '提问',
  askNewAsk: '新追问',
  askQuoteHead: '引文',
  askNoQuoteHint: '未选择文本，可直接提问（仅不带引文）。',
  askEmptyHint: '划选对话文本后点击「提问」，或直接输入问题。',
  askPreparing: '准备追问会话…',
  askComposerPlaceholder: '继续追问…（Enter 发送，Shift+Enter 换行）',
  askSend: '发送',
  askGenerating: '生成中…',
  askSeedDivider: '↑ 上方为主对话历史',
  askSeedDividerMore: '↑ 上方为主对话历史，继续向上滚动加载',
  askDegradedToCompressed: '主对话正在回答中，已改用「压缩」模式，稍后可在主对话空闲时再试「全量继承」。',

  // ── 追问记录 tab (HistoryPanel) ───────────────────────────────────────────
  histTabTitle: '追问记录',
  histEmptyAll: '还没有追问记录。在对话中划选文本并点击「提问」即可生成。',
  histEmptyWorkspace: '当前工作区暂无追问记录。在对话中划选文本并点击「提问」即可生成。',
  histWorkspace: '当前工作区：{name}',
  histArchived: '已归档',
  histDeleted: '已删除',
  histRemoveTitle: '从追问记录移除（不影响 DSH 侧会话）',
  histExpand: '展开追问',
  histCollapse: '折叠追问',

  // ── Model seat (ModelSelect + model-seat) ─────────────────────────────────
  modelFallbackLabel: '模型',
  modelTrigger: '模型：{label}',
  modelMenuLabel: '模型选择',
  modelCellModel: '模型',
  modelCellEffort: '推理强度',
  modelProviderDefault: '跟随提供方默认',
  modelLoadFailed: '加载失败',
  modelFailureDetail: '{name}：{message}',
  modelEmpty: '未加载到可用模型',
  modelNoEfforts: '当前模型没有可选的推理强度',
  modelInheritSeatHint: '全量继承沿用主对话模型（保前缀缓存），如需换模型请改用压缩/裁切',

  // ── History strategy (StrategySelect + the config row's options) ──────────
  strategyInherit: '全量继承',
  strategyCompressed: '压缩对话',
  strategyTrim: '机械裁切',
  strategyAria: '上下文策略：{label}',

  // ── Config panel (ConfigPanel + config-fields) ────────────────────────────
  cfgLoading: '加载配置…',
  cfgCatalogInherit: '继承被追问会话',
  cfgHistoryStrategyLabel: '上下文策略',
  cfgHistoryStrategyDesc: '追问如何继承主对话上下文：全量（fork+缓存命中）/ 压缩 / 机械裁切',
  cfgTrimWindowLabel: '裁切保留条数',
  cfgTrimWindowDesc: '机械裁切模式保留的最近消息条数（1–256）',
  cfgAnswerProviderLabel: '回答模型渠道',
  cfgAnswerProviderDesc: '子对话回答模型的 provider（从已配置渠道中选择）',
  cfgAnswerModelLabel: '回答模型',
  cfgAnswerModelDesc: '子对话回答模型的 id（随所选渠道切换）',
  cfgAnswerEffortLabel: '回答思考模式',
  cfgSummarizeProviderLabel: '摘要模型渠道',
  cfgSummarizeProviderDesc: '快速无思考摘要/标题模型的 provider（空 = 继承被追问会话）',
  cfgSummarizeModelLabel: '摘要模型',
  cfgSummarizeModelDesc: '快速无思考模型的 id（随所选渠道切换）',
  cfgSummarizeEffortLabel: '摘要思考模式',
  cfgEffortDesc: 'Off 关闭思考；High / Max 逐级增强推理',

  // ── Context meter ─────────────────────────────────────────────────────────
  meterSystem: '系统提示词',
  meterTools: '工具',
  meterMessages: '对话消息',
  meterUsed: '上下文已用 {reading}',
  meterHeadline: '上下文已用',
  meterPanelLabel: '上下文占用',

  // ── Compact relative time (history rows) ──────────────────────────────────
  // en uses unit abbreviations, which sidesteps plural forms entirely and fits
  // the row chip better than "5 minutes" would.
  timeNow: '刚刚',
  timeMinutes: '{n}分钟',
  timeHours: '{n}小时',
  timeDays: '{n}天',
  timeMonths: '{n}个月',
  timeYears: '{n}年',

  // ── Error framing (localized prefix + the raw English detail) ─────────────
  errSaveFailed: '保存失败：{detail}',
  errSaveConflict: '保存失败：配置已在其他窗口被修改，请重试',
  errAskFailed: '追问失败：{detail}',
  errModelFailed: '模型加载失败：{detail}',
}

/** Every copy key (the `zh` key set is authoritative). */
export type CopyKey = keyof typeof zh

/** English copy. The annotation makes a missing key a compile error. */
export const en: Record<CopyKey, string> = {
  commonCancel: 'Cancel',
  commonRetry: 'Retry',
  commonRemove: 'Remove',
  commonLoading: 'Loading…',
  commonCopy: 'Copy',
  commonCopied: 'Copied',
  commonDefault: 'Default',

  askTabTitle: 'Follow-up',
  askPopoverButton: 'Ask',
  askNewAsk: 'New follow-up',
  askQuoteHead: 'Quote',
  askNoQuoteHint: 'No text selected — you can still ask without a quote.',
  askEmptyHint: 'Select text in the conversation and click "Ask", or just type a question.',
  askPreparing: 'Preparing the follow-up session…',
  askComposerPlaceholder: 'Ask a follow-up… (Enter to send, Shift+Enter for a new line)',
  askSend: 'Send',
  askGenerating: 'Generating…',
  askSeedDivider: '↑ Inherited main-conversation history',
  askSeedDividerMore: '↑ Inherited main-conversation history — scroll up to load more',
  askDegradedToCompressed: 'The main conversation is still answering, so "Compressed" was used instead. Try "Inherit full history" again once it is idle.',

  histTabTitle: 'Follow-ups',
  histEmptyAll: 'No follow-ups yet. Select text in a conversation and click "Ask" to create one.',
  histEmptyWorkspace: 'No follow-ups in this workspace yet. Select text in a conversation and click "Ask" to create one.',
  histWorkspace: 'Workspace: {name}',
  histArchived: 'Archived',
  histDeleted: 'Deleted',
  histRemoveTitle: 'Remove from the follow-up records (the DSH session itself is untouched)',
  histExpand: 'Expand follow-ups',
  histCollapse: 'Collapse follow-ups',

  modelFallbackLabel: 'Model',
  modelTrigger: 'Model: {label}',
  modelMenuLabel: 'Model selection',
  modelCellModel: 'Model',
  modelCellEffort: 'Reasoning effort',
  modelProviderDefault: 'Provider default',
  modelLoadFailed: 'failed to load',
  modelFailureDetail: '{name}: {message}',
  modelEmpty: 'No models available',
  modelNoEfforts: 'This model has no selectable reasoning effort',
  modelInheritSeatHint: 'Inherit keeps the main conversation’s model (that is what preserves the prefix cache); switch to Compressed or Trim to pick another model',

  strategyInherit: 'Inherit full history',
  strategyCompressed: 'Compressed',
  strategyTrim: 'Trim',
  strategyAria: 'Context strategy: {label}',

  cfgLoading: 'Loading settings…',
  cfgCatalogInherit: 'Inherit from the asked session',
  cfgHistoryStrategyLabel: 'Context strategy',
  cfgHistoryStrategyDesc: 'How a follow-up inherits the main conversation: full history (fork + prefix-cache hit) / compressed / trimmed',
  cfgTrimWindowLabel: 'Trim window',
  cfgTrimWindowDesc: 'How many recent messages the trim strategy keeps verbatim (1–256)',
  cfgAnswerProviderLabel: 'Answer channel',
  cfgAnswerProviderDesc: 'Provider route for the follow-up’s answer model (pick a configured channel)',
  cfgAnswerModelLabel: 'Answer model',
  cfgAnswerModelDesc: 'Model id for the follow-up’s answers (follows the chosen channel)',
  cfgAnswerEffortLabel: 'Answer thinking mode',
  cfgSummarizeProviderLabel: 'Summary channel',
  cfgSummarizeProviderDesc: 'Provider of the fast no-thinking summary/title model (empty = inherit the asked session)',
  cfgSummarizeModelLabel: 'Summary model',
  cfgSummarizeModelDesc: 'Model id of the fast no-thinking model (follows the chosen channel)',
  cfgSummarizeEffortLabel: 'Summary thinking mode',
  cfgEffortDesc: 'Off disables thinking; High / Max deepen reasoning step by step',

  meterSystem: 'System prompt',
  meterTools: 'Tools',
  meterMessages: 'Messages',
  meterUsed: 'Context used {reading}',
  meterHeadline: 'Context used',
  meterPanelLabel: 'Context usage',

  timeNow: 'now',
  timeMinutes: '{n}m',
  timeHours: '{n}h',
  timeDays: '{n}d',
  timeMonths: '{n}mo',
  timeYears: '{n}y',

  errSaveFailed: 'Save failed: {detail}',
  errSaveConflict: 'Save failed: the settings were changed in another window — please retry',
  errAskFailed: 'Ask failed: {detail}',
  errModelFailed: 'Model load failed: {detail}',
}

/** The slice of the DSH locale service this module reads (structural). */
interface AttachedLocale {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
}

/**
 * The attached DSH locale service, or undefined before `apply()` runs and after
 * disposal. This is the one deliberate module-level mutable in a package whose
 * rule is "no module-level singletons, use createXxx factories": `t()` is
 * called from 20+ modules and from pure functions that receive no context, so
 * the active language has to be ambient.
 */
let localeService: AttachedLocale | undefined

/**
 * Attach (or, with `undefined`, detach) the DSH locale service.
 * @param service - `ctx.locale`, or undefined to fall back to the browser language.
 */
export function attachLocale(service: AttachedLocale | undefined): void {
  localeService = service
}

/**
 * The active locale id.
 *
 * MUST return a stable primitive: it backs `useSyncExternalStore` through
 * `useLocaleRevision`, and returning a fresh object per call (e.g. the whole
 * `getSnapshot()`) would make React re-render forever.
 */
export function activeLocaleId(): string {
  const active = localeService?.getSnapshot().active
  if (active !== undefined && active !== '') return active
  const browser = typeof navigator !== 'undefined' ? navigator.language : undefined
  return browser === undefined || browser === '' ? 'en' : browser
}

/**
 * Subscribe to locale switches. Without an attached service the copy can never
 * change, so this is an inert disposer rather than an error.
 * @param fn - called after every locale change.
 * @returns the unsubscribe disposer.
 */
export function subscribeLocale(fn: () => void): () => void {
  return localeService?.subscribe(fn) ?? (() => {})
}

/** Whether the active locale is Chinese (the dictionary choice is binary). */
export function isZh(): boolean {
  return activeLocaleId().toLowerCase().startsWith('zh')
}

/**
 * The model-facing prompt locale for the active language — the wire value sent
 * to the host's context/title routes (see `src/prompt-locale.ts`).
 */
export function promptLocale(): 'zh' | 'en' {
  return isZh() ? 'zh' : 'en'
}

/**
 * Translate one copy key, interpolating `{name}` placeholders.
 * @param key - a key of the `zh` dictionary.
 * @param params - placeholder values, substituted by name.
 */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict = isZh() ? zh : en
  let text: string = dict[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
