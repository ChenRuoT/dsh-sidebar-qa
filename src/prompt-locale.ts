/**
 * The MODEL-FACING text of the plugin, in zh and en — the follow-up intro, the
 * background-compression and title system prompts, and the structural markers
 * those prompts name (`用户：` / `助手：`, `【背景】`, `问题：`).
 *
 * This is deliberately NOT part of `client/locales.ts`:
 *
 * - it is protocol, not chrome. `backgroundSystem` literally names the role
 *   prefixes `formatSegments` emits, so a bundle is an ATOMIC unit — translate
 *   the prompt without its markers and the model loses its parsing contract
 *   (`tests/prompt-locale.spec.ts` asserts the pairing);
 * - it is SHARED by both halves (the host builds the summary and title prompts,
 *   the client builds the first message), so it must stay free of node-only
 *   APIs and of any import at all;
 * - it is never registered into the DSH locale registry — publishing it there
 *   would invite "translating" a marker the transcript parser reads back.
 *
 * OUTPUT LANGUAGE. The prompts do not bind the answer to the UI language: they
 * tell the model to answer in the language of the QUESTION (falling back to the
 * quoted text), mirroring DSH's own session titler. A zh-UI user quoting an
 * English paper should get an English answer, and vice versa.
 *
 * BACK-COMPAT. `PROMPTS.zh` is a byte-for-byte move of the pre-i18n strings, and
 * `promptLocaleOf` defaults an absent locale to `'zh'` — an old client calling a
 * new host produces exactly today's prompts.
 */

/** The two languages the model-facing text exists in (mirror of DSH's LocaleId). */
export type PromptLocale = 'zh' | 'en'

/**
 * Normalize a wire value to a prompt locale.
 *
 * ABSENT → `'zh'`: this is the back-compat contract with clients that predate
 * the `locale` field. Any unknown language falls to `'en'`; never throws.
 * @param raw - the payload's `locale` field, unvalidated.
 */
export function promptLocaleOf(raw: unknown): PromptLocale {
  if (typeof raw !== 'string' || raw === '') return 'zh'
  return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** One language's complete model-facing text. */
export interface PromptBundle {
  // ── Host: context compression (summarize.ts) ──────────────────────────────
  /** System prompt of the background compression pass. */
  backgroundSystem: string
  /** Role prefix `formatSegments` emits, separator included — NAMED verbatim
   *  by `backgroundSystem`, so the two must always be translated together. */
  roleUser: string
  /** Role prefix `formatSegments` emits — NAMED by `backgroundSystem`. */
  roleAssistant: string
  /** Section marker of the compressed background. */
  sectionBackground: string
  /** Section marker of the verbatim recent window. */
  sectionRecent: string

  // ── Host: post-answer retitle (title.ts) ──────────────────────────────────
  /** System prompt of the title pass. */
  titleSystem: string
  /** Question label of the title input (client-emitted, host-consumed). */
  titleQuestionLabel: string
  /** Answer label of the title input. */
  titleAnswerLabel: string

  // ── Client: first-message injection (injection.ts) ────────────────────────
  /** The governing instruction opening the side session's first message. */
  followUpIntro: string
  /** Heading of the injected main-conversation context block. */
  contextHeading: string
  /** Label prefixing the user's question — see {@link QUESTION_LABELS}. */
  questionLabel: string
  /** `<quoted_context label>` value for a quote taken from a user message. */
  quoteLabelUser: string
  /** `<quoted_context label>` value for a quote taken from an agent reply. */
  quoteLabelAgent: string
  /** Placeholder topic when the quote has no usable first line. */
  fallbackTopic: string
}

/**
 * Every question marker this plugin has EVER emitted.
 *
 * APPEND-ONLY: never reorder, never remove. These messages are persisted in the
 * DSH session log and re-parsed on every panel render, so a marker dropped here
 * would make historical follow-ups display a bare `问题：` prefix forever.
 * `tests/prompt-locale.spec.ts` pins that every bundle's `questionLabel` is a
 * member of this list, so a new language cannot be added without teaching the
 * parser about it.
 */
export const QUESTION_LABELS: readonly string[] = ['问题：', 'Question: ']

/** The model-facing text, per language. */
export const PROMPTS: Record<PromptLocale, PromptBundle> = {
  zh: {
    backgroundSystem: [
      '你是对话上下文压缩助手。下面是主对话【较早部分】的原文，按时间从新到旧排列（第一条是最新状态，每条以「用户：」或「助手：」开头）。',
      '请用最多 3 句话概括，依次是：会话目标（在做什么）、当前进度（最新状态/最近完成了什么）、未决事项（没有就省略这一句）。',
      '要求：极简、只陈述事实、禁止列清单、禁止复述指令、禁止编造；早期指令若已被后续执行，视为已完成，不要当作未决事项。',
    ].join('\n'),
    roleUser: '用户：',
    roleAssistant: '助手：',
    sectionBackground: '【背景】',
    sectionRecent: '【近期对话】',

    titleSystem: [
      '你是会话标题生成助手：根据下面的「问题 + 回答」提炼一个极简标题。',
      '严格只输出标题本身，遵守：',
      '1. 纯文本单行，禁止引号、Markdown、XML、解释、前后缀、换行或终端控制码；',
      '2. 使用问题与回答的语言；',
      '3. 不超过 15 个汉字（非中文语言约 6 个词以内）；',
      '4. 直接给主题短语，不要开场白、自我陈述或任务复述。',
    ].join('\n'),
    titleQuestionLabel: '问题：',
    titleAnswerLabel: '回答：',

    followUpIntro: [
      '这是一次「侧边栏追问」：用户对主对话里划选的一段文本提问。',
      '请识别用户意图，只围绕这段划选文本的主题直接、简明地回答（必要时先做概念澄清），不要复述上下文、也不要过度联系主对话的整体主题。',
      '输出要求：第一句就进入回答正文，禁止任何开场白、自我陈述或任务复述（如"我来回答…""这个问题是关于…""直接介绍即可"之类的话一律不写）。',
      '用与「用户的问题」相同的语言作答；问题的语言不明确时，跟随划选文本的语言。',
      '下面依次是参考上下文：',
      '1. 主对话整体主题',
      '2. 主对话最近几轮对话',
      '3. 用户划选的文本（见 <quoted_context> 块）',
      '4. 用户的问题',
    ].join('\n'),
    contextHeading: '【主对话上下文】',
    questionLabel: '问题：',
    quoteLabelUser: '用户消息',
    quoteLabelAgent: 'Agent 回复',
    fallbackTopic: '追问',
  },

  en: {
    backgroundSystem: [
      'You compress conversation context. Below is the verbatim EARLIER part of a main conversation, ordered newest first (the first entry is the latest state; each entry starts with "User:" or "Assistant:").',
      'Summarize it in at most 3 sentences, in this order: the goal of the session (what is being done), the current progress (latest state / what was just finished), and open items (omit this sentence if there are none).',
      'Requirements: be minimal, state facts only, no bullet lists, no restating instructions, no invention; an early instruction that later work already carried out counts as done and must not be reported as an open item.',
    ].join('\n'),
    roleUser: 'User: ',
    roleAssistant: 'Assistant: ',
    sectionBackground: '[Background]',
    sectionRecent: '[Recent]',

    titleSystem: [
      'You generate session titles: distill one minimal title from the "question + answer" below.',
      'Output the title and nothing else, obeying:',
      '1. plain text, single line — no quotes, Markdown, XML, explanation, prefix, suffix, newline or terminal control codes;',
      '2. use the language of the question and the answer;',
      '3. at most 6 words (about 15 characters for CJK);',
      '4. give the topic phrase directly — no preamble, self-description or task restatement.',
    ].join('\n'),
    titleQuestionLabel: 'Question: ',
    titleAnswerLabel: 'Answer: ',

    followUpIntro: [
      'This is a "sidebar follow-up": the user is asking about a passage they selected in the main conversation.',
      'Identify their intent and answer the topic of that selected passage directly and concisely (clarify the concept first when that is needed). Do not restate the context, and do not over-connect the answer to the main conversation\'s overall theme.',
      'Output: begin with the answer itself in the first sentence. No opening remarks, self-description or task restatement (never write things like "Let me answer…", "This question is about…", "Here is an introduction").',
      'Answer in the same language as the user\'s question; if that language is ambiguous, follow the language of the quoted text.',
      'The reference context follows, in order:',
      '1. the overall topic of the main conversation',
      '2. the most recent turns of the main conversation',
      '3. the passage the user selected (see the <quoted_context> block)',
      '4. the user\'s question',
    ].join('\n'),
    contextHeading: '[Main conversation context]',
    questionLabel: 'Question: ',
    quoteLabelUser: 'user message',
    quoteLabelAgent: 'agent reply',
    fallbackTopic: 'Follow-up',
  },
}

/**
 * One language's model-facing text.
 * @param locale - the resolved prompt locale (defaults to the pre-i18n zh).
 */
export function promptsOf(locale: PromptLocale = 'zh'): PromptBundle {
  return PROMPTS[locale]
}
