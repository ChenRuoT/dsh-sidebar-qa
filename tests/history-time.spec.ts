import { describe, expect, it } from 'vitest'
import { relativeTime, timeLabel } from '../src/client/history-time.ts'

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

  it('renders the compact zh labels like the DSH left panel', () => {
    expect(timeLabel(now, now)).toBe('刚刚')
    expect(timeLabel(now - 5 * 60_000, now)).toBe('5分钟')
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3小时')
    expect(timeLabel(now - 2 * 86_400_000, now)).toBe('2天')
    expect(timeLabel(now - 60 * 86_400_000, now)).toBe('2个月')
    expect(timeLabel(now - 400 * 86_400_000, now)).toBe('1年')
  })
})
