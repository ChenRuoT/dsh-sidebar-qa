/**
 * dsh-sidebar-qa host half: the /sidebarqa JSON API (the summarize method only) and
 * the `sidebarqa` settings namespace (fast-model channel / budget / window). The
 * summarize method reads the main session's current model surface through
 * `ctx.sessionQuery.readSurface`, compresses it with a fast no-thinking model
 * through `ctx.llm.stream`, and caches by (mainSessionId, sourceSeq). Any
 * failure degrades to `{ degraded: true }` — the client then skips the summary
 * block and still answers.
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
} from './config.ts'
import {
  assembleText,
  BACKGROUND_SEGMENT_MAX,
  BACKGROUND_SYSTEM,
  composeSummary,
  extractSegments,
  formatBackground,
  formatSegments,
  RECENT_SEGMENT_MAX,
  splitRecent,
} from './summarize.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { readJsonBody, requireString, SidebarqaError, writeError, writeJson, writeOk } from './wire.ts'
import type { SidebarqaLlmMessage, SidebarqaSettingsScope } from './context-types.ts'

export { SIDEBARQA_DEFAULTS, SIDEBARQA_SETTINGS_NS } from './config.ts'
export type { SidebarqaConfig } from './config.ts'
export type { Context } from './context-types.ts'
export {
  assembleText,
  BACKGROUND_SYSTEM,
  composeSummary,
  extractSegments,
  formatBackground,
  formatSegments,
  splitRecent,
  textOfEvent,
} from './summarize.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-sidebar-qa'

/** Services required before mounting: the webserver routes, the session query engine, the llm runtime, and the loader's connection row (trust fence). */
export const inject = ['webServer', 'sessionQuery', 'llm', 'loader']

/** How long a summarize call may run before degrading. */
const SUMMARIZE_TIMEOUT_MS = 8000

/** Result of one summarize call (the client branches on `degraded`). */
export interface SummarizeResult {
  degraded: boolean
  summary: string | null
  sourceSeq: number
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

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

/** Build the API method table bound to the plugin context and its cache. */
function buildApi(
  ctx: Context,
  getConfig: () => SidebarqaConfig,
  cache: Map<string, CacheEntry>,
): Record<string, ApiMethod> {
  return {
    config: (): SidebarqaConfig => getConfig(),
    summarize: async (payload): Promise<SummarizeResult> => {
      const mainSessionId = requireString(payload, 'mainSessionId')
      const record = payload as { provider?: unknown; model?: unknown; budgetTokens?: unknown }
      const config = getConfig()
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

      // Cache hit: same source seq → reuse the previous summary.
      const cached = cache.get(mainSessionId)
      if (cached !== undefined && cached.sourceSeq === sourceSeq) {
        return { degraded: false, summary: cached.summary, sourceSeq }
      }

      // Asymmetric window: the RECENT messages pass through near-verbatim (they
      // anchor the follow-up to the latest state); only the EARLIER background
      // goes to the fast model for compression.
      const { earlier, recent } = splitRecent(extractSegments(surface.events), config.recentWindowMessages)
      const recentText = formatSegments(recent, RECENT_SEGMENT_MAX)
      // Hand the background to the model NEWEST-FIRST so the current progress
      // (the tail of `earlier`, just before the verbatim recent band) sits at
      // the strongest attention position instead of the opening topic.
      const earlierText = formatBackground(earlier, config.backgroundWindowMessages, BACKGROUND_SEGMENT_MAX)

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
            system: BACKGROUND_SYSTEM,
            maxTokens: budgetTokens,
            ...(config.summarizeReasoningEffort !== '' ? { reasoningEffort: config.summarizeReasoningEffort } : {}),
            signal: AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS),
          })
          const assembled = await assembleText(chunks)
          if (!assembled.failed) background = assembled.text.trim()
        } catch {
          // background stays empty; the recent window still carries the answer
        }
      }

      const summary = composeSummary(background, recentText)
      if (summary.trim() === '') {
        return { degraded: true, summary: null, sourceSeq, reason: 'empty-surface' }
      }
      cache.set(mainSessionId, { sourceSeq, summary })
      return { degraded: false, summary, sourceSeq }
    },
  }
}

/**
 * Plugin body: mount the fenced route and the optional settings namespace.
 * @param ctx - host plugin context (webServer, sessionQuery, llm, loader).
 */
export function apply(ctx: Context): void {
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHostsOf(ctx))

  // ── User-editable configuration ───────────────────────────────────────────
  // The `sidebarqa` namespace is optional: deployments without a settings service
  // (or a schemastery mismatch) fall back to SIDEBARQA_DEFAULTS and the summarize
  // route still answers. The registration is defensive — a refusal must never
  // disable the plugin.
  let configScope: SidebarqaSettingsScope<SidebarqaConfig> | undefined
  const settingsService = ctx.get('settings') as unknown as
    | { register<T>(ns: string, schema: unknown, options?: object): SidebarqaSettingsScope<T> }
    | undefined
  if (settingsService !== undefined) {
    try {
      configScope = settingsService.register<SidebarqaConfig>(SIDEBARQA_SETTINGS_NS, SidebarqaPrefsSchema)
    } catch (error) {
      console.warn('[dsh-sidebar-qa] settings registration failed; using defaults:', error)
    }
  }
  const getConfig = (): SidebarqaConfig => {
    try {
      return configScope?.get() ?? SIDEBARQA_DEFAULTS
    } catch {
      return SIDEBARQA_DEFAULTS
    }
  }

  // ── JSON API ──────────────────────────────────────────────────────────────
  const cache = new Map<string, CacheEntry>()
  const api = buildApi(ctx, getConfig, cache)
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
