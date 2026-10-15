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
 *
 * ── That migration has landed (issue #21) ────────────────────────────────
 * When `register` is absent the probe now opens the SAME revision-guarded face
 * against the plugin's own PROFILE ENTRY ID instead of a declared namespace:
 * `dsh-settings` ≥ 0.1.7 derives a form from the plugin's `Config` schema
 * (`volatileForm`, i.e. every field this plugin declares volatile) and
 * addresses it by the loader row id, so `describe`/`update` take that id where
 * they used to take `sidebarqa`. The id is passed in by the caller, which is
 * the only place that can know it (`ctx.fiber.entry.options.id`). A host whose
 * `register` exists keeps the legacy namespace path bit for bit — the two
 * shapes never mix, because they store the config in different places.
 */
import type { SidebarqaSettingsScope, SidebarqaSettingsService } from './context-types.ts'
import { unwrapVolatile } from './live-config.ts'

/** One addressed view (declared namespace, or profile entry): the resolved value plus the revision it was read at. */
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
 * Why the accessible config form is unavailable.
 * - `service-missing`: no `ctx.settings` at all (the caller's `inject` callback
 *   does not run in that deployment, so this is the defensive branch).
 * - `no-form`: neither shape is usable — no namespace registration (as on every
 *   host from `dsh-settings@0.1.7`, and also on one too old for it) AND no
 *   entry-addressed form API. Expected on such a host; not an error.
 * - `no-entry`: the entry-addressed shape is there, but this plugin could not
 *   name its own profile row (`ctx.fiber.entry.options.id`), so nothing can be
 *   addressed. Genuinely surprising — worth an informational line.
 * - `register-failed`: registration itself refused (duplicate namespace, schema
 *   clash, a provider that throws). Genuinely unexpected: worth a warning.
 */
export type SidebarqaSettingsSeamReason = 'service-missing' | 'no-form' | 'no-entry' | 'register-failed'

/**
 * The user-facing refusal for a settings seam that could not open.
 *
 * Kept next to the reason vocabulary so a new reason cannot be added without
 * deciding what the panel says about it. The text is deliberately specific:
 * an operator reading it on a 503 should be able to tell whether the host is
 * too old, or whether THIS plugin's row is the odd one out.
 * @param reason - the seam's refusal reason.
 * @returns one English sentence for the `/sidebarqa/api` error envelope.
 */
export function settingsRefusalMessage(reason: SidebarqaSettingsSeamReason): string {
  switch (reason) {
    case 'service-missing':
      return 'this host exposes no settings service'
    case 'no-entry':
      return 'this host edits plugin configuration by profile entry id, but this plugin could not resolve its own profile row'
    case 'register-failed':
      return 'this host refused the sidebarqa settings namespace registration'
    case 'no-form':
      return 'this host exposes no editable settings form for this plugin (no namespace registration, and no profile-entry form)'
  }
}

/** The probe result: an opened scope and/or face, or why there is none. */
export type SidebarqaSettingsSeam<T> =
  | { ok: true; kind: 'namespace'; scope: SidebarqaSettingsScope<T>; face: SidebarqaConfigFace }
  | { ok: true; kind: 'entry'; face: SidebarqaConfigFace }
  | { ok: false; reason: SidebarqaSettingsSeamReason; error?: unknown }

/**
 * Build the read/write face over an already-registered namespace.
 *
 * `describe` / `update` are probed separately: a host that registers namespaces
 * may still drop either one, and every call site here must degrade instead of
 * throwing an opaque `… is not a function` from inside a route handler. The same
 * face serves both shapes — only the key differs (a declared namespace, or the
 * plugin's own profile entry id).
 * @param service - the (structurally probed) settings service.
 * @param ns - the namespace OR profile entry id this face reads and writes.
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
          // A descriptor value is data: unwrap any live ref the host handed back
          // (a host whose settings store resolves volatile fields). `unwrapVolatile`
          // passes plain values through unchanged.
          value: unwrapVolatile((descriptor as { value?: unknown }).value),
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
 * Probe the settings service and, when it can carry this plugin's config, open
 * the matching face.
 *
 * Two host shapes, one result type:
 * - a host with namespace registration (`dsh-settings` ≤ 0.1.6): the legacy
 *   `register(ns, schema)` path, which also yields the read scope.
 * - a host without it (`dsh-settings` ≥ 0.1.7): the SAME `describe`/`update`
 *   face addressed by the plugin's profile ENTRY ID (`entryId`). The caller owns
 *   the read source in that mode — the live `Config` refs, not a namespace — so
 *   no scope is returned.
 *
 * Every branch returns a typed value; only the legacy path can throw, and that
 * throw is caught and reported. `service-missing` cannot really happen from the
 * caller's `inject` callback, and it is reported rather than assumed away.
 * @param service - `ctx.settings`, read structurally (never trusted by type).
 * @param ns - the namespace to register (`sidebarqa`).
 * @param schema - the plugin's Config schema (schemastery, all fields volatile).
 * @param entryId - this plugin's profile row id, when the caller can name it.
 * @returns the opened seam, or a typed refusal that never throws.
 */
export function openSettingsSeam<T>(
  service: unknown,
  ns: string,
  schema: unknown,
  entryId?: string,
): SidebarqaSettingsSeam<T> {
  if (service === null || service === undefined) return { ok: false, reason: 'service-missing' }
  const probe = service as Partial<SidebarqaSettingsService>
  if (typeof probe.register === 'function') {
    try {
      const scope = probe.register<T>(ns, schema)
      return { ok: true, kind: 'namespace', scope, face: faceOf(probe, ns) }
    } catch (error) {
      return { ok: false, reason: 'register-failed', error }
    }
  }
  // No namespace registration: the 0.1.7+ shape. It can only be opened when the
  // host exposes both halves of the form API AND we can name our own row.
  if (typeof probe.describe !== 'function' || typeof probe.update !== 'function') {
    return { ok: false, reason: 'no-form' }
  }
  if (entryId === undefined || entryId === '') return { ok: false, reason: 'no-entry' }
  return { ok: true, kind: 'entry', face: faceOf(probe, entryId) }
}
