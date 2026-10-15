/**
 * dsh-sidebar-qa host half: the /sidebarqa JSON API (the context method — the
 * three history strategies — plus title and config) and the `sidebarqa`
 * settings namespace (fast-model channel / budget / window / strategy). The
 * context method reads the main session's current model surface through
 * `ctx.sessionQuery.readSurface` and, per strategy:
 * - `inherit`: nothing to assemble — the client forks the parent instead.
 * - `compressed`: compress the EARLIER window with a fast no-thinking model
 *   through `ctx.llm.stream` and keep the RECENT band verbatim.
 * - `trim`: keep the last `trimWindowMessages` segments verbatim, no model.
 * Any failure degrades to `{ degraded: true }` — the client then skips the
 * context block and still answers.
 *
 * Both the context and the title method accept an optional `locale` field
 * ('zh' | 'en'): the host has no locale signal of its own, so the client sends
 * the active DSH language and the host picks the matching prompt bundle. An
 * absent field means 'zh' — a pre-i18n client keeps today's exact behavior.
 *
 * The route passes the same browser-trust fence as the /api gateway
 * (Host-header loopback or the connection row's `trustedHosts`).
 */
import type { IncomingMessage } from 'node:http'
import type { Context } from './context-types.ts'
import {
  SIDEBARQA_DEFAULTS,
  SIDEBARQA_SETTINGS_NS,
  SidebarqaPrefsSchema,
  type SidebarqaConfig,
  type SidebarqaHistoryStrategy,
  type SidebarqaLiveConfig,
} from './config.ts'
import {
  assembleText,
  BACKGROUND_SEGMENT_MAX,
  backgroundSystem,
  buildTrimContext,
  composeSummary,
  extractSegments,
  formatBackground,
  formatSegments,
  RECENT_SEGMENT_MAX,
  splitRecent,
} from './summarize.ts'
import { liveConfigOf, liveConfigReader, unwrapVolatile } from './live-config.ts'
import {
  openSettingsSeam,
  settingsRefusalMessage,
  type SidebarqaConfigFace,
  type SidebarqaSettingsSeamReason,
} from './settings-face.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { readJsonBody, requireString, SidebarqaError, writeError, writeJson, writeOk } from './wire.ts'
import {
  boundTitleInput,
  normalizeTitle,
  TITLE_MAX_BYTES,
  titleSystem,
} from './title.ts'
import { promptLocaleOf } from './prompt-locale.ts'
import type {
  SidebarqaCatalog,
  SidebarqaLlmMessage,
  SidebarqaLlmModel,
  SidebarqaSettingsScope,
} from './context-types.ts'

export { SIDEBARQA_DEFAULTS, SIDEBARQA_SETTINGS_NS } from './config.ts'
export type { SidebarqaConfig, SidebarqaHistoryStrategy, SidebarqaReasoningEffort } from './config.ts'
export type { Context } from './context-types.ts'
export { PROMPTS, promptLocaleOf, promptsOf, QUESTION_LABELS } from './prompt-locale.ts'
export type { PromptBundle, PromptLocale } from './prompt-locale.ts'
export {
  assembleText,
  BACKGROUND_SYSTEM,
  backgroundSystem,
  buildTrimContext,
  composeSummary,
  extractSegments,
  formatBackground,
  formatSegments,
  splitRecent,
  textOfEvent,
} from './summarize.ts'
export { TITLE_SYSTEM, boundTitleInput, buildTitleInput, normalizeTitle, titleSystem, truncateTitleUtf8 } from './title.ts'

/**
 * The plugin's OWN cordis config schema, i.e. every user-facing knob
 * ({@link SidebarqaPrefsSchema}, whose fields are all `volatile`).
 *
 * DSH ≥ `0.1.7-alpha.1` derives the editable form from this export and stores
 * the values in the plugin's profile row; the runtime then hands `apply` one
 * live ref per field. Exported under the name cordis reads (`Config`) — the
 * same object doubles as the legacy `sidebarqa` namespace schema on hosts that
 * still accept runtime namespace registration (`src/settings-face.ts`).
 */
export const Config = SidebarqaPrefsSchema

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-sidebar-qa'

/** Services required before mounting: the webserver routes, the session query engine, the llm runtime, and the loader's connection row (trust fence). */
export const inject = ['webServer', 'sessionQuery', 'llm', 'loader']

/** How long a summarize call may run before degrading. */
const SUMMARIZE_TIMEOUT_MS = 8000

/** How long a title call may run before degrading. */
const TITLE_TIMEOUT_MS = 8000

/** Result of one context call (the client branches on `degraded`). */
export interface SidebarqaContextResult {
  degraded: boolean
  /** The injected context text (`null` for `inherit` or on failure). */
  text: string | null
  sourceSeq: number
  reason?: string
}

/** Result of one title call (the client branches on `degraded`). */
export interface TitleResult {
  degraded: boolean
  title: string | null
  reason?: string
}

/** One cached summary entry. */
interface CacheEntry {
  sourceSeq: number
  summary: string
}

/** One API method dispatch table entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/** Generate a unique message id for a hand-built llm message. */
function randomId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID()
  return `sq-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Build a user-role message carrying the surface text. */
function userMessage(text: string): SidebarqaLlmMessage {
  return {
    id: randomId(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-sidebar-qa' },
  }
}

/**
 * The non-loopback authorities this deployment serves, for the /api trust fence.
 *
 * Matched on the row's `id`, not on `name`: the web-app bundle mounts that row as
 * `id: connection` with `name: '@deepseek-ai/dsh-client-connection'`
 * (`packages/bundle/web-app/cordis.patch.yml`), so the `name === 'connection'` test
 * this used to do never matched anything and the fence silently degraded to
 * loopback-only for every LAN or custom-Host browser.
 *
 * The PRIMARY source is `webRuntime.trustedHosts`, because the row's own config is
 * NOT a list: the shipped patch declares `trustedHosts: !!js ctx.webRuntime.
 * trustedHosts`, and `entry.options.config` keeps that expression UNEVALUATED
 * (evaluation happens in the loader's `internal/config` hook, against the fiber's
 * config). Reading it as if it were an array is worse than not reading it at all —
 * a non-array reaches `isTrustedAuthority`'s `.some()` and throws, and the fence
 * runs outside the route's try/catch, so the request would HANG rather than answer.
 * Hence the array check on every source, including the row fallback kept for a
 * deployment whose patch layer replaced the expression with a literal list.
 * @param ctx - the host plugin context.
 * @returns the trusted authorities; `[]` means loopback-only.
 */
function trustedHostsOf(ctx: Context): string[] {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

  const fromRuntime = strings(ctx.get('webRuntime')?.trustedHosts)
  if (fromRuntime.length > 0) return fromRuntime

  for (const entry of ctx.loader.entries()) {
    if (entry.options.id !== 'connection') continue
    return strings(entry.options.config?.trustedHosts)
  }
  return []
}

/**
 * Build the API method table bound to the plugin context and its cache.
 * @param ctx - the host plugin context.
 * @param getConfig - the live config reader (see `apply`).
 * @param cache - the per-session summary cache.
 * @param getConfigFace - the opened settings face, when the host offers one.
 * @param getRefusal - why it does not, when that is known.
 */
function buildApi(
  ctx: Context,
  getConfig: () => SidebarqaConfig,
  cache: Map<string, CacheEntry>,
  getConfigFace: () => SidebarqaConfigFace | undefined,
  getRefusal: () => SidebarqaSettingsSeamReason | undefined,
): Record<string, ApiMethod> {
  return {
    config: (): SidebarqaConfig => getConfig(),
    catalog: async (): Promise<SidebarqaCatalog> => {
      const providers = ctx.llm.listProviders().map(async (provider) => {
        let models: readonly SidebarqaLlmModel[] = []
        try {
          models = await ctx.llm.listModels(provider.id)
        } catch {
          // A route that cannot enumerate its models still shows up (empty
          // model list) so the user can name the provider before its models load.
        }
        return { provider: provider.id, displayName: provider.name, models }
      })
      return { providers: await Promise.all(providers) }
    },
    'config.get': (): { value?: unknown; revision?: number } => {
      // The face's view is the host's RESOLVED value plus the revision a write
      // must echo; when the face carries no value (or there is no face at all)
      // the live config still answers, so a read-only host shows real values
      // rather than a permanently loading panel.
      const view = getConfigFace()?.get()
      return { value: view?.value ?? getConfig(), revision: view?.revision }
    },
    'config.update': async (payload): Promise<{ value?: unknown; revision?: number }> => {
      const face = getConfigFace()
      if (face === undefined) {
        throw new SidebarqaError(
          'settings-rejected',
          settingsRefusalMessage(getRefusal() ?? 'no-form'),
          503,
        )
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidebarqaError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await face.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'SETTINGS_CONFLICT') {
          throw new SidebarqaError('settings-conflict', error instanceof Error ? error.message : String(error), 409)
        }
        throw new SidebarqaError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    context: async (payload): Promise<SidebarqaContextResult> => {
      const mainSessionId = requireString(payload, 'mainSessionId')
      const record = payload as {
        strategy?: unknown
        provider?: unknown
        model?: unknown
        budgetTokens?: unknown
        locale?: unknown
      }
      // The language of the PROMPTS and their structural markers. Absent (a
      // client that predates i18n) resolves to 'zh' — byte-identical to the
      // pre-i18n behavior; the answer's own language is decided by the intro
      // the client injects, from the user's question.
      const locale = promptLocaleOf(record.locale)
      const config = getConfig()
      const strategy: SidebarqaHistoryStrategy =
        record.strategy === 'inherit' || record.strategy === 'trim' ? record.strategy : 'compressed'

      // `inherit` needs no context text — the client forks the parent and the
      // full history travels with the seed; there is nothing to assemble here.
      if (strategy === 'inherit') {
        return { degraded: false, text: null, sourceSeq: -1 }
      }

      const provider = typeof record.provider === 'string' && record.provider !== ''
        ? record.provider
        : config.summarizeProvider
      const model = typeof record.model === 'string' && record.model !== ''
        ? record.model
        : config.summarizeModel
      const budgetTokens = typeof record.budgetTokens === 'number' && Number.isInteger(record.budgetTokens) && record.budgetTokens > 0
        ? record.budgetTokens
        : config.summarizeBudgetTokens

      // Read the main session's current model surface (excludes tool/reasoning noise).
      const surface = await ctx.sessionQuery.readSurface(mainSessionId)
      const sourceSeq = surface.capturedThroughSeq ?? -1

      // `trim`: the last N segments verbatim — deterministic and free, no model.
      if (strategy === 'trim') {
        const text = buildTrimContext(extractSegments(surface.events), config.trimWindowMessages, undefined, locale)
        if (text === '') return { degraded: true, text: null, sourceSeq, reason: 'empty-surface' }
        return { degraded: false, text, sourceSeq }
      }

      // `compressed`: asymmetric window — the RECENT messages pass through
      // near-verbatim (they anchor the follow-up to the latest state); only the
      // EARLIER background goes to the fast model for compression.
      // The locale is part of the key: without it a zh→en switch would keep
      // serving the cached Chinese summary until the parent produces a new
      // message. (This Map has no eviction policy; the axis at most doubles it,
      // and each entry is a single summary string.)
      const cacheKey = `${strategy}:${locale}:${mainSessionId}`
      const cached = cache.get(cacheKey)
      if (cached !== undefined && cached.sourceSeq === sourceSeq) {
        return { degraded: false, text: cached.summary, sourceSeq }
      }

      const { earlier, recent } = splitRecent(extractSegments(surface.events), config.recentWindowMessages)
      const recentText = formatSegments(recent, RECENT_SEGMENT_MAX, locale)
      // Hand the background to the model NEWEST-FIRST so the current progress
      // (the tail of `earlier`, just before the verbatim recent band) sits at
      // the strongest attention position instead of the opening topic.
      const earlierText = formatBackground(earlier, config.backgroundWindowMessages, BACKGROUND_SEGMENT_MAX, locale)

      // Compress the background only when there is earlier content AND a provider.
      // Any failure here leaves the background empty — the verbatim recent window
      // still carries the current state, so the ask is never blocked.
      let background = ''
      if (earlierText.trim() !== '' && provider !== '') {
        try {
          const chunks = ctx.llm.stream({
            provider,
            model,
            messages: [userMessage(earlierText)],
            system: backgroundSystem(locale),
            maxTokens: budgetTokens,
            reasoningEffort: config.summarizeReasoningEffort,
            signal: AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS),
          })
          const assembled = await assembleText(chunks)
          if (!assembled.failed) background = assembled.text.trim()
        } catch {
          // background stays empty; the recent window still carries the answer
        }
      }

      const text = composeSummary(background, recentText, locale)
      if (text.trim() === '') {
        return { degraded: true, text: null, sourceSeq, reason: 'empty-surface' }
      }
      cache.set(cacheKey, { sourceSeq, summary: text })
      return { degraded: false, text, sourceSeq }
    },
    title: async (payload): Promise<TitleResult> => {
      const text = requireString(payload, 'text')
      const record = payload as { provider?: unknown; model?: unknown; budgetTokens?: unknown; locale?: unknown }
      const locale = promptLocaleOf(record.locale)
      const config = getConfig()
      // The title reuses the summarize route (fixed flash / thinking off); the
      // client resolves the inherited provider, and the model defaults here.
      const provider = typeof record.provider === 'string' && record.provider !== ''
        ? record.provider
        : config.summarizeProvider
      const model = typeof record.model === 'string' && record.model !== ''
        ? record.model
        : config.summarizeModel
      const budgetTokens = typeof record.budgetTokens === 'number' && Number.isInteger(record.budgetTokens) && record.budgetTokens > 0
        ? record.budgetTokens
        : config.titleBudgetTokens

      // No provider → degrade; the client keeps the placeholder title.
      if (provider === '') return { degraded: true, title: null, reason: 'no-provider' }
      try {
        const chunks = ctx.llm.stream({
          provider,
          model,
          messages: [userMessage(boundTitleInput(text))],
          system: titleSystem(locale),
          maxTokens: budgetTokens,
          reasoningEffort: config.summarizeReasoningEffort,
          signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
        })
        const assembled = await assembleText(chunks)
        if (assembled.failed || assembled.text.trim() === '') {
          return { degraded: true, title: null, reason: assembled.failed ? 'stream' : 'empty' }
        }
        const title = normalizeTitle(assembled.text, TITLE_MAX_BYTES)
        if (title === '') return { degraded: true, title: null, reason: 'empty-title' }
        return { degraded: false, title }
      } catch {
        return { degraded: true, title: null, reason: 'error' }
      }
    },
  }
}

/**
 * Read one legacy settings namespace as a plain config.
 *
 * `unwrapVolatile` is not decoration: the schema handed to `register` is the
 * volatile one, and a provider that resolves it itself would hand back refs —
 * `writeJson` would serialize those as `{}` and the panel would come up empty.
 * Defaults fill anything the namespace does not carry.
 * @param scope - the registered namespace scope.
 * @returns a reader that always answers a full config object.
 */
function scopeReader(scope: SidebarqaSettingsScope<SidebarqaConfig>): () => SidebarqaConfig {
  return () => {
    const value = unwrapVolatile(scope.get())
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return SIDEBARQA_DEFAULTS
    return { ...SIDEBARQA_DEFAULTS, ...(value as Partial<SidebarqaConfig>) }
  }
}

/**
 * This plugin's own profile row id — the key DSH ≥ `0.1.7-alpha.1` addresses a
 * configuration form by.
 *
 * `entry.options.id` (NOT `entry.id`, which is prefixed with the owning tree's
 * path): the settings service looks its entry up as
 * `configEditor.entries().find(row => row.options.id === ns)`
 * (`packages/settings/settings/src/index.ts`). Read lazily and defensively —
 * below a bare `plugin()` call there is no row at all, which is a refusal, not
 * a crash.
 * @param ctx - the plugin context (its fiber is the loader row's root fiber).
 * @returns the row id, or `undefined` when this mount has no addressable row.
 */
function profileEntryIdOf(ctx: Context): string | undefined {
  const id: unknown = ctx.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Tell the host that this plugin renders its OWN settings card, so the
 * auto-generated form for the entry stays out of the way.
 *
 * This plugin registers a whole page into `settings.section`
 * (`src/client/settings-section.tsx`), with catalog-driven provider/model
 * pickers and localized copy; the schema-derived form would be a second,
 * poorer surface for the same values (the same reason DSH's own
 * `ui-settings` calls this). The method exists only on 0.1.7+, so it is probed
 * by structure, and the returned disposer is registered as an effect to die
 * with the plugin.
 * @param child - the settings-fiber context (owns the effect).
 * @param owner - the plugin's own fiber (the policy is per plugin instance).
 */
function claimOwnSettingsCard(child: Context, owner: Context['fiber']): void {
  const service = child.settings
  const configure = typeof service?.configure === 'function' ? service.configure.bind(service) : undefined
  if (configure === undefined) return
  child.effect(() => {
    try {
      return configure({ auto: false }, owner)
    } catch (error) {
      // A host that refuses the policy simply keeps its auto-generated form.
      console.warn('[dsh-sidebar-qa] could not claim the plugin settings card:', error)
      return undefined
    }
  }, 'dsh-sidebar-qa: own settings card')
}

/**
 * Plugin body: mount the fenced route and the configuration seam.
 * @param ctx - host plugin context (webServer, sessionQuery, llm, loader).
 * @param config - the LIVE plugin config: one volatile ref per field, updated
 *   in place whenever a settings write commits (absent below a bare
 *   `plugin()` call, where defaults apply).
 */
export function apply(ctx: Context, config?: SidebarqaLiveConfig): void {
  // A refusal, never a hang: the fence runs outside the route's try/catch, so
  // anything thrown in here would leave the response unwritten and the request
  // pending forever. Deny instead — the safe direction for a trust check.
  const fence = (req: IncomingMessage): boolean => {
    try {
      return isTrustedApiRequest(req, trustedHostsOf(ctx))
    } catch (error) {
      console.warn('[dsh-sidebar-qa] the /api trust fence failed; refusing the request:', error)
      return false
    }
  }

  // ── User-editable configuration (issue #21) ────────────────────────────────
  // The same 12 knobs are edited through the plugin's own `Config` schema now,
  // which reaches this function as LIVE REFS: reading one is the current value,
  // no reload, no remount. That is the read source whenever no host-side store
  // overrides it (below).
  const live = liveConfigOf(config)
  const readLive = live === undefined ? undefined : liveConfigReader(live)
  let readConfig: () => SidebarqaConfig = readLive ?? (() => SIDEBARQA_DEFAULTS)
  let configFace: SidebarqaConfigFace | undefined
  // Why writes are refused, when they are: the API answers 503 with copy that
  // matches the actual reason instead of the old one-size-fits-all message.
  let settingsRefusal: SidebarqaSettingsSeamReason | undefined

  // The seam is OPTIONAL and its SHAPE is not stable across hosts:
  // `dsh-settings` ≤ 0.1.6 registers plugin-declared namespaces, ≥ 0.1.7 has no
  // registration at all and derives editable fields from the plugin's own
  // `Config` (addressed by profile entry id). So it is probed by STRUCTURE,
  // never by version, and every refusal degrades: the summarize route still
  // answers on the live config or on SIDEBARQA_DEFAULTS. A refusal must never
  // disable the plugin. Both shapes end at the same revision-guarded face —
  // only the addressed key differs — so the webview panel persists edits either
  // way, without silently overwriting a concurrent change.
  ctx.inject(['settings'], (sctx) => {
    const seam = openSettingsSeam<SidebarqaConfig>(
      sctx.settings as unknown,
      SIDEBARQA_SETTINGS_NS,
      SidebarqaPrefsSchema,
      profileEntryIdOf(ctx),
    )
    if (!seam.ok) {
      settingsRefusal = seam.reason
      if (seam.reason === 'register-failed') {
        console.warn('[dsh-sidebar-qa] settings registration failed; using defaults:', seam.error)
      } else if (seam.reason !== 'service-missing') {
        // `service-missing` cannot happen here (cordis only runs this callback
        // once `settings` is provided) — it stays silent. The others are the
        // EXPECTED shape on a host that offers neither seam, so they are one
        // informational line, not a failure.
        console.info(`[dsh-sidebar-qa] ${settingsRefusalMessage(seam.reason)}; the config panel is read-only here`)
      }
      return
    }
    configFace = seam.face
    if (seam.kind === 'namespace') {
      // Legacy host: its namespace store is both the write target and the
      // authoritative read (the entry config is not wired to it), so reads
      // follow the seam rather than the refs.
      const scope = seam.scope
      readConfig = scopeReader(scope)
    } else {
      claimOwnSettingsCard(sctx, ctx.fiber)
      if (readLive === undefined) {
        console.warn(
          '[dsh-sidebar-qa] the runtime handed no volatile config; reads fall back to the schema defaults',
        )
      }
    }
  })
  const getConfig = (): SidebarqaConfig => {
    try {
      return readConfig()
    } catch (error) {
      console.warn('[dsh-sidebar-qa] reading the sidebarqa config failed; using defaults:', error)
      return SIDEBARQA_DEFAULTS
    }
  }

  // ── JSON API ──────────────────────────────────────────────────────────────
  const cache = new Map<string, CacheEntry>()
  const api = buildApi(ctx, getConfig, cache, () => configFace, () => settingsRefusal)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebarqa/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/sidebarqa/api/') ? pathname.slice('/sidebarqa/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new SidebarqaError('not-found', 'unknown sidebarqa API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new SidebarqaError('not-found', `unknown sidebarqa API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-sidebar-qa: /sidebarqa/api routes')
}
