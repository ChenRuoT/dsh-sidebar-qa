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
 * - client: sessions (runtime ISessions list + scope), remote (the typed
 *   client Remote service and its `session` namespace), workspaces (runtime
 *   IWorkspaces list), betterSidebar (dsh-better-sidebar registry service)
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

/** The client sessions service face (list feed + open + scope). */
export interface SidebarqaSessionsService {
  list: {
    getSnapshot(): SidebarqaSessionListSnapshot
    subscribe(fn: () => void): () => void
  }
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

/**
 * What every generated Remote method resolves to (mirror of
 * `RemoteResult<T>` in `@deepseek-ai/dsh-typert-protocol`). The Remote face
 * folds carrier failures into the error branch itself, so a call only rejects
 * on an assembly fault (arity, an unmounted method) — never on a business or
 * transport error.
 */
export type SidebarqaRemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: object } }

/** One history page entry (a scalar event, unpacked from the wire records). */
export interface SidebarqaHistoryEntry {
  event: SidebarqaSessionEvent
  view?: unknown
}

/** Durable identity of one ordinary session on the journal RPCs. */
export interface SidebarqaSessionAddress {
  kind: 'session'
  sessionId: string
}

/**
 * One packed run of consecutive assistant delta events (`chunkrow/text-chunks`,
 * `chunkrow/reasoning-chunks`, `chunkrow/tool-call-chunks`). The host packs
 * runs into a single record to keep pages small; `session-wire.ts` unpacks them
 * back into per-seq `assistant/chunk` events so the transcript folder stays a
 * pure function of scalar events.
 */
export interface SidebarqaChunkRunEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One history-page record: a raw event, or a packed assistant delta run. */
export type SidebarqaHistoryRecord =
  | { type: 'event'; event: SidebarqaSessionEvent }
  | { type: 'chunks'; event: SidebarqaChunkRunEvent }

/**
 * One frame of an addressed session's live journal: the complete opening
 * window (whose `cursor` is the inclusive log cut every later `page` call must
 * quote), then every event appended after it.
 */
export type SidebarqaFollowFrame =
  | {
    type: 'snapshot'
    cursor: number
    records: readonly SidebarqaHistoryRecord[]
    hasMore: boolean
  }
  | { type: 'event'; event: SidebarqaSessionEvent }

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

/**
 * The advisory model directory the seat renders from. NOT a wire type any
 * more: the host splits it into the Host-generation `session.modelCatalog()`
 * (groups + failures + routable providers + default) and the per-session
 * `modelSelection` projection (`current`). `ModelSelect` recombines the two
 * into this shape so the pure menu helpers keep one directory face.
 */
export interface SidebarqaSessionModels {
  current: SidebarqaModelSelection | null
  /** Whether an adapter serves the current selection's provider (null before the first load). */
  routable: boolean | null
  groups: readonly SidebarqaModelProviderGroup[]
  failures: readonly SidebarqaModelCatalogFailure[]
}

/** The Host-generation model catalog (`session.modelCatalog`). */
export interface SidebarqaModelCatalog {
  /** The selection an unconfigured session runs with. */
  default: SidebarqaModelSelection
  /** Provider routes currently able to serve a request, including empty catalogs. */
  routableProviders: readonly string[]
  groups: readonly SidebarqaModelProviderGroup[]
  failures: readonly SidebarqaModelCatalogFailure[]
}

/**
 * The durable per-session model selection, as the `modelSelection` projection
 * reports it. Published for EVERY listed session through the Host-wide session
 * control stream, so it reads for a follow-up the plugin never opens.
 */
export interface SidebarqaModelSelectionProjection {
  /** Selection consumed by the latest recorded model request. */
  lastUsed: SidebarqaModelSelection | null
  /** Selection the next request should use; falls back to {@link lastUsed}. */
  next: SidebarqaModelSelection | null
}

/**
 * The generated `session` Remote namespace (`ctx.remote.session`), which
 * replaced the removed `ctx.connection.api.sessions` surface. Every method
 * resolves to a flat {@link SidebarqaRemoteResult} — there is no `{ result }`
 * envelope any more.
 */
export interface SidebarqaSessionRemote {
  create(request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }):
    Promise<SidebarqaRemoteResult<{ sessionId: string; agentPreset?: string }>>
  /**
   * Fork a session from its latest completed-turn boundary (or an `atSeq`
   * anchor): the child inherits the parent's full history as a frozen seed,
   * so its first request reuses the parent's message prefix — DeepSeek's
   * automatic prefix cache hits. Fails with `fork-unavailable` when the
   * source has no completed turn (e.g. the agent is mid-turn).
   */
  fork(request: { sessionId: string; atSeq?: number }):
    Promise<SidebarqaRemoteResult<{ sessionId: string }>>
  rename(request: { sessionId: string; title: string }):
    Promise<SidebarqaRemoteResult<{ title: string; seq: number }>>
  selectModel(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }):
    Promise<SidebarqaRemoteResult<{ selected: SidebarqaModelSelection }>>
  /** The Host-generation advisory catalog (no session address: it is global). */
  modelCatalog(): Promise<SidebarqaRemoteResult<SidebarqaModelCatalog>>
  prompt(
    request: {
      /** Client-minted identity persisted on the exact accepted user message. */
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: { type: 'text'; text: string }[]
      clientTimeZone?: string
    },
    signal?: AbortSignal,
  ): Promise<SidebarqaRemoteResult<{ accepted: true }>>
  /**
   * One message-aligned backwards page. `throughSeq` pins the read to a stable
   * log cut and MUST be a cursor the host handed out (a follow snapshot's) —
   * an invented value is rejected, so paging is only reachable behind a live
   * {@link SidebarqaSessionRemote.follow}.
   */
  page(
    request: {
      address: SidebarqaSessionAddress
      throughSeq: number
      beforeSeq?: number
      maxMessages?: number
    },
    signal?: AbortSignal,
  ): Promise<SidebarqaRemoteResult<{ records: readonly SidebarqaHistoryRecord[]; hasMore: boolean }>>
  /** The addressed session's opening window followed by its live appends. */
  follow(
    request: { address: SidebarqaSessionAddress; maxMessages?: number },
    signal?: AbortSignal,
  ): AsyncIterable<SidebarqaFollowFrame>
}

/**
 * The typed client Remote service (`ctx.remote`). Only the `session` namespace
 * is mirrored; reaching it requires BOTH `'remote'` and `'remote.session'` in
 * the plugin's inject list (each namespace is its own cordis service).
 */
export interface SidebarqaRemoteService {
  session: SidebarqaSessionRemote
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
    /**
     * The typed client Remote service (DSH ≥ the `own RPC transport
     * contracts` refactor). It replaced `ctx.connection.api`, whose `api`
     * member no longer exists on the connection handle at all — reading
     * `connection.api.sessions` is what used to crash the panel with
     * "Cannot read properties of undefined (reading 'sessions')".
     */
    remote: SidebarqaRemoteService
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
