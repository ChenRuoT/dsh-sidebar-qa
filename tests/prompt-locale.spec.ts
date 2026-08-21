/**
 * The model-facing prompt bundles. Three things matter here and nothing else
 * really does:
 *
 * 1. BACK-COMPAT — an absent `locale` must resolve to zh, so a client that
 *    predates the field gets byte-identical prompts from a new host;
 * 2. ATOMICITY — every prompt that NAMES a structural marker must actually
 *    contain the marker its formatter emits;
 * 3. the append-only question-marker registry, which is what keeps messages
 *    already written into DSH session logs parseable forever.
 */
import { describe, expect, it } from 'vitest'
import {
  PROMPTS,
  promptLocaleOf,
  promptsOf,
  QUESTION_LABELS,
  type PromptLocale,
} from '../src/prompt-locale.ts'
import { BACKGROUND_SYSTEM, backgroundSystem, composeSummary, formatSegments } from '../src/summarize.ts'
import { buildTitleInput, TITLE_SYSTEM, titleSystem } from '../src/title.ts'

const LOCALES: readonly PromptLocale[] = ['zh', 'en']

describe('promptLocaleOf', () => {
  it('resolves an absent locale to zh — the back-compat contract', () => {
    // A client that predates the `locale` field must keep getting the exact
    // prompts it got before i18n. This is the single most important assertion
    // in this file.
    expect(promptLocaleOf(undefined)).toBe('zh')
    expect(promptLocaleOf('')).toBe('zh')
    expect(promptLocaleOf(null)).toBe('zh')
  })

  it('maps every zh tag to zh and everything else to en', () => {
    expect(promptLocaleOf('zh')).toBe('zh')
    expect(promptLocaleOf('zh-CN')).toBe('zh')
    expect(promptLocaleOf('ZH-Hans-CN')).toBe('zh')
    expect(promptLocaleOf('en')).toBe('en')
    expect(promptLocaleOf('en-GB')).toBe('en')
    expect(promptLocaleOf('fr-FR')).toBe('en')
  })

  it('never throws on a hostile payload', () => {
    for (const raw of [42, {}, [], true, Symbol('x')]) {
      expect(() => promptLocaleOf(raw)).not.toThrow()
      expect(promptLocaleOf(raw)).toBe('zh')
    }
  })
})

describe('bundle integrity', () => {
  it('keeps the zh and en key sets identical', () => {
    expect(Object.keys(PROMPTS.en).sort()).toEqual(Object.keys(PROMPTS.zh).sort())
  })

  it('has no empty values', () => {
    for (const locale of LOCALES) {
      const empty = Object.entries(PROMPTS[locale]).filter(([, value]) => value.trim() === '')
      expect({ locale, empty }).toEqual({ locale, empty: [] })
    }
  })

  it('defaults promptsOf to the pre-i18n zh bundle', () => {
    expect(promptsOf()).toBe(PROMPTS.zh)
  })
})

describe('prompt/marker atomicity', () => {
  it('names the role prefixes its formatter actually emits', () => {
    // backgroundSystem tells the model each entry starts with these prefixes.
    // Translate one without the other and the model loses its parsing contract.
    for (const locale of LOCALES) {
      const bundle = PROMPTS[locale]
      expect({ locale, ok: bundle.backgroundSystem.includes(bundle.roleUser.trim()) })
        .toEqual({ locale, ok: true })
      expect({ locale, ok: bundle.backgroundSystem.includes(bundle.roleAssistant.trim()) })
        .toEqual({ locale, ok: true })
    }
  })

  it('emits exactly those prefixes from formatSegments', () => {
    for (const locale of LOCALES) {
      const bundle = PROMPTS[locale]
      const out = formatSegments(
        [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }],
        100,
        locale,
      )
      expect(out).toBe(`${bundle.roleUser}q\n\n${bundle.roleAssistant}a`)
    }
  })

  it('frames the summary with the bundle section markers', () => {
    for (const locale of LOCALES) {
      const bundle = PROMPTS[locale]
      expect(composeSummary('B', 'R', locale))
        .toBe(`${bundle.sectionBackground}\nB\n\n${bundle.sectionRecent}\nR`)
    }
  })

  it('labels the title input with the labels titleSystem refers to', () => {
    for (const locale of LOCALES) {
      const bundle = PROMPTS[locale]
      expect(buildTitleInput('q', 'a', locale))
        .toBe(`${bundle.titleQuestionLabel}q\n${bundle.titleAnswerLabel}a`)
    }
  })
})

describe('the question-marker registry', () => {
  it('lists every marker any bundle emits', () => {
    // Adding a language without teaching the parser about its marker would
    // leave that language's messages displaying a bare label forever.
    for (const locale of LOCALES) {
      expect({ locale, listed: QUESTION_LABELS.includes(PROMPTS[locale].questionLabel) })
        .toEqual({ locale, listed: true })
    }
  })

  it('can never drop the original zh marker', () => {
    // Append-only: messages carrying it are already in DSH session logs.
    expect(QUESTION_LABELS).toContain('问题：')
  })

  it('has no marker that prefixes another (parse order stays irrelevant)', () => {
    for (const a of QUESTION_LABELS) {
      for (const b of QUESTION_LABELS) {
        if (a === b) continue
        expect({ a, b, prefixes: a.startsWith(b) }).toEqual({ a, b, prefixes: false })
      }
    }
  })
})

describe('zh output is unchanged from the pre-i18n constants', () => {
  it('pins the zh system prompts verbatim', () => {
    // Any "cleanup" of the zh prompts has to show up as a deliberate diff here.
    expect(backgroundSystem('zh')).toBe(BACKGROUND_SYSTEM)
    expect(titleSystem('zh')).toBe(TITLE_SYSTEM)
    expect(BACKGROUND_SYSTEM).toContain('你是对话上下文压缩助手。')
    expect(TITLE_SYSTEM).toContain('你是会话标题生成助手：')
  })

  it('pins the zh markers verbatim', () => {
    expect(PROMPTS.zh.roleUser).toBe('用户：')
    expect(PROMPTS.zh.roleAssistant).toBe('助手：')
    expect(PROMPTS.zh.sectionBackground).toBe('【背景】')
    expect(PROMPTS.zh.sectionRecent).toBe('【近期对话】')
    expect(PROMPTS.zh.contextHeading).toBe('【主对话上下文】')
    expect(PROMPTS.zh.questionLabel).toBe('问题：')
    expect(PROMPTS.zh.titleQuestionLabel).toBe('问题：')
    expect(PROMPTS.zh.titleAnswerLabel).toBe('回答：')
    expect(PROMPTS.zh.quoteLabelUser).toBe('用户消息')
    expect(PROMPTS.zh.quoteLabelAgent).toBe('Agent 回复')
  })

  it('defaults every builder to zh', () => {
    expect(formatSegments([{ role: 'user', text: 'x' }], 100)).toBe('用户：x')
    expect(composeSummary('B', 'R')).toBe('【背景】\nB\n\n【近期对话】\nR')
    expect(buildTitleInput('q', 'a')).toBe('问题：q\n回答：a')
  })
})

describe('output-language policy', () => {
  it('tells the model to follow the question, not the UI language', () => {
    // A zh-UI user quoting an English paper should get an English answer.
    expect(PROMPTS.zh.followUpIntro).toContain('用与「用户的问题」相同的语言作答')
    expect(PROMPTS.en.followUpIntro).toContain('same language as the user')
    expect(PROMPTS.zh.titleSystem).toContain('使用问题与回答的语言')
    expect(PROMPTS.en.titleSystem).toContain('use the language of the question and the answer')
  })

  it('keeps the dual title budget in both languages', () => {
    expect(PROMPTS.zh.titleSystem).toContain('15 个汉字')
    expect(PROMPTS.en.titleSystem).toContain('6 words')
  })
})
