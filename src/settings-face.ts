/**
 * The capability probe for DSH's settings seam — the ONLY place that decides
 * which settings API shape this host offers.
 *
 * The seam changed under us without a rename: `dsh-settings@0.1.5-rc.2` (npm
 * `latest`) ships `SettingsProvider` with a public
 * `register(ns, schema, options)`; from `dsh-settings@0.1.7-alpha.1` the service
 * is `SettingsForms`, which has **no `register`** at all — a plugin's editable
 * fields are derived from its own exported `Config` schema (fields marked
 * volatile), and `describe` / `update` address **profile entry ids** rather than
 * a plugin-declared namespace. There is no compatibility entry point, so an
 * unguarded `register` call on a 0.1.7 host throws a `TypeError` on EVERY launch
 * (issue #19) — caught by the caller, so it degraded instead of crashing, but it
 * logged a failure line and left the namespace unregistered.
 *
 * Probe by STRUCTURE, never by version — the same rule the client half follows
 * for `sidebarRightTabs` / `slots` / `uiWorkspace`. `typeof … === 'function'`
 * covers both shapes, and it stays honest on a host that keeps the service name
 * while dropping a method (the failure mode a version comparison would miss).
 *
 * When `register` is absent this returns a typed refusal rather than throwing:
 * the caller logs one informational line, the plugin keeps running on
 * {@link SIDEBARQA_DEFAULTS}, and the config routes answer with an accurate
 * refusal instead of a bogus one.
 *
 * A future migration that keeps the settings page alive on 0.1.7+ (declare a
 * volatile `Config`, then address the form by entry id) would land here; the
 * guard is what makes that additive instead of a behavior cliff.
 */
import type { SidebarqaSettingsScope, SidebarqaSettingsService } from './context-types.ts'

/** One namespace view: the resolved value plus the revision it was read at. */
export interface SidebarqaConfigView {
  value?: unknown
  revision?: number
}

/** The revision-guarded read/write face the `/sidebarqa/api` config routes use. */
export interface SidebarqaConfigFace {
  get(): SidebarqaConfigView
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<SidebarqaConfigView>
}

/**
 * Why the namespace is unavailable.
 * - `service-missing`: no `ctx.settings` at all (the caller's `inject` callback
 *   does not run in that deployment, so this is the defensive branch).
 * - `no-register`: the service is mounted but exposes no namespace registration
 *   (`dsh-settings` ≥ 0.1.7). Expected on a new host — not an error.
 * - `register-failed`: registration itself refused (duplicate namespace, schema
 *   clash, a provider that throws). Genuinely unexpected: worth a warning.
 */
export type SidebarqaSettingsSeamReason = 'service-missing' | 'no-register' | 'register-failed'

/** The probe result: an opened scope plus its face, or why there is none. */
export type SidebarqaSettingsSeam<T> =
  | { ok: true; scope: SidebarqaSettingsScope<T>; face: SidebarqaConfigFace }
  | { ok: false; reason: SidebarqaSettingsSeamReason; error?: unknown }

/**
 * Build the read/write face over an already-registered namespace.
 *
 * `describe` / `update` are probed separately: a host that registers namespaces
 * may still drop either one, and every call site here must degrade instead of
 * throwing an opaque `… is not a function` from inside a route handler.
 * @param service - the (structurally probed) settings service.
 * @param ns - the namespace this face reads and writes.
 * @returns the revision-guarded face.
 */
function faceOf(service: Partial<SidebarqaSettingsService>, ns: string): SidebarqaConfigFace {
  const describe = typeof service.describe === 'function' ? service.describe.bind(service) : undefined
  const update = typeof service.update === 'function' ? service.update.bind(service) : undefined
  const empty: SidebarqaConfigView = { value: undefined, revision: undefined }
  const viewOf = (): SidebarqaConfigView => {
    if (describe === undefined) return empty
    const listed: unknown = describe({ redactSecrets: true })
    if (!Array.isArray(listed)) return empty
    const descriptor = listed.find(candidate => (candidate as { ns?: unknown }).ns === ns)
    return descriptor === undefined
      ? empty
      : {
          value: (descriptor as { value?: unknown }).value,
          revision: (descriptor as { revision?: number }).revision,
        }
  }
  return {
    get: viewOf,
    update: async (patch, expectedRevision) => {
      if (update === undefined) {
        throw new Error('this host exposes no settings.update for a registered namespace')
      }
      await update(ns, patch, expectedRevision)
      return viewOf()
    },
  }
}

/**
 * Probe the settings service and, when it can carry a namespace, open ours.
 * @param service - `ctx.settings`, read structurally (never trusted by type).
 * @param ns - the namespace to register (`sidebarqa`).
 * @param schema - the namespace schema (schemastery).
 * @returns the opened scope + face, or a typed refusal that never throws.
 */
export function openSettingsSeam<T>(service: unknown, ns: string, schema: unknown): SidebarqaSettingsSeam<T> {
  if (service === null || service === undefined) return { ok: false, reason: 'service-missing' }
  const probe = service as Partial<SidebarqaSettingsService>
  if (typeof probe.register !== 'function') return { ok: false, reason: 'no-register' }
  try {
    const scope = probe.register<T>(ns, schema)
    return { ok: true, scope, face: faceOf(probe, ns) }
  } catch (error) {
    return { ok: false, reason: 'register-failed', error }
  }
}
