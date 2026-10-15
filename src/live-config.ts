/**
 * Reading the LIVE plugin config — the volatile refs the runtime parses the
 * profile entry's config into (issue #21).
 *
 * DSH ≥ `0.1.7-alpha.1` no longer has a plugin-declared settings namespace: a
 * plugin's editable fields are derived from its own `Config` schema, every
 * field is `volatile()`, and the runtime hands `apply` one ref per field whose
 * value is updated in place when a write commits. So the summarize/title routes
 * read `ref.get()` instead of a namespace scope — no remount, no stale copy.
 *
 * Nothing here throws: a ref that is missing, of the wrong shape, or whose
 * `get()` fails degrades to {@link SIDEBARQA_DEFAULTS} for that field only, so
 * a partially resolved config can never take down a route that used to work on
 * defaults.
 */
import { SIDEBARQA_DEFAULTS, type SidebarqaConfig, type SidebarqaLiveConfig } from './config.ts'

/** The config keys this plugin reads (the defaults object is the single list). */
const CONFIG_KEYS = Object.keys(SIDEBARQA_DEFAULTS) as Array<keyof SidebarqaConfig>

/** Whether a value is a plain data object (not an array, `null`, or a class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Whether a value is a live config reference. Structural, never by class: the
 * refs are created by the schemastery copy bundled into this plugin, but a host
 * that re-parses the config through its own copy produces refs of the same
 * shape (`{ get() }`), and a plain config object must not be mistaken for one.
 * @param value - any config node.
 * @returns whether `value` carries a `get()` method.
 */
function isConfigRef(value: unknown): value is { get(): unknown } {
  return value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
}

/**
 * Deeply replace live refs with the values they currently hold.
 *
 * Used at the two boundaries where a config value becomes DATA: the internal
 * reader here, and the settings face's descriptor views
 * (`src/settings-face.ts`). It is idempotent — plain values pass through
 * unchanged — so it is safe on a host that resolved the config without
 * volatility at all (a namespaced settings store older than the `volatile`
 * projection).
 * @param value - a config value, ref, or nested container.
 * @returns the same shape with every ref unwrapped.
 */
export function unwrapVolatile(value: unknown): unknown {
  if (isConfigRef(value)) return unwrapVolatile(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatile)
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]))
  }
  return value
}

/**
 * Detect the live config the runtime passes to `apply`.
 *
 * EVERY declared key must be a ref: this plugin's schema marks all of them
 * volatile, so a config object with a plain field is some other shape (an
 * older loader handing back the raw row config, or a host that dropped the
 * field) and must not be read as live — half-live reads would silently pin the
 * plugin to defaults for the missing fields.
 * @param config - the second argument the runtime handed `apply`.
 * @returns the live config, or `undefined` when it is not the volatile shape.
 */
export function liveConfigOf(config: unknown): SidebarqaLiveConfig | undefined {
  if (config === null || typeof config !== 'object') return undefined
  const record = config as Record<string, unknown>
  for (const key of CONFIG_KEYS) {
    if (!isConfigRef(record[key])) return undefined
  }
  return config as SidebarqaLiveConfig
}

/**
 * Build the reader for one live config: every call returns a fresh plain
 * object, defaults filling any field whose ref is unreadable or `undefined`.
 * @param refs - the volatile config captured at apply time.
 * @returns a reader that never throws.
 */
export function liveConfigReader(refs: SidebarqaLiveConfig): () => SidebarqaConfig {
  return () => {
    const out: Record<string, unknown> = { ...SIDEBARQA_DEFAULTS }
    const record = refs as unknown as Record<string, unknown>
    for (const key of CONFIG_KEYS) {
      const ref = record[key]
      if (!isConfigRef(ref)) continue
      let value: unknown
      try {
        value = unwrapVolatile(ref.get())
      } catch {
        // A broken ref keeps this field's default; the rest still read.
        continue
      }
      if (value !== undefined) out[key] = value
    }
    return out as unknown as SidebarqaConfig
  }
}
