import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { relativeTime, timeLabel } from '../src/client/history-time.ts'
import { attachLocale } from '../src/client/locales.ts'
import { FakeLocale, restoreNavigator } from './fake-locale.ts'

// The labels follow the DSH language, so every case pins one explicitly —
// otherwise the suite would silently read the RUNNER's navigator.language
// (green on a zh machine, red on an en CI box).
afterEach(() => { attachLocale(undefined); restoreNavigator() })

describe('relativeTime', () => {
  const now = 1_000_000_000_000

  it('buckets into now/minutes/hours/days/months/years', () => {
    expect(relativeTime(now, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ unit: 'minutes', n: 5 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 })
    expect(relativeTime(now - 2 * 86_400_000, now)).toEqual({ unit: 'days', n: 2 })
    expect(relativeTime(now - 60 * 86_400_000, now)).toEqual({ unit: 'months', n: 2 })
    expect(relativeTime(now - 400 * 86_400_000, now)).toEqual({ unit: 'years', n: 1 })
  })

  it('clamps negative diffs (future timestamps) to now', () => {
    expect(relativeTime(now + 10_000, now)).toEqual({ unit: 'now', n: 0 })
  })
})

describe('timeLabel', () => {
  const now = 1_000_000_000_000

  beforeEach(() => { attachLocale(new FakeLocale('zh')) })

  it('renders the compact zh labels like the DSH left panel', () => {
    expect(timeLabel(now, now)).toBe('刚刚')
    expect(timeLabel(now - 5 * 60_000, now)).toBe('5分钟')
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3小时')
    expect(timeLabel(now - 2 * 86_400_000, now)).toBe('2天')
    expect(timeLabel(now - 60 * 86_400_000, now)).toBe('2个月')
    expect(timeLabel(now - 400 * 86_400_000, now)).toBe('1年')
  })

  it('renders unit abbreviations in en (no plural forms needed)', () => {
    attachLocale(new FakeLocale('en'))
    expect(timeLabel(now, now)).toBe('now')
    expect(timeLabel(now - 1 * 60_000, now)).toBe('1m')
    expect(timeLabel(now - 5 * 60_000, now)).toBe('5m')
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3h')
    expect(timeLabel(now - 2 * 86_400_000, now)).toBe('2d')
    expect(timeLabel(now - 60 * 86_400_000, now)).toBe('2mo')
    expect(timeLabel(now - 400 * 86_400_000, now)).toBe('1y')
  })

  it('switches live with the locale service', () => {
    const locale = new FakeLocale('zh')
    attachLocale(locale)
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3小时')
    locale.switchTo('en')
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3h')
  })
})
