/**
 * The slot registry, probed rather than injected.
 *
 * `slots` is published by DSH's renderer, and this plugin's `apply` is not ordered
 * against it. `ctx.get()` is the only safe way to reach it: injecting it would park
 * this plugin's fiber on any composition without the renderer, and a parked fiber
 * fails the ENTIRE web boot (`boot-client.ts`) rather than skipping this plugin.
 *
 * Two modules need it for different seats — `sidebar-native.ts` for the right
 * column's tab bodies, `settings-slot.ts` for DSH's own settings page — so the probe
 * lives here rather than in either of them.
 */
import type { Context, SidebarqaSlotsService } from '../context-types.ts'

/**
 * The slot registry, or undefined when DSH's UI is not composed.
 * @param ctx - the client plugin context.
 * @returns the service face, or undefined.
 */
export function slotsServiceOf(ctx: Context): SidebarqaSlotsService | undefined {
  const slots = ctx.get('slots')
  if (slots === undefined) return undefined
  // Both verbs, because both are used: `inject` waits for a seat to be declared and
  // `register` contributes into it. A registry with only one of them is a
  // composition fault, and reporting that as "no registry" beats calling a method
  // that is not there.
  if (typeof slots.register !== 'function' || typeof slots.inject !== 'function') return undefined
  return slots
}
