/**
 * The registration half of the plugin's settings page: it knows the seat, the slot
 * registry and the retry, and nothing about React or the panel's CSS.
 *
 * Split out of `settings-section.tsx` for the same reason `sidebar-install.ts` once
 * was: that module imports the panel, whose import chain ends at a `.module.css` file
 * the Node ESM loader refuses to parse, so nothing reachable from it can be tested
 * under this project's `node` environment.
 *
 * ## Why `settings.section`
 *
 * It is the seat DSH itself provides for a feature's settings page (declared by
 * `ui-settings-general`). The neighbouring `plugins.item` looks right and is not: its
 * contract reserves it for the host-plane configuration pages `ui-settings-plugins`
 * ships, and points a bundle at `plugins.bundle.config` instead — a page that is
 * unavailable whenever the deployment has no managed profile, which would take the
 * config entry away with it. A settings section is always reachable.
 *
 * ## Why the registry is probed
 *
 * Two waits here are real and independent: `slots` is published by DSH's renderer and
 * the seat by `ui-settings-general`. `slots.inject` covers the second — it runs the
 * contribution once the seat is declared — but the registry itself has to be read with
 * `ctx.get`, because injecting it would park this plugin's fiber on a composition
 * without the renderer, and a parked fiber fails the ENTIRE web boot rather than
 * skipping this plugin.
 */
import type { Context } from '../context-types.ts'
import { slotsServiceOf } from './slots.ts'

/**
 * The section's identity. DSH also keys the nav icon by it, and an id it does not
 * know falls back to a gear — the right glyph for a settings page.
 */
export const SETTINGS_SECTION_ID = 'sidebar-qa'

/**
 * Its position in the settings nav: after every section DSH ships (general 0, models
 * 10, plugins 15, agent-presets 20, archived-sessions 25).
 */
export const SETTINGS_SECTION_ORDER = 30

/**
 * Contribute `component` as a DSH settings section, as soon as that is possible.
 *
 * Owned by this plugin's effect, so it unregisters with the plugin (HMR-safe).
 * @param ctx - the client plugin context.
 * @param opts - the nav label (re-read per projection) and the section component.
 */
export function installSettingsSection(
  ctx: Context,
  opts: { label: () => string; component: unknown },
): void {
  /** Set once contributed, so later service arrivals are ignored. */
  let installed = false

  const installIfPossible = (): void => {
    if (installed) return
    const slots = slotsServiceOf(ctx)
    if (slots === undefined) return
    installed = true
    ctx.effect(() => slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: SETTINGS_SECTION_ORDER,
      label: opts.label,
    }, opts.component)), 'dsh-sidebar-qa: settings section')
  }

  ctx.effect(() => {
    // Any service publication may be the renderer we are waiting for.
    // `internal/service` is emitted by `ReflectService.notify` on every `provide`.
    const off = ctx.on('internal/service', () => { installIfPossible() })
    // It may also already be composed (the common case), so look once now.
    installIfPossible()
    return off
  }, 'dsh-sidebar-qa: settings slot watch')
}
