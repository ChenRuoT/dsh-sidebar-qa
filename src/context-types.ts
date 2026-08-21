/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module 'cordis'` augmentations do not reach this Context — and the
 * npm cordis package does not declare the DSH-vendored runtime members
 * (`ctx.effect`, service properties). The members below mirror the actual
 * runtime shapes this plugin touches:
 *
 * - host: webServer (@deepseek-ai/dsh-host-webserver), sessionQuery
 *   (@deepseek-ai/dsh-session-query), llm (@deepseek-ai/dsh-llm), loader
 *   (@cordisjs/plugin-loader), settings (@deepseek-ai/dsh-settings)
 * - client: sessions (runtime ISessions list + create), connection
 *   (api-proxy RPC client), workspaces (runtime IWorkspaces list),
 *   betterSidebar (dsh-better-sidebar registry service)
 * - effect / on: the DSH-vendored cordis lifecycle helper
 *
 * Drift from upstream is contained to this file. Only the leaf fields the
 * plugin reads are declared; live cordis objects are never serialized.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import type { SidebarqaSidebarStore } from './client/ensure-panel.ts'

// ────────────────────────────────────────────────────────────────────────────
// Host faces
// ────────────────────────────────────────────────────────────────────────────

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface SidebarqaWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface SidebarqaWebServer {
  register(route: SidebarqaWebRoute): () => void
}

/** Minimal structural mirror of one session surface event (readSurface output). */
export interface SidebarqaSurfaceEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One atomic live-preferred observation of a session's current model surface. */
export interface SidebarqaSurfaceSnapshot {
  session: unknown
  /** Highest raw-log seq included in the observation, or null for an empty log. */
  capturedThroughSeq: number | null
  events: SidebarqaSurfaceEvent[]
}

/** The sessionQuery service face (only readSurface is needed). */
export interface SidebarqaSessionQueryService {
  readSurface(sessionId: string): Promise<SidebarqaSurfaceSnapshot>
}

/** One message passed to the fast summarize model (structural Message mirror). */
export interface SidebarqaLlmMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: readonly { type: 'text'; text: string }[]
  source: { kind: string; plugin?: string }
}

/** One model request, fully assembled (structural GenerateOptions mirror). */
export interface SidebarqaLlmRequest {
  provider: string
  model: string
  messages: SidebarqaLlmMessage[]
  system?: string
  maxTokens?: number
  reasoningEffort?: string
  signal?: AbortSignal
}

/** One raw streaming chunk emitted by the adapter (structural StreamChunk mirror). */
export type SidebarqaStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; text?: string } }
  | { type: 'usage'; usage: unknown }
  | { type: 'finish'; reason: { kind?: string } }

/** One provider route of the served catalog (structural mirror of LlmProviderInfo). */
export interface SidebarqaLlmProvider {
  /** Provider route key used by {@link SidebarqaLlmRequest.provider}. */
  id: string
  /** Human-readable provider name for selectors. */
  name: string
}

/** One model row of the served catalog (structural mirror of LlmModelInfo). */
export interface SidebarqaLlmModel {
  /** Model id passed to Generate requests. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
}

/** One provider group of the served ad-hoc catalog (provider + its models). */
export interface SidebarqaCatalogProvider {
  provider: string
  displayName: string
  models: readonly SidebarqaLlmModel[]
}

/** The ad-hoc model catalog: every configurable provider with its models. */
export interface SidebarqaCatalog {
  providers: readonly SidebarqaCatalogProvider[]
}

/** The llm service face this plugin uses (stream a one-shot summary call + catalog lookup). */
export interface SidebarqaLlmService {
  stream(options: SidebarqaLlmRequest): AsyncIterable<SidebarqaStreamChunk>
  /** Every provider route with a registered adapter (only the channels that are configured/enabled). */
  listProviders(): readonly SidebarqaLlmProvider[]
  /** The models a provider route can serve ([] for an unregistered route). */
  listModels(provider: string): Promise<readonly SidebarqaLlmModel[]>
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface SidebarqaLoaderEntry {
  options: { name: string; config?: { trustedHosts?: string[] } }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface SidebarqaLoader {
  entries(): Iterable<SidebarqaLoaderEntry>
}

/** The settings namespace scope this plugin reads. */
export interface SidebarqaSettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void): () => void
  /** Merge a partial patch into this namespace's user layer (no revision guard). */
  update(patch: object): Promise<void>
}

/** One registered namespace descriptor surfaced to configuration surfaces. */
export interface SidebarqaSettingsDescriptor {
  ns: string
  value?: unknown
  revision: number
}

/** The settings service face (register + revision-guarded update + describe). */
export interface SidebarqaSettingsService {
  register<T>(ns: string, schema: unknown, options?: object): SidebarqaSettingsScope<T>
  describe(options?: { redactSecrets?: boolean }): SidebarqaSettingsDescriptor[]
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

// ────────────────────────────────────────────────────────────────────────────
// Client faces
// ────────────────────────────────────────────────────────────────────────────

/** Props a custom settings panel receives (mirror of better-sidebar's `settings.render`). */
export interface SidebarqaSettingsRenderProps {
  /** Close the settings popup. */
  close(): void
  /** The feature's own persisted settings blob (better-sidebar's `pluginSettings[id]`). */
  pluginSettings?: Record<string, unknown>
  /** Persist one plugin-owned setting into better-sidebar's `pluginSettings[id]`. */
  updatePluginSetting?(key: string, value: unknown): void
}

/** Declarative settings of a registered tab (mirror of better-sidebar's `settings`). */
export interface SidebarqaSettingsDeclaration {
  /** Custom settings panel rendered in the feature's gear popup (功能配置). */
  render?: (props: SidebarqaSettingsRenderProps) => unknown
}

/** A plugin-contributed sidebar tab (mirror of better-sidebar TabDescriptor). */
export interface SidebarqaTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: unknown | ((size: number) => unknown)
  order?: number
  hidden?: boolean
  single?: boolean
  settings?: SidebarqaSettingsDeclaration
  /**
   * Lifecycle callback (better-sidebar v0.12.0+, `tabLifecycle` feature): fired
   * when the tab is focused — dedupe focus, id safety-net focus, tab-bar click —
   * and, crucially for issue #6, EVEN when `openTab` merely re-focuses an
   * already-active tab (the reducer runs first, then the callback fires
   * unconditionally). The 提问 flow uses it to self-heal a collapsed panel on
   * re-activation after the user manually collapsed it.
   */
  onActivate?: (tab: { id: string; type: string }, scope: { sessionId: string; cwd?: string }) => void
  component: (props: SidebarqaTabComponentProps) => unknown
}

/** Props every tab component receives (mirror of better-sidebar TabComponentProps). */
export interface SidebarqaTabComponentProps {
  ctx: Context
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; path?: string; diff?: unknown; meta?: unknown }
  visible: boolean
  /** The better-sidebar state store (its own, NOT this plugin's localStorage store).
   *  Present at runtime; typed optional so host-half compilation never needs it. */
  store?: SidebarqaSidebarStore
}

/** The betterSidebar registry service published as `ctx.betterSidebar`. */
export interface SidebarqaBetterSidebarService {
  registerTab(descriptor: SidebarqaTabDescriptor): () => void
  /**
   * Open (or focus) a tab. `scope` (v0.12.0+ targeted open) names the session
   * whose sidebar state receives the open — the tab lands there even when that
   * session is not the one on screen, and the UI's active session is not
   * switched. Omitted scope targets the active session. `meta` (v0.13.0+
   * better-sidebar) carries JSON-serializable custom state onto the tab —
   * external plugins use `meta.quote` to hand this panel a pending quote.
   */
  openTab(
    seed: { type: string; title?: string; id?: string; path?: string; url?: string; meta?: unknown },
    scope?: { sessionId: string; cwd?: string },
  ): void
  /**
   * Update one open tab's display fields (better-sidebar v0.12.0+). Unknown
   * tab ids are a no-op. Used to consume a `meta.quote` after it was sent.
   */
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void
}

/** One session list row the client reads (display title + lineage + cwd + activity). */
export interface SidebarqaSessionSummary {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  blank: boolean
  /** Epoch ms of the session's last activity (the left panel's "最近访问" source). */
  updatedAt?: number
}

/** The client session list snapshot this plugin subscribes to. */
export interface SidebarqaSessionListSnapshot {
  current: string | undefined
  byId: Record<string, SidebarqaSessionSummary>
}

/** The client sessions service face (list feed + create + open + scope). */
export interface SidebarqaSessionsService {
  list: {
    getSnapshot(): SidebarqaSessionListSnapshot
    subscribe(fn: () => void): () => void
  }
  create(opts: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  open(id: string): void
  /**
   * Resolve an Agent-scoped context view for one listed session (use-and-discard).
   * Returns undefined for a session neither listed nor already scoped.
   */
  scope(sessionId: string): Context | undefined
  /** Resolve the session face behind an Agent-scoped context (from {@link scope}). */
  sessionOf(ctx: Context): SidebarqaSessionFace | undefined
}

/** One raw session event on the append feed. */
export interface SidebarqaSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** Minimal bare observable (mirror of the runtime ObservableSnapshot for useSyncExternalStore). */
export interface SidebarqaObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** The per-session projection read face (host-computed values by key). */
export interface SidebarqaProjectionsFace {
  /** Identity-stable bare observable for one key (absence = `undefined` snapshot). */
  faceOf(key: string): SidebarqaObservableSnapshot<unknown>
}

/** The outward session face (identity + projections; the verbs ride the RPC layer). */
export interface SidebarqaSessionFace {
  sessionId: string
  projections: SidebarqaProjectionsFace
}

/**
 * Host-computed context-pressure projection (mirror of dsh-token-meter's
 * `contextPressure`): how full the next request's prompt would be.
 */
export interface SidebarqaContextPressure {
  /** Prompt-side sample tokens of the last request (present after the first usage report). */
  pressureTokens?: number
  /** Sample + surface movement since; what the NEXT request would cost. */
  projectedTokens?: number
  /** The serving route's context window in tokens. */
  contextWindow?: number
}

/** Host-computed context composition (mirror of dsh-token-meter's `contextBreakdown`). */
export interface SidebarqaContextBreakdown {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** RPC result slot mirror (`RpcResult<T>` on the wire). */
export type SidebarqaRpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Unary response mirror (`RpcResponse<T>` on the wire). */
export interface SidebarqaRpcResponse<T> {
  result: SidebarqaRpcResult<T>
}

/** One history page entry. */
export interface SidebarqaHistoryEntry {
  event: SidebarqaSessionEvent
  view?: unknown
}

/** Complete model selection for one session. */
export interface SidebarqaModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One adapter-owned reasoning level (the effort vocabulary a model advertises). */
export interface SidebarqaModelReasoningEffort {
  id: string
  name: string
  description?: string
}

/** The reasoning metadata one catalog model advertises. */
export interface SidebarqaModelReasoning {
  /** The effort applied when none is chosen; omitted models keep the provider default. */
  defaultEffort?: string
  efforts: readonly SidebarqaModelReasoningEffort[]
}

/** One model row in a provider group. */
export interface SidebarqaCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: SidebarqaModelReasoning
}

/** One provider group of the advisory directory. */
export interface SidebarqaModelProviderGroup {
  id: string
  name: string
  models: readonly SidebarqaCatalogModel[]
}

/** One provider-local catalog failure from the last directory load. */
export interface SidebarqaModelCatalogFailure {
  id: string
  name: string
  message?: string
}

/** The advisory model directory one `session.models` call returns (mirror of SessionModels). */
export interface SidebarqaSessionModels {
  current: SidebarqaModelSelection | null
  /** Whether an adapter serves the current selection's provider (null before the first load). */
  routable: boolean | null
  groups: readonly SidebarqaModelProviderGroup[]
  failures: readonly SidebarqaModelCatalogFailure[]
}

/** The sessions RPC surface the client reaches through `ctx.connection.api`. */
export interface SidebarqaSessionsRpc {
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }):
    Promise<SidebarqaRpcResponse<{ sessionId: string; agentPreset?: string }>>
  /**
   * Fork a session from its latest completed-turn boundary (or an `atSeq`
   * anchor): the child inherits the parent's full history as a frozen seed,
   * so its first request reuses the parent's message prefix — DeepSeek's
   * automatic prefix cache hits. Fails with `fork-unavailable` when the
   * source has no completed turn (e.g. the agent is mid-turn).
   */
  fork(payload: { sessionId: string; atSeq?: number }):
    Promise<SidebarqaRpcResponse<{ sessionId: string }>>
  rename(payload: { sessionId: string; title: string }):
    Promise<SidebarqaRpcResponse<{ title: string; seq: number }>>
  selectModel(payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }):
    Promise<SidebarqaRpcResponse<{ selected: SidebarqaModelSelection }>>
  models(payload: { sessionId: string }):
    Promise<SidebarqaRpcResponse<SidebarqaSessionModels>>
  prompt(payload: { sessionId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[]; clientTimeZone?: string }):
    Promise<SidebarqaRpcResponse<{ accepted: true }>>
  history(payload: { sessionId: string; beforeSeq?: number; maxMessages?: number }):
    Promise<SidebarqaRpcResponse<{ events: SidebarqaHistoryEntry[]; hasMore: boolean }>>
}

/** The connection handle face (only the sessions RPC is needed). */
export interface SidebarqaConnectionHandle {
  api: {
    sessions: SidebarqaSessionsRpc
  }
}

/** One workspace row the client reads (workspaceId + accounted session ids). */
export interface SidebarqaWorkspaceView {
  workspaceId: string
  title: string
  sessionIds: string[]
}

/** The client workspaces list snapshot. */
export interface SidebarqaWorkspaceListSnapshot {
  items: SidebarqaWorkspaceView[]
  /**
   * Registry-global archive set (mirror of the runtime's
   * `archivedSessionIds`): sessions hidden from grouping surfaces (they leave
   * every workspace's `sessionIds`) but still accounted. The 追问记录 tab uses
   * it to label archived sessions whose mapping row survives the archive.
   */
  archivedSessionIds: readonly string[]
}

/** The client workspaces service face (only the list feed is needed). */
export interface SidebarqaWorkspacesService {
  list: {
    getSnapshot(): SidebarqaWorkspaceListSnapshot
    subscribe(fn: () => void): () => void
  }
}

/**
 * The client locale service face (mirror of @deepseek-ai/dsh-client-locale's
 * LocaleRuntime — only the slices this plugin touches). Following it makes the
 * plugin's copy track the Host-backed language preference (`locale.preference`
 * in settings.yaml) rather than the raw browser language, exactly like every
 * first-party DSH surface and like dsh-better-sidebar's own panel chrome.
 *
 * `getSnapshot()` is narrowed to `{ active }` on purpose: the real runtime also
 * carries `locales` / `revision`, but a narrower mirror is less drift surface,
 * and `active` is the only stable primitive the uSES subscription may return.
 */
export interface SidebarqaLocaleService {
  /** Current immutable locale snapshot (`active` is 'zh' | 'en' today). */
  getSnapshot(): { active: string }
  /** Subscribe to locale switches; returns the disposer. */
  subscribe(fn: () => void): () => void
  /** Register one locale's dictionary for a namespace; returns the disposer. */
  register(ns: string, locale: string, dict: Record<string, string>): () => void
}

// ────────────────────────────────────────────────────────────────────────────
// Context augmentation (dual cordis scope)
// ────────────────────────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    webServer: SidebarqaWebServer
    sessionQuery: SidebarqaSessionQueryService
    llm: SidebarqaLlmService
    loader: SidebarqaLoader
    settings: SidebarqaSettingsService
    sessions: SidebarqaSessionsService
    connection: SidebarqaConnectionHandle
    workspaces: SidebarqaWorkspacesService
    /**
     * The client-side sidebar registry: external plugins register tab types
     * here. Provided by dsh-better-sidebar's client half; undefined on the
     * host side. The plugin requires it (hard peer dependency).
     */
    betterSidebar: SidebarqaBetterSidebarService
    /**
     * The DSH client locale service (`@deepseek-ai/dsh-client-locale`): the
     * plugin's copy follows its active language and its dictionaries register
     * under the `sidebarQa` namespace. Client side only, and OPTIONAL — the
     * client half soft-injects it (`ctx.inject(['locale'], …)`) so a deployment
     * without the locale plugin still runs, falling back to the browser
     * language. See `src/client/locales.ts`.
     */
    locale: SidebarqaLocaleService
    /**
     * Subscribe to the session append feed (mirror of the cordis event API):
     * the listener receives every appended session event with the LIVE
     * Session instance that appended it. Returns the disposer.
     */
    on(event: string, listener: (session: unknown, event: SidebarqaSessionEvent) => void): () => void
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
