/**
 * The live-config reader (`src/live-config.ts`) — the read half of issue #21.
 *
 * On DSH ≥ 0.1.7 the plugin's knobs are its own volatile `Config`: the runtime
 * hands `apply` one ref per field and updates those refs in place when a write
 * commits. These cases pin the three properties the host half depends on:
 * detection is all-or-nothing, reads always answer a full plain config, and a
 * broken or missing ref degrades a single FIELD instead of taking the route down.
 */
import { describe, expect, it } from 'vitest'
import { SIDEBARQA_DEFAULTS } from '../src/config.ts'
import { liveConfigOf, liveConfigReader, unwrapVolatile } from '../src/live-config.ts'

/** A ref whose `get()` answers `value` (the runtime's `Volatile<T>` shape). */
function ref<T>(value: T): { get(): T } {
  return { get: () => value }
}

/** A live config of refs, defaults filled, with per-key overrides. */
function live(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...SIDEBARQA_DEFAULTS, ...overrides }).map(([key, value]) => [key, ref(value)]),
  )
}

describe('unwrapVolatile', () => {
  it('replaces refs with their values, leaving plain data untouched', () => {
    expect(unwrapVolatile(ref('x'))).toBe('x')
    expect(unwrapVolatile(7)).toBe(7)
    expect(unwrapVolatile(null)).toBeNull()
    expect(unwrapVolatile('x')).toBe('x')
    expect(unwrapVolatile([1, 2])).toEqual([1, 2])
  })

  it('descends into objects and arrays, and through nested refs', () => {
    expect(unwrapVolatile({ a: ref(1), b: { c: ref('d') }, e: [ref(2), { f: ref(3) }] }))
      .toEqual({ a: 1, b: { c: 'd' }, e: [2, { f: 3 }] })
    expect(unwrapVolatile(ref(ref('twice')))).toBe('twice')
  })
})

describe('liveConfigOf', () => {
  it('accepts a config where every declared field is a ref', () => {
    const config = live()
    expect(liveConfigOf(config)).toBe(config)
  })

  it('rejects a plain config, a partial ref-config, and non-objects', () => {
    expect(liveConfigOf(undefined)).toBeUndefined()
    expect(liveConfigOf(null)).toBeUndefined()
    expect(liveConfigOf('config')).toBeUndefined()
    expect(liveConfigOf({})).toBeUndefined()
    expect(liveConfigOf(SIDEBARQA_DEFAULTS)).toBeUndefined()
    // ONE plain field is enough to reject: a half-live read would silently pin
    // that field to its default forever.
    expect(liveConfigOf({ ...live(), answerModel: 'deepseek-v4' })).toBeUndefined()
  })
})

describe('liveConfigReader', () => {
  it('reads the current value of every field', () => {
    const read = liveConfigReader(liveConfigOf(live({ answerModel: 'deepseek-v4' }))!)
    expect(read()).toEqual({ ...SIDEBARQA_DEFAULTS, answerModel: 'deepseek-v4' })
  })

  it('reads LIVE: a ref that changed value is observed on the next call', () => {
    const config = live()
    const read = liveConfigReader(liveConfigOf(config)!)
    expect(read().historyStrategy).toBe(SIDEBARQA_DEFAULTS.historyStrategy)
    ;(config.historyStrategy as { get(): unknown }).get = () => 'trim'
    expect(read().historyStrategy).toBe('trim')
  })

  it('keeps the default for a ref that answers undefined or throws, and still reads the rest', () => {
    let thrower = true
    const config = live({ trimWindowMessages: undefined })
    config.answerModel = { get: () => { if (thrower) throw new Error('ref exploded'); return 'recovered' } }

    const read = liveConfigReader(liveConfigOf(config as unknown as Record<string, unknown>)!)
    // `trimWindowMessages` resolves to `undefined` → the default stands; the
    // throwing ref degrades that field only, and recovers once it behaves.
    expect(read().trimWindowMessages).toBe(SIDEBARQA_DEFAULTS.trimWindowMessages)
    expect(read().answerModel).toBe(SIDEBARQA_DEFAULTS.answerModel)
    thrower = false
    expect(read().answerModel).toBe('recovered')
  })

  it('unwraps a nested structure a field might carry (no `{ get }` leaks to the wire)', () => {
    const read = liveConfigReader(liveConfigOf(live({ summarizeProvider: ref('p') }))!)
    expect(read().summarizeProvider).toBe('p')
  })
})
