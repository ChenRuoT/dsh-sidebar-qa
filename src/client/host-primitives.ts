/**
 * The RUNNING host's UI primitive namespace, bound to the lookup rule.
 *
 * `primitives.ts` owns the rule (and stays pure so it can be tested in node);
 * this module is the only file in the plugin that value-imports
 * `@deepseek-ai/dsh-client-ui-primitives`, and it exists for one reason: the
 * module table is the runtime's, so a glyph must be resolved against it rather
 * than imported by name (see `primitives.ts` for the rename that makes this
 * load-bearing, and for what an unresolved name costs).
 *
 * Nothing else may take this dependency: a second importer would be a second
 * place where a deleted export silently becomes `undefined`. The suite pins that
 * (`tests/primitives.spec.ts`).
 *
 * ## Why the namespace may be read at module scope
 *
 * Unlike a cordis service (which may be provided after this plugin's `apply` and
 * must therefore be probed at the call site), the platform module table is frozen
 * BEFORE any bundle factory runs (`packages/client/web/src/seed.ts`), so a name
 * absent now cannot appear later and a resolved glyph cannot go stale.
 */
import * as HostPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import { iconIn, type IconComponent, type IconLegacySize, type PrimitiveModule } from './primitives.ts'

/**
 * The running host's primitive namespace.
 *
 * The cast is the point: the installed type stub describes ONE generation of the
 * host (currently the pre-rename `0.1.6-alpha.2`), while this namespace is
 * whichever generation is actually deployed. Every read goes through
 * {@link iconIn}, which verifies the value is renderable instead of trusting a
 * name.
 */
const HOST_PRIMITIVES: PrimitiveModule = HostPrimitives as unknown as PrimitiveModule

/**
 * Resolve one of the host's glyphs by name.
 *
 * Called once per call site, at module scope: the module table is frozen at boot
 * (see the module doc), so the answer cannot change while the plugin lives.
 * @param base - the glyph's base name, without a weight or size suffix
 *   (`IconChevronDownOutline`).
 * @param legacySize - the drawn size the glyph carried before 0.1.7
 *   (`IconChevronDownOutline14`).
 * @returns the glyph, or undefined when this host has none of the three names —
 *   which `Glyph` renders as no glyph at all.
 */
export function iconOf(base: string, legacySize: IconLegacySize): IconComponent | undefined {
  return iconIn(HOST_PRIMITIVES, base, legacySize)
}
