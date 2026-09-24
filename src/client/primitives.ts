/**
 * Name-tolerant access to the host's UI primitive set — the RULE half.
 *
 * This module is deliberately pure: it reads a namespace it is HANDED and never
 * touches the running host, so it loads (and is tested) in plain node.
 * `host-primitives.ts` is the other half — the one place the module table's
 * namespace is bound to {@link iconIn} — and it is the only file allowed to
 * value-import `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * ## Why an icon cannot simply be imported
 *
 * DSH's icon set is artwork, and its names are not a contract. Up to
 * `0.1.6-alpha.2` every glyph carried its drawn size in its name
 * (`IconQuestionOutline14`, `IconCheckOutline16`); `feat(web): unify the client
 * visual language` (first shipped in `0.1.7-alpha.1`) renamed the WHOLE set by
 * stroke weight — `IconQuestionOutlineRegular` / `IconQuestionOutlineMedium` —
 * and deleted the old names outright (there is no alias in
 * `packages/client/ui-primitives/src/icons/index.tsx`).
 *
 * A named import of a deleted export is invisible to `tsc` in a bundled plugin:
 * the type stub the plugin builds against still declares the old names, and the
 * running host's module table hands over its own namespace — so the binding is
 * simply `undefined`, and the first render that draws it dies with React's
 * "Element type is invalid ... but got: undefined" (production error #130). That
 * is exactly what happened on a 0.1.7 host: the ask panel's composer row
 * (`ModelSelect` / `StrategySelect` chevrons, checks and warning glyph) threw
 * inside the containment boundary, so the whole panel was replaced by the crash
 * strip, and the tab chip — which draws its glyph OUTSIDE that boundary, in the
 * live-title seat — lost its title as well.
 *
 * ## The resolution rule
 *
 * Every icon is looked up by NAME, with a chain that covers both conventions:
 *
 * 1. `<base>Regular` — the current convention, and the weight the host's own
 *    chrome uses (`ui-sidebar-right/src/client/shell/SidebarRight.tsx:278`);
 * 2. `<base>Medium` — the same artwork at the emphasized weight;
 * 3. `<base><legacySize>` — the pre-0.1.7 size-suffixed name.
 *
 * A glyph the host does not have resolves to `undefined`, and {@link Glyph}
 * renders nothing for it: the panel keeps working with one missing piece of
 * chrome instead of failing whole. That is a deliberate downgrade — the artwork
 * is decoration, the panel is the feature.
 *
 * ## What is NOT resolved this way
 *
 * Components — `MarkdownText`, `Tooltip`, `Menu` — stay named imports. They are
 * API surfaces with typed props this plugin builds against, and the host keeps
 * them across releases; the icon set is the part the host renames freely.
 */
import { createElement, type ComponentType, type ReactNode } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** A primitive namespace, widened to a name lookup. */
export type PrimitiveModule = Readonly<Record<string, unknown>>

/** A glyph of the host's icon set: a component taking `size` / `className`. */
export type IconComponent = ComponentType<IconProps>

/**
 * The legacy size suffixes an icon name could carry before 0.1.7. Kept as a type
 * so a call site cannot spell a size the host never used.
 */
export type IconLegacySize = 12 | 14 | 16 | 20

/**
 * Whether a module export can be rendered as a component.
 *
 * Functions are the ordinary case; an object with React's `$$typeof` tag covers
 * the wrapped element types (`memo`, `forwardRef`, `lazy`). Anything else — a
 * string, a number, a namespace — is not a component and must not be returned:
 * handing React a non-component produces the very error this module prevents.
 * @param value - the module export to inspect.
 * @returns whether `<value />` would render.
 */
function isComponentType(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

/**
 * The first name that resolves to a renderable component.
 *
 * Names are tried in the caller's order, so the chain doubles as a preference
 * rule. A name that is missing — or present but not a component — is skipped
 * rather than returned, because a half-working glyph is worse than a fallback.
 * @param module - the primitive namespace to read.
 * @param names - candidate export names, most preferred first.
 * @returns the component, or undefined when no name resolves.
 */
export function pickExport<T>(module: PrimitiveModule, names: readonly string[]): T | undefined {
  for (const name of names) {
    const candidate = module[name]
    if (isComponentType(candidate)) return candidate as T
  }
  return undefined
}

/**
 * Resolve one glyph of the host's icon set across both naming conventions.
 * @param module - the primitive namespace to read.
 * @param base - the glyph's base name, WITHOUT a weight or size suffix
 *   (`IconChevronDownOutline`).
 * @param legacySize - the drawn size the glyph carried before 0.1.7
 *   (`IconChevronDownOutline14`), used as the last fallback.
 * @returns the glyph, or undefined when this host has none of the three names.
 */
export function iconIn(
  module: PrimitiveModule,
  base: string,
  legacySize: IconLegacySize,
): IconComponent | undefined {
  return pickExport<IconComponent>(module, [`${base}Regular`, `${base}Medium`, `${base}${legacySize}`])
}

/**
 * Draw a resolved glyph, or nothing when the host has no such name.
 *
 * The single place the "missing artwork is not a failure" policy lives: call
 * sites hand over whatever `iconOf` returned, including `undefined`.
 * @param props.icon - the resolved glyph, if any.
 * @param props.className - extra class for layout placement.
 * @returns the glyph element, or null.
 */
export function Glyph({ icon, className }: { icon: IconComponent | undefined; className?: string }): ReactNode {
  if (icon === undefined) return null
  return createElement(icon, className === undefined ? {} : { className })
}
