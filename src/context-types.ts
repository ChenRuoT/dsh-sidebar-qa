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
import type { SidebarPortOpen } from './client/sidebar-port.ts'

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

/**
 * What the panel body asks of WHICHEVER sidebar backend hosts it.
 *
 * The panels used to reach for `ctx.betterSidebar` directly (title / meta
 * updates) and for better-sidebar's own state store (issue #6 panel healing),
 * which tied them to one backend. The adapter for each backend
 * (`src/client/sidebar-better-sidebar.ts`, `src/client/sidebar-native.ts`)
 * supplies this bridge instead, so a panel never branches on the backend.
 *
 * The three members are exactly the places the two backends differ; everything
 * else a panel needs (its identity, its scope, the pending quote) is already
 * backend-neutral in {@link SidebarqaTabComponentProps}.
 */
export interface SidebarqaSidebarBridge {
  /**
   * Re-push this tab's display title in the current language.
   *
   * better-sidebar stores an OPEN tab's title as a plain string, so the
   * registerTab title thunk never re-runs for it and a language change must
   * re-push. The native backend captures a type's title into the layout record
   * at open time and exposes no per-tab retitle, so its bridge is a no-op — the
   * tab keeps the text it was opened with.
   */
  setTitle(title: string): void
  /**
   * Read this tab's cross-plugin quote and mark it consumed, so a later focus
   * of the same tab does not resurface a stale quote.
   *
   * better-sidebar carries it on the tab's `meta` and clears it with
   * `updateTab`. The native backend carries it in `navigation.params` and has
   * no per-tab update at all, so its bridge remembers what it already handed
   * out. Both return the same validated shape.
   * @returns the quote, or null when absent, already consumed, or malformed.
   */
  takeQuote(): SidebarqaPendingQuote | null
  /**
   * Heal a collapsed host column (issue #6).
   *
   * A type-only open lands the tab inside an invisible collapsed panel, so the
   * mounted panel must expand it. better-sidebar exposes no expansion method,
   * so its bridge patches better-sidebar's own state store; the native
   * `openTab` expands as part of placing the tab, so its bridge reads the
   * reported presentation and does nothing.
   *
   * Called on mount (a freshly opened tab) and on re-activation (the panel was
   * collapsed since this tab's last focus — an open only re-focuses, it never
   * remounts).
   */
  healVisibility(): void
  /**
   * Open (or focus) this plugin's 追问记录 tab for `scope`.
   *
   * The 追问记录 tree offers a "跳转" action: switch the active conversation,
   * then land the history tab in that session's sidebar so the user keeps the
   * tree they were just reading. The panels cannot do that through the cordis
   * context (they do not know which backend is active), so the adapter offers
   * it here.
   * @param scope - the session whose sidebar receives the tab.
   */
  openHistory(scope: { sessionId: string }): void
}

/** The cross-plugin quote shape (mirror of this plugin's `PendingQuote`). */
export interface SidebarqaPendingQuote {
  text: string
  messageId?: string
  role?: string
}

/** Props every tab component receives (the port's neutral form). */
export interface SidebarqaTabComponentProps {
  ctx: Context
  scope: { sessionId: string; cwd?: string }
  /**
   * The tab's identity. Only `id` is carried: the panels need nothing else, and
   * the port deliberately does not expose backend-specific tab fields (a
   * better-sidebar `meta` blob or a native navigation record) to the body.
   */
  tab: { id: string }
  visible: boolean
  /** The better-sidebar state store (its own, NOT this plugin's localStorage store).
   *  Present at runtime; typed optional so host-half compilation never needs it. */
  store?: SidebarqaSidebarStore
  /**
   * The active backend's occurrence: this tab's identity, its activation
   * revision, and the backend's capabilities (the `SidebarPortOpen` of
   * `src/client/sidebar-port.ts`, imported type-only — the port module imports
   * this file for its service faces, and a type-only import keeps that cycle
   * out of the emitted bundle).
   *
   * OPTIONAL at the type level, and every panel guards it: a panel rendered
   * without one must still mount and render (it only loses title refresh, the
   * cross-plugin quote, panel healing, and its own tab opens). That guard is
   * what keeps a half-composed deployment from crashing the whole sidebar.
   */
  sidebar?: SidebarPortOpen
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
  /**
   * Local ownership counts by consumer source; `mainView` counts the main pane's
   * reference to this session. This is what identifies the CURRENT session — see
   * `src/client/current-session.ts`. An absent key means zero.
   */
  retainedBy?: Readonly<Partial<Record<string, number>>>
}

/**
 * The client session list snapshot this plugin subscribes to.
 *
 * Mirrors `SessionListState` from
 * `api/session-controller/src/client/sessions/service.ts:53`. It deliberately has
 * NO `current` field: an earlier revision of this mirror invented one, which both
 * returned `undefined` at runtime AND hid the mistake from the compiler, because
 * the mirror was the only declaration in scope.
 */
export interface SidebarqaSessionListSnapshot {
  /** Host-list order. */
  ids?: readonly string[]
  byId: Record<string, SidebarqaSessionSummary>
  /** Arrival lifecycle: `empty` together with `ready` means "truly no sessions". */
  phase?: string
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

/**
 * The per-session composer input face (`conversation.input.for(actx)`;
 * structural mirror of ui-conversation's `SessionInput`). Only the slices the
 * 「添加到对话」 button touches are restated.
 */
export interface SidebarqaSessionInput {
  /** Live input store. Only `draft` (the clipboard-text projection) is read. */
  state: {
    getSnapshot(): { draft: string }
  }
  /**
   * Replace the WHOLE draft — the input machine's single public write path.
   * `\n` splits paragraphs and the caret lands at the end, but a write whose
   * cleaned text equals the current projection EARLY-RETURNS, so an identical
   * write is a silent no-op that does not move the caret. No phase guard.
   */
  setDraft(text: string): void
  /**
   * The shell-owned Lexical editor. It is a public readonly field of
   * `SessionInputShell` at runtime but is NOT on ui-conversation's frozen
   * `SessionInput` interface — hence OPTIONAL here, with every read guarded.
   * `setDraft` never takes DOM focus; this is how the composer gets it, in the
   * order DSH's own `skeleton/InputBar.tsx` uses. Absent → `draft-insert.ts`
   * falls back to a plain DOM focus on `[data-composer-input]`.
   */
  editor?: {
    getRootElement(): HTMLElement | null
    focus(onDone?: () => void): void
  }
}

/**
 * The `conversation` cordis service published by DSH's ui-conversation
 * (structural mirror of `IConversation`; only the input resolver is needed).
 */
export interface SidebarqaConversationService {
  input: {
    /** Resolve the composer facade for one session-scope ctx (`sessions.scope`). */
    for(actx: Context): SidebarqaSessionInput
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DSH native right sidebar (ui-sidebar-right)
//
// The second sidebar backend. DSH ≥ 0.1.5-alpha.1 ships its own dockable right
// column (`@deepseek-ai/dsh-client-ui-sidebar-right`) whose extension points are
// two injected cordis services — `sidebarRightTabs` (the type registry) and
// `sidebarRight` (navigation) — plus a render seat declared on DSH's own slot
// registry. A tab type registers in TWO stages under one implementation `id`:
// the definition into `sidebarRightTabs`, the body into the keyed
// `sidebar.right.pane.tab` slot.
//
// These are structural mirrors only. The client bundle must NOT value-import
// `@deepseek-ai/dsh-client-ui-sidebar-right/client` (client-bundle purity gate):
// its `/client` export carries runtime code, and DSH policy forbids a feature
// plugin from requesting another feature plugin's values. The services are
// reached through `ctx.get()` exactly like `conversation`.
// ────────────────────────────────────────────────────────────────────────────

/**
 * One registered tab type's static face (mirror of ui-sidebar-right's
 * `SidebarRightTabDefinition`). Only the fields this plugin sets are restated.
 */
export interface SidebarqaSidebarRightTabDefinition {
  /** Implementation identity; unique across every registration and the key the body registers under. */
  id: string
  /** Type discriminator: what `openTab` names. */
  kind: string
  /**
   * Resource-address globs this type recognizes; omitted for a PAGE type, which
   * is opened by kind and recognizes no address. This plugin registers a page
   * type — its content (`ask` / `history`) is not addressable.
   */
  patterns?: readonly string[]
  /**
   * Priority band. `extension` (the default, and correct for a third-party
   * type) outranks every viewer DSH ships and may take over a `builtin` kind.
   */
  priority?: 'extension' | 'builtin' | 'fallback'
  /** Each open by kind creates independent content; omission keeps one page per kind in each pane. */
  multiple?: boolean
  /** The tab chip's initial text, captured into the layout record at open time. */
  title: (address: string) => string
  /**
   * Entry boxes for the host column's own landing page (the guide). This is what
   * makes a type discoverable by hand: the native strip's `+` control only
   * re-opens the guide page, and the guide lists registered types through
   * exactly these entries.
   */
  guide?: readonly SidebarqaSidebarRightGuideEntry[]
}

/**
 * One guide-page entry (mirror of ui-sidebar-right's `SidebarRightGuideEntry`).
 * Copy is thunked so a language change needs no re-registration.
 */
export interface SidebarqaSidebarRightGuideEntry {
  /** Stable entry identity within its provider. */
  id: string
  /** Ascending position among every registered type's entries. */
  order: number
  /** The capsule's title, read in the current language. */
  title: () => string
  /** One line under the title on what picking the capsule opens. */
  description?: () => string
}

/**
 * Stage one of native tab-type registration (`ctx.sidebarRightTabs`; mirror of
 * ui-sidebar-right's `SidebarRightTabRegistry`). Only the members this plugin
 * calls are restated.
 */
export interface SidebarqaSidebarRightTabsService {
  /**
   * Register one tab type for the caller's lifetime.
   * @param definition - the contributed type.
   * @returns idempotent disposer.
   * @throws when the id is taken or the kind cannot coexist.
   */
  register(definition: SidebarqaSidebarRightTabDefinition): () => void
}

/**
 * The native right column's placement options (mirror of
 * `SidebarRightPlacement` / `SidebarRightOpenTabOptions`).
 */
export interface SidebarqaSidebarRightOpenOptions {
  /** Land a new tab in this pane instead. */
  paneId?: string
  /** Prefer a new pane for new content; use the target pane when splitting is unavailable. */
  preferNewPane?: boolean
  /** Resource tabs reveal existing content by default; `false` permits duplicates. */
  revealIfOpened?: boolean
  /**
   * The kind's navigation parameters, delivered to the body as
   * `navigation.params`. Not validated at run time (caller and body meet at a
   * typed same-process boundary), which is what carries a pending quote.
   */
  params?: unknown
}

/**
 * The native right column's outward navigation face (`ctx.sidebarRight`; mirror
 * of `ISidebarRight`). Only the members this plugin calls are restated.
 *
 * Every write needs a mounted session surface: a call with no session on screen
 * throws `sidebarRight: no session surface is mounted`.
 */
export interface SidebarqaSidebarRightService {
  /**
   * Open a page type by kind: the registered type, at the address this package
   * records pages under. Opening the same kind again reveals the existing tab.
   * @param kind - the page type's kind.
   * @param options - placement and the kind's navigation parameters.
   */
  openTab(kind: string, options?: SidebarqaSidebarRightOpenOptions): void
  /**
   * Focus a tab and the pane holding it, raising a floating one.
   * @param tabId - the tab; one that does not exist is left alone.
   */
  focus(tabId: string): void
  /** Whether the column is currently showing its panel. */
  isExpanded(): boolean
}

/**
 * One entry in a tab's navigation record, as delivered through
 * `navigation.params` (mirror of `SidebarRightNavigationParams`).
 */
export interface SidebarqaNavQuote {
  /** The quote text the opener captured. */
  quote?: string
  /** Message identity the quote came from, when the opener knows it. */
  messageId?: string
  /** Author role of the quoted message. */
  role?: string
}

/**
 * The slot registry DSH's UI is built on (`@deepseek-ai/dsh-client-ui-slots`,
 * a PLATFORM_MODULES seed word, so this face is always available to a dynamic
 * client bundle). The native sidebar seat `sidebar.right.pane.tab` is declared
 * on it by `ui-sidebar-right`; this plugin contributes its bodies through it.
 */
export interface SidebarqaSlotsService {
  /**
   * Run `contribute` once the named slot exists, and dispose its result when
   * the slot goes away (or this fiber unloads). The registration must live in
   * the callback's scope, which is why every contribution is wrapped here.
   * @param name - declared slot name.
   * @param contribute - registers the component; returns its disposer.
   * @returns disposer.
   */
  inject(name: string, contribute: () => () => void): () => void
  /**
   * Contribute one component into a slot.
   *
   * For a keyed seat, `options.key` is the dispatch identity: the native
   * sidebar renders a tab by looking the body up under the tab type's
   * implementation `id`, NOT under its `kind`.
   * @param options - the slot name plus the seat's identity/key.
   * @param component - the component to render.
   * @returns disposer.
   */
  register(options: { name: string; key?: string }, component: unknown): () => void
  /**
   * Whether a slot is currently declared. Lets a contribution be offered only
   * when the consuming surface is actually present.
   * @param name - slot name.
   * @returns `true` once some plugin declared it.
   */
  has(name: string): boolean
}

/**
 * What a native tab body's `hooks.tabInfo` reader returns (mirror of
 * `SidebarRightTabInfo`). Only the fields this plugin reads are restated.
 */
export interface SidebarqaSidebarRightTabInfo {
  readonly sidebar: {
    /** Whether the column shows its panel (`false` = collapsed to the rail). */
    readonly expanded: boolean
    readonly fullscreen: boolean
  }
  readonly panel: { readonly id: string }
  readonly tab: {
    readonly id: string
    /** Docked bodies need an expanded sidebar and an active tab; floats stay visible. */
    readonly visible: boolean
    readonly navigation: {
      /** The address opened; for a page tab this is the kind's recorded page address. */
      readonly address: string
      /** Whatever the opener passed; a pending quote rides here. */
      readonly params: unknown
      /** Incremented on every navigation to this tab, even when `params` is unchanged. */
      readonly revision: number
    }
  }
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
     * DSH's ui-conversation service (`@deepseek-ai/dsh-client-ui-conversation`),
     * the owner of the main chat composer. Client side only, and OPTIONAL in
     * the same sense as `locale`: it is NOT in this plugin's cordis `inject`
     * list, it is read with the inject-free `ctx.get('conversation')` (a value
     * import would trip the client-bundle purity gate), and every consumer
     * guards the `undefined`. Declaring it here is what lets `ctx.get` return
     * the typed face instead of `any` — cordis types `get` as
     * `<K extends string & keyof this>(name: K) => this[K] | undefined`.
     * See `src/client/draft-insert.ts`.
     */
    conversation: SidebarqaConversationService
    /**
     * DSH's native right-sidebar slot registry (`@deepseek-ai/dsh-client-ui-slots`,
     * a PLATFORM_MODULES seed word). Client side only; a deployment that ships
     * DSH's own sidebar always has it. Read with `ctx.get('slots')` rather than
     * listed in `inject`, because the whole native backend is optional — see
     * `src/client/sidebar-port.ts`. Declaring it here is what lets `ctx.get`
     * return the typed face instead of `any`.
     */
    slots: SidebarqaSlotsService
    /**
     * DSH's native right-sidebar tab-type registry
     * (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1), published
     * by `ctx.reflect.provide('sidebarRightTabs', …)`. ABSENT on a deployment
     * without the native sidebar, so it is optional in the strict sense: the
     * client half probes for it with `ctx.get('sidebarRightTabs')` and falls back
     * to dsh-better-sidebar, or stays inactive when neither backend exists. See
     * `src/client/sidebar-port.ts`.
     */
    sidebarRightTabs: SidebarqaSidebarRightTabsService
    /**
     * DSH's native right-sidebar navigation face, published by
     * `ctx.reflect.provide('sidebarRight', …)`. Optional in the same sense as
     * `sidebarRightTabs`; the two always appear together. See
     * `src/client/sidebar-port.ts`.
     */
    sidebarRight: SidebarqaSidebarRightService
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
export type { SidebarqaSidebarStore } from './client/ensure-panel.ts'
