/**
 * The copy dictionary and its locale resolution: the service beats the browser
 * language, switches live, degrades without a service, interpolates `{name}`
 * placeholders, and keeps the zh/en key sets in lockstep.
 *
 * The subscription assertions cover `use-locale.ts`'s whole pure surface: the
 * hook itself is a three-line `useSyncExternalStore` over these two functions
 * (the test env is `node` — no DOM, and React 18's uSES cannot be rendered
 * through `react-dom/server` with a two-argument call).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeLocaleId,
  attachLocale,
  en,
  isZh,
  LOCALE_NS,
  promptLocale,
  subscribeLocale,
  t,
  zh,
} from '../src/client/locales.ts'
import { FakeLocale, removeNavigator, restoreNavigator, stubNavigatorLanguage } from './fake-locale.ts'

afterEach(() => {
  attachLocale(undefined)
  restoreNavigator()
})

describe('locale resolution', () => {
  it('falls back to the browser language when no service is attached', () => {
    stubNavigatorLanguage('en-US')
    expect(t('askTabTitle')).toBe('Follow-up')
    expect(isZh()).toBe(false)

    stubNavigatorLanguage('zh-CN')
    expect(t('askTabTitle')).toBe('追问')
    expect(isZh()).toBe(true)
  })

  it('defaults to English with neither a service nor a navigator', () => {
    removeNavigator()
    expect(activeLocaleId()).toBe('en')
    expect(t('askTabTitle')).toBe('Follow-up')
  })

  it('lets the attached service beat the browser language, and switches live', () => {
    stubNavigatorLanguage('en-US')
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    expect(t('askTabTitle')).toBe('追问')

    locale.switchTo('en')
    expect(t('askTabTitle')).toBe('Follow-up')

    locale.switchTo('zh')
    expect(t('askTabTitle')).toBe('追问')
  })

  it('detaching returns to the browser language', () => {
    stubNavigatorLanguage('en-US')
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    expect(isZh()).toBe(true)

    attachLocale(undefined)
    expect(isZh()).toBe(false)
    expect(t('askTabTitle')).toBe('Follow-up')
  })

  it('ignores an empty active id and falls through to the browser language', () => {
    stubNavigatorLanguage('zh-CN')
    attachLocale(new FakeLocale(''))
    expect(activeLocaleId()).toBe('zh-CN')
  })

  it('maps any non-zh language to the English dictionary', () => {
    attachLocale(new FakeLocale('fr-FR'))
    expect(isZh()).toBe(false)
    expect(t('askTabTitle')).toBe('Follow-up')
  })

  it('reports the prompt locale for the model-facing routes', () => {
    attachLocale(new FakeLocale('zh'))
    expect(promptLocale()).toBe('zh')
    attachLocale(new FakeLocale('en'))
    expect(promptLocale()).toBe('en')
  })
})

describe('interpolation', () => {
  it('substitutes {name} placeholders in both locales', () => {
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    expect(t('timeMinutes', { n: 5 })).toBe('5分钟')
    expect(t('histWorkspace', { name: 'my-workspace' })).toBe('当前工作区：my-workspace')

    locale.switchTo('en')
    expect(t('timeMinutes', { n: 5 })).toBe('5m')
    expect(t('histWorkspace', { name: 'my-workspace' })).toBe('Workspace: my-workspace')
  })

  it('leaves the text untouched when no params are given', () => {
    attachLocale(new FakeLocale('en'))
    expect(t('timeMinutes')).toBe('{n}m')
  })
})

describe('the uSES contract behind useLocaleRevision', () => {
  it('returns a stable primitive snapshot', () => {
    attachLocale(new FakeLocale('zh'))
    // A fresh object per call would re-render forever; only a primitive is safe.
    expect(typeof activeLocaleId()).toBe('string')
    expect(Object.is(activeLocaleId(), activeLocaleId())).toBe(true)
  })

  it('forwards subscription (and its disposer) to the attached service', () => {
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    let notified = 0
    const off = subscribeLocale(() => { notified++ })
    expect(locale.listenerCount).toBe(1)

    locale.switchTo('en')
    expect(notified).toBe(1)

    off()
    expect(locale.listenerCount).toBe(0)
    locale.switchTo('zh')
    expect(notified).toBe(1)
  })

  it('is an inert no-op without a service', () => {
    const off = subscribeLocale(() => {})
    expect(() => { off() }).not.toThrow()
  })
})

describe('dictionary integrity', () => {
  it('registers under a namespace no other DSH surface owns', () => {
    // 'sidebar' is DSH's own ui-sidebar; 'betterSidebar' is the framework's.
    expect(LOCALE_NS).toBe('sidebarQa')
  })

  it('keeps the zh and en key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has no empty values in either locale', () => {
    // The `Record<CopyKey, string>` annotation permits '' — this catches the
    // "added the key, forgot the translation" case it cannot.
    expect(Object.entries(zh).filter(([, value]) => value.trim() === '')).toEqual([])
    expect(Object.entries(en).filter(([, value]) => value.trim() === '')).toEqual([])
  })

  it('keeps every {name} placeholder present in both locales', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1] ?? '').sort()
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect({ key, params: placeholders(en[key]) })
        .toEqual({ key, params: placeholders(zh[key]) })
    }
  })
})
