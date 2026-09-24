/**
 * The host's icon set is resolved BY NAME, never imported by name.
 *
 * DSH renamed the whole set in `0.1.7-alpha.1` (`feat(web): unify the client
 * visual language`): every glyph went from a drawn-size suffix
 * (`IconQuestionOutline14`, `IconCheckOutline16`) to a stroke-weight suffix
 * (`IconQuestionOutlineRegular` / `IconQuestionOutlineMedium`), with no aliases.
 * A named import of a deleted export is not a build error in a bundled plugin —
 * the type stub still declares the old name and the running host simply has no
 * such property — so the binding is `undefined`, and the first render that draws
 * it dies with React's "Element type is invalid ... but got: undefined"
 * (production error #130). On a 0.1.7 host that took the ask panel down whole
 * (its composer row draws chevrons / checks / a warning glyph) and cost the tab
 * chip its title.
 *
 * This suite pins the resolution rule and, more importantly, pins the wiring:
 * nothing outside `primitives.ts` may import an icon by name again.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Glyph, iconIn, pickExport, type IconComponent, type PrimitiveModule } from '../src/client/primitives.ts'

const CLIENT_DIR = new URL('../src/client/', import.meta.url)
const STUB_ICON_TYPES = new URL(
  '../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/icons/index.d.ts',
  import.meta.url,
)

/** A renderable double, distinguishable by its markup (and forwarding `className`). */
function glyph(name: string): IconComponent {
  return function FakeGlyph({ className }: { className?: string }) {
    return createElement('svg', className === undefined
      ? { 'data-glyph': name }
      : { 'data-glyph': name, className })
  }
}

function moduleOf(entries: Record<string, unknown>): PrimitiveModule {
  return entries
}

// ────────────────────────────────────────────────────────────────────────────
// The rule
// ────────────────────────────────────────────────────────────────────────────

describe('resolving one glyph across the host icon set\'s two generations', () => {
  const regular = glyph('regular')
  const medium = glyph('medium')
  const legacy = glyph('legacy')

  it('finds the current weight-suffixed name', () => {
    const module = moduleOf({ IconChevronDownOutlineRegular: regular })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(regular)
  })

  it('prefers Regular when both weights are present, like the host chrome does', () => {
    const module = moduleOf({ IconChevronDownOutlineRegular: regular, IconChevronDownOutlineMedium: medium })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(regular)
  })

  it('falls back to Medium when Regular is absent', () => {
    const module = moduleOf({ IconChevronDownOutlineMedium: medium })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(medium)
  })

  it('falls back to the pre-0.1.7 size-suffixed name', () => {
    const module = moduleOf({ IconChevronDownOutline14: legacy })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(legacy)
  })

  it('prefers either current name over the legacy one', () => {
    const module = moduleOf({
      IconChevronDownOutline14: legacy,
      IconChevronDownOutlineMedium: medium,
    })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(medium)
  })

  it('answers undefined, without throwing, when the host has none of the names', () => {
    // A future rename must degrade to "one piece of chrome is missing", not to a
    // crashed panel: the artwork is decoration, the panel is the feature.
    expect(iconIn(moduleOf({}), 'IconChevronDownOutline', 14)).toBeUndefined()
    expect(iconIn(moduleOf({ IconSomethingElse: regular }), 'IconChevronDownOutline', 14)).toBeUndefined()
  })

  it('skips a name whose value is not renderable', () => {
    // A same-named non-component (a string, a namespace, a number) would be just
    // as fatal as `undefined` — `<"text" />` is the same React error #130.
    const module = moduleOf({
      IconChevronDownOutlineRegular: 'not a component',
      IconChevronDownOutlineMedium: null,
      IconChevronDownOutline14: legacy,
    })
    expect(iconIn(module, 'IconChevronDownOutline', 14)).toBe(legacy)
    expect(iconIn(moduleOf({ IconChevronDownOutlineRegular: 42 }), 'IconChevronDownOutline', 14)).toBeUndefined()
  })

  it('accepts a wrapped element type, not only a plain function', () => {
    // `memo` / `forwardRef` hand back an object carrying React's `$$typeof` tag.
    const wrapped = { $$typeof: Symbol.for('react.memo') } as unknown as ComponentType<never>
    expect(pickExport<IconComponent>(moduleOf({ IconQueueOutlineRegular: wrapped }), ['IconQueueOutlineRegular']))
      .toBe(wrapped)
  })
})

describe('Glyph', () => {
  it('draws nothing when the host has no such glyph', () => {
    expect(renderToStaticMarkup(createElement(Glyph, { icon: undefined }))).toBe('')
  })

  it('draws the glyph, with the placement class when one is given', () => {
    const markup = renderToStaticMarkup(createElement(Glyph, { icon: glyph('x'), className: 'place' }))
    expect(markup).toContain('data-glyph="x"')
    expect(markup).toContain('class="place"')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// The call sites
// ────────────────────────────────────────────────────────────────────────────

/** Every client-half source file that may draw a host glyph. */
function clientFiles(): string[] {
  return readdirSync(CLIENT_DIR).filter(name => /\.tsx?$/.test(name))
}

interface IconCallSite {
  file: string
  base: string
  size: string
}

/** Every `iconOf('<base>', <legacySize>)` the client half calls. */
function iconCallSites(): IconCallSite[] {
  const sites: IconCallSite[] = []
  for (const file of clientFiles()) {
    const text = readFileSync(new URL(file, CLIENT_DIR), 'utf8')
    for (const match of text.matchAll(/iconOf\(\s*'([A-Za-z0-9]+)'\s*,\s*(12|14|16|20)\s*\)/g)) {
      sites.push({ file, base: match[1]!, size: match[2]! })
    }
  }
  return sites
}

/**
 * The glyph names the INSTALLED type stub declares — the pre-rename generation,
 * which is exactly why it cannot be trusted as the runtime's contract.
 */
function stubIconNames(): string[] {
  const source = readFileSync(STUB_ICON_TYPES, 'utf8')
  return [...source.matchAll(/export declare const (Icon[A-Za-z0-9]+):/g)].map(match => match[1]!)
}

/** The pre-0.1.7 shape: each glyph named after the size it was drawn at. */
const LEGACY_NAMES = stubIconNames()
/** The 0.1.7+ shape, derived from that list by the documented rename. */
const MODERN_NAMES = LEGACY_NAMES.map(name => name.replace(/(12|14|16|20)$/, 'Regular'))

/**
 * The DSH checkout this plugin is developed against, when it is on this machine.
 * Read-only: it is the runtime's own export list, the one thing no stub can
 * stand in for. Override with `DSH_SOURCE_ROOT`; the check skips without it.
 */
const DSH_SOURCE_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:/dsh/deepseek-harness'
// The SOURCE, not `lib`: a checkout that is mid-build has no `lib/index.js`, and a
// check that silently skips whenever the host happens to be compiling is worth
// less than one that reads the same names the compiler would emit.
const DSH_RUNTIME_ICONS = join(DSH_SOURCE_ROOT, 'packages/client/ui-primitives/src/icons/index.tsx')

describe('the glyphs this plugin draws', () => {
  it('are looked up, not imported — the rule that keeps a rename from crashing the panel', () => {
    // At least the seven the panel and the two tab chips draw. The floor exists so
    // a regex that silently stops matching cannot make every assertion below
    // vacuous.
    expect(iconCallSites().length).toBeGreaterThanOrEqual(7)
  })

  it('exist under BOTH naming conventions of the installed type stub', () => {
    const legacy = new Set(LEGACY_NAMES)
    const modern = new Set(MODERN_NAMES)
    for (const site of iconCallSites()) {
      const legacyName = `${site.base}${site.size}`
      expect(legacy.has(legacyName), `${site.file} calls iconOf('${site.base}', ${site.size}) but the stub declares no ${legacyName}`).toBe(true)
      expect(modern.has(`${site.base}Regular`), `${site.file} calls iconOf('${site.base}', ${site.size}) but the renamed set has no ${site.base}Regular`).toBe(true)
    }
  })

  it('resolve through the rule in both simulated host generations', () => {
    const legacyModule = moduleOf(Object.fromEntries(LEGACY_NAMES.map(name => [name, glyph(name)])))
    const modernModule = moduleOf(Object.fromEntries(MODERN_NAMES.map(name => [name, glyph(name)])))
    for (const site of iconCallSites()) {
      expect(iconIn(legacyModule, site.base, Number(site.size) as 12 | 14 | 16 | 20), site.file).toBeDefined()
      expect(iconIn(modernModule, site.base, Number(site.size) as 12 | 14 | 16 | 20), site.file).toBeDefined()
    }
  })

  it.skipIf(!existsSync(DSH_RUNTIME_ICONS))(
    'exist in the running DSH checkout\'s real export list',
    () => {
      const source = readFileSync(DSH_RUNTIME_ICONS, 'utf8')
      const exported = new Set(
        [...source.matchAll(/export const (Icon[A-Za-z0-9]+)/g)].map(match => match[1]!),
      )
      for (const site of iconCallSites()) {
        const found = exported.has(`${site.base}Regular`) || exported.has(`${site.base}Medium`)
        expect(found, `${site.file} calls iconOf('${site.base}', ${site.size}) but ${DSH_SOURCE_ROOT} exports neither ${site.base}Regular nor ${site.base}Medium`).toBe(true)
      }
    },
  )
})

describe('the primitive namespace itself', () => {
  it('is value-imported by exactly one module', () => {
    const importers = clientFiles().filter(file => /import\s+\*\s+as\s+\w+\s+from\s*'@deepseek-ai\/dsh-client-ui-primitives'/.test(
      readFileSync(new URL(file, CLIENT_DIR), 'utf8'),
    ))
    expect(importers).toEqual(['host-primitives.ts'])
  })

  it('is never asked for an icon by NAME, which is the import that goes undefined', () => {
    for (const file of clientFiles()) {
      const text = readFileSync(new URL(file, CLIENT_DIR), 'utf8')
      for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
        // A whole-import `type` is erased at build time, so it can never be the
        // undefined binding this guard is about.
        if (match[1] !== undefined) continue
        for (const specifier of match[2]!.split(',')) {
          const name = specifier.trim()
          if (name === '' || name.startsWith('type ')) continue
          expect(name, `${file} value-imports ${name}; resolve it with iconOf() instead`).not.toMatch(/^Icon/)
        }
      }
    }
  })
})
