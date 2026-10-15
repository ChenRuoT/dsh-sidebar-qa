import { describe, expect, it } from 'vitest'
import { SIDEBARQA_DEFAULTS, SidebarqaPrefsSchema } from '../src/config.ts'
import { liveConfigOf, liveConfigReader, unwrapVolatile } from '../src/live-config.ts'

/**
 * Regression guard for the PR #3 class of bug ("panel changes fail to save") and
 * its issue #21 successor ("panel changes fail to save on DSH 0.2.x"):
 *
 * - the plugin's `Config` is its OWN schema export now, so a schema that throws
 *   on defaults / panel patches / stale row keys fails the plugin at load, and
 * - every field MUST be `volatile()`, because DSH >= 0.1.7 derives the editable
 *   form from exactly those fields (`volatileForm`) and refuses (`Config field
 *   "…" is not volatile`) any write outside them. A field that loses the mark
 *   disappears from the host's form while the panel keeps offering it.
 *
 * Every future settings key must keep these passes green.
 */

/** Call the schema with untyped input, then unwrap the live refs it resolves to
 *  (the runtime's `Volatile<T>` shape) so the cases below read as plain data. */
function parse(input: unknown): Record<string, unknown> {
  const parsed = (SidebarqaPrefsSchema as unknown as { (input: unknown): Record<string, unknown> })(input)
  return unwrapVolatile(parsed) as Record<string, unknown>
}

describe('SidebarqaPrefsSchema (the plugin Config surface)', () => {
  it('marks EVERY field volatile — the host derives its form from these marks (issue #21)', () => {
    const dict = (SidebarqaPrefsSchema as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
    const fields = Object.keys(SIDEBARQA_DEFAULTS)
    expect(Object.keys(dict).sort()).toEqual([...fields].sort())
    for (const key of fields) {
      expect(dict[key]?.meta?.volatile, `${key} must be .volatile()`).toBe(true)
    }
    // Per FIELD, never the root: a root-volatile schema collapses the config
    // into one ref, but the documented form shape is one ref per knob
    // (`docs/cookbook/adding-a-settings-card.md`).
    expect((SidebarqaPrefsSchema as unknown as { meta?: { volatile?: boolean } }).meta?.volatile).toBeUndefined()
  })

  it('resolves into live refs the runtime can update in place (issue #21)', () => {
    const refs = liveConfigOf((SidebarqaPrefsSchema as unknown as { (input: unknown): unknown })({}))
    expect(refs).toBeDefined()
    expect(liveConfigReader(refs!)()).toEqual(SIDEBARQA_DEFAULTS)
  })

  it('parses an empty config into the full defaults (a fresh profile row)', () => {
    expect(parse({})).toEqual(SIDEBARQA_DEFAULTS)
  })

  it('fills defaults for a partial user config (settings.yaml merge)', () => {
    expect(parse({ historyStrategy: 'inherit' })).toEqual({
      ...SIDEBARQA_DEFAULTS,
      historyStrategy: 'inherit',
    })
  })

  it('accepts every panel patch the ConfigPanel can send', () => {
    const patches: unknown[] = [
      { historyStrategy: 'trim' },
      { trimWindowMessages: 42 },
      { answerProvider: 'deepseek-official' },
      { answerModel: 'deepseek-v4' },
      { answerReasoningEffort: 'high' },
      { summarizeProvider: '' },
      { summarizeModel: 'deepseek-v4-flash' },
      { summarizeReasoningEffort: 'off' },
    ]
    for (const patch of patches) {
      expect(parse(patch)).toMatchObject(patch as Record<string, unknown>)
    }
  })

  it('rejects values outside the declared vocabulary instead of accepting them', () => {
    expect(() => parse({ historyStrategy: 'bogus' })).toThrow()
    expect(() => parse({ trimWindowMessages: 999 })).toThrow()
    expect(() => parse({ answerReasoningEffort: 'ultra' })).toThrow()
  })

  it('tolerates unknown keys (stale/extra settings.yaml entries must not break registration)', () => {
    expect(parse({ foo: 1, historyStrategy: 'trim' })).toMatchObject({
      foo: 1,
      historyStrategy: 'trim',
    })
  })

  it('round-trips the full defaults object', () => {
    expect(parse(SIDEBARQA_DEFAULTS)).toEqual(SIDEBARQA_DEFAULTS)
  })
})
