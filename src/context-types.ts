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
 *   (@deepseek-ai/cordis-plugin-loader), settings (@deepseek-ai/dsh-settings)
 * - client: sessions (runtime ISessions list + scope), remote (the typed
 *   client Remote service and its `session` namespace), workspaces (runtime
 *   IWorkspaces list), slots / sidebarRightTabs / sidebarRight (DSH's own
 *   right column, reached with `ctx.get` rather than injected)
 * - effect / on: the DSH-vendored cordis lifecycle helper
 *
 * Drift from upstream is contained to this file. Only the leaf fields the
 * plugin reads are declared; live cordis objects are never serialized.
 *
 * An upstream name may only be declared here if it actually EXISTS upstream: a
 * member present in this file alone is a bug, not a convenience. An invented
 * field is invisible to the compiler (this file is the only declaration in
 * scope, so `tsc` checks the mirror against itself) and silently reads as
 * `undefined` at run time. `SidebarqaSessionListSnapshot` carried exactly such
 * a field (`current`) for three releases.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ComponentType } from 'react'
import type { Context } from 'cordis'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

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

/**
 * One loader entry's options slice (the connection row's resolved config).
 *
 * `id` is the row's identity inside the entry tree
 * (`vendor/loader/src/config/entry.ts:10-13`), and it is what identifies the
 * connection row: the web-app bundle mounts it as `id: connection` with
 * `name: '@deepseek-ai/dsh-client-connection'` (`packages/bundle/web-app/
 * cordis.patch.yml`). An earlier revision of this mirror declared only `name` and
 * matched on it, so the trust fence silently fell back to loopback-only.
 */
export interface SidebarqaLoaderEntry {
  options: {
    /** Stable row id inside the entry tree; the connection row's is `connection`. */
    id: string
    /** The module specifier the row loads (NOT its identity). */
    name: string
    /**
     * The row's raw config. `trustedHosts` may be an UNEVALUATED `!!js` node
     * (`{ __jsExpr: … }`) rather than a list — see `trustedHostsOf`.
     */
    config?: { trustedHosts?: unknown }
  }
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

/** The settings service face (register + revision-guarded update + describe).
 *
 * Upstream: `packages/settings/settings/src/index.ts` (`SettingsProvider`) —
 * `register` :419, `describe` :499, `update` :551 as of `dsh-settings@0.1.5-rc.2`.
 * `register` is ABSENT from `dsh-settings@0.1.7-alpha.1+` (`SettingsForms`, which
 * only ships `configure` / `describe` / `update` / `replace` / `mutate` / `schema`),
 * so no caller may assume it exists — the host half probes for it structurally in
 * `src/settings-face.ts` (issue #19). `describe` / `update` survive that change but
 * address a profile ENTRY ID there, not a plugin-declared namespace.
 */
export interface SidebarqaSettingsService {
  register<T>(ns: string, schema: unknown, options?: object): SidebarqaSettingsScope<T>
  describe(options?: { redactSecrets?: boolean }): SidebarqaSettingsDescriptor[]
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

// ────────────────────────────────────────────────────────────────────────────
// Client faces
// ────────────────────────────────────────────────────────────────────────────

/** The cross-plugin quote shape (mirror of this plugin's `PendingQuote`). */
export interface SidebarqaPendingQuote {
  text: string
  messageId?: string
  role?: string
}

/**
 * This tab OCCURRENCE's identity and the operations it can perform.
 *
 * Built once per navigation by `src/client/sidebar-native.ts` from the seat's
 * injected `useTabInfo()`. It is the whole sidebar-facing surface a panel gets,
 * and it is deliberately three members: everything else a panel needs (its
 * scope, the plugin ctx, the store) is already backend-neutral.
 */
export interface SidebarqaTabOccurrence {
  /** Stable identity for this tab occurrence. */
  tabId: string
  /**
   * How many times this tab has been NAVIGATED TO — the open that created it,
   * and every later open that revealed or re-focused it
   * (`navigation.revision`; `0` for a record nobody opened by address, such as
   * a tab restored by undo).
   *
   * It is the one fact a body must observe for a re-open to do anything: an open
   * never remounts an existing tab, so a body that read its open payload only on
   * mount would ignore a second external open into the same tab.
   */
  revision: number
  /**
   * Read this occurrence's cross-plugin quote and mark it consumed, so a later
   * focus does not resurface a stale quote.
   *
   * The quote rides the open as `navigation.params`, which the layout record
   * cannot clear, so the adapter remembers what it already handed out. A fresh
   * occurrence — one per navigation — starts with it armed again.
   * @returns the quote, or null when absent, already consumed, or malformed.
   */
  takeQuote(): SidebarqaPendingQuote | null
  /**
   * Open (or focus) this plugin's 追问记录 tab for `scope`.
   *
   * The 追问记录 tree offers a 跳转 action: switch the active conversation, then
   * keep the tree open in that session's sidebar. A panel cannot do that through
   * the cordis context — native `openTab` acts on whatever session surface is
   * MOUNTED, not on a session named in the call — so the occurrence carries the
   * plugin's own open instead.
   * @param scope - the session whose sidebar receives the tab.
   */
  openHistory(scope: { sessionId: string }): void
}

/** Props every tab component receives. */
export interface SidebarqaTabComponentProps {
  ctx: Context
  scope: { sessionId: string }
  /** The tab's identity. Only `id` is carried; the panels need nothing else. */
  tab: { id: string }
  visible: boolean
  /**
   * This occurrence's identity and capabilities.
   *
   * OPTIONAL at the type level, and every panel guards it: a panel rendered
   * without one must still mount and render (it only loses the cross-plugin
   * quote and its own 追问记录 opens). That guard is what keeps a half-composed
   * deployment from taking the whole sidebar down.
   */
  sidebar?: SidebarqaTabOccurrence
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

/**
 * The client sessions service face (list feed + scope).
 *
 * There is deliberately no `open` here. An earlier revision of this mirror declared
 * one, and `ISessions` (`api/session-controller/src/client/contract/sessions.ts:
 * 32-161`) has no such member — so every call was either a `TypeError` (the
 * HistoryPanel 跳转, which had no guard) or a silently skipped no-op (the two
 * `typeof … !== 'function'` guards). The only public way to put a session on
 * screen is {@link SidebarqaUiWorkspaceService}.
 */
export interface SidebarqaSessionsService {
  list: {
    getSnapshot(): SidebarqaSessionListSnapshot
    subscribe(fn: () => void): () => void
  }
  /**
   * Resolve an Agent-scoped context view for one listed session (use-and-discard).
   * Returns undefined for a session neither listed nor already scoped: the scope is
   * published by a React reconciliation, so it is NOT available in the same tick as
   * a navigation.
   */
  scope(sessionId: string): Context | undefined
  /** Resolve the session face behind an Agent-scoped context (from {@link scope}). */
  sessionOf(ctx: Context): SidebarqaSessionFace | undefined
}

/**
 * DSH's workspace service (`@deepseek-ai/dsh-client-ui-workspace`, published as
 * `ctx.uiWorkspace`).
 *
 * Only the navigation entry this plugin needs is restated: it is the one public
 * way to put a session on screen. Read with `ctx.get` rather than injected — a
 * convenience must not be able to park this plugin's fiber.
 */
export interface SidebarqaUiWorkspaceService {
  /**
   * Make `target` the session the main pane retains.
   *
   * Synchronous (`ui-workspace/src/client/navigation.ts:161` → `replaceMain`): the
   * session is retained and selected before this returns. The React surface showing
   * it — and therefore the sidebar's session binding — arrives on a LATER commit,
   * not in this tick.
   * @param target - the session to show (a session id, or a subagent address).
   */
  openSession(target: string): void
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
}

/** Durable identity of one ordinary session on the journal RPCs. */
export interface SidebarqaSessionAddress {
  kind: 'session'
  sessionId: string
}

/**
 * One history-page record.
 *
 * Upstream is a single-member shape (`SessionHistoryRecord = SessionEventEntry`,
 * `api/session-controller/src/types.ts:421`): a page carries scalar events and
 * nothing else. This mirror used to declare a second `{ type: 'chunks' }` member
 * for "packed assistant delta runs" — no such record exists on the wire, so the
 * unpacker it fed was unreachable and its doc described a host behaviour that
 * never happens.
 */
export type SidebarqaHistoryRecord = { type: 'event'; event: SidebarqaSessionEvent }

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
  /**
   * The LIVE assistant stream — upstream's third variant (`types.ts:527`), which
   * carries a `SessionAssistantStreamFrame`. Declared so an arriving frame is
   * recognized instead of crashing a `frame.event` read: this plugin's transcript
   * is folded from the snapshot window and the scalar `event` frames, so the
   * stream is deliberately ignored.
   */
  | { type: 'assistant-stream'; frame: unknown }

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
 * `modelSelection` projection (`lastUsed` / `next`). `ModelSelect` recombines the two
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
 * first-party DSH surface.
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
   * Return the keyboard to the composer with the caret it last held.
   *
   * `setDraft` never focuses, so every insert ends with this. Upstream implements
   * it as exactly the two calls `draft-insert.ts` used to hand-roll
   * (`ui-conversation/src/client/input/facade.ts:460-463`): a `preventScroll` DOM
   * focus, then Lexical's own, which restores its stored selection instead of
   * dropping the caret at the start.
   */
  focus(): void
  /**
   * The shell-owned Lexical editor.
   *
   * NOT on ui-conversation's frozen `SessionInput` interface — it is a public
   * readonly field of the runtime shell only — so it is OPTIONAL here and every
   * read is guarded. Kept as a fallback for an upstream that exposes the shell
   * field but not {@link focus}.
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
// DSH right sidebar (ui-sidebar-right)
//
// DSH ≥ 0.1.5-alpha.1 ships its own dockable right column
// (`@deepseek-ai/dsh-client-ui-sidebar-right`). Its extension points are two cordis
// services — `sidebarRightTabs` (the type registry) and `sidebarRight` (navigation)
// — plus render seats declared on DSH's own slot registry. A tab type registers in
// THREE stages under one implementation `id`: the definition into
// `sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` slot, and
// the LIVE chip text — a component — into `sidebar.right.pane.tab.title`.
//
// These are structural mirrors only. The client bundle must NOT value-import
// `@deepseek-ai/dsh-client-ui-sidebar-right/client` (client-bundle purity gate):
// its `/client` export carries runtime code, and DSH policy forbids a feature
// plugin from requesting another feature plugin's values. The services are reached
// through `ctx.get()` exactly like `conversation`.
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
  /**
   * The capsule's glyph, drawn before the title (`SidebarRightGuideEntry.icon`,
   * `ui-sidebar-right/src/client/tab-registry.ts:79`).
   *
   * Loading-bearing when ABSENT: the guide's capsule then draws its own cube
   * placeholder (`tabs/guide/GuideBody.tsx:48,59`), which is what this plugin's
   * two entries looked like until the field was restored here. `IconProps` is the
   * host's own icon contract (`size` / `className`), imported rather than
   * re-mirrored: the components passed here ARE host components.
   */
  icon?: ComponentType<IconProps>
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
   *
   * Acts on the binding published by the MOUNTED session's seat, and that binding
   * is republished from a React `useEffect` — so a call issued in the same tick as
   * a navigation still targets the session just LEFT, silently, because a stale
   * binding does not throw.
   * @param kind - the page type's kind.
   * @param options - placement and the kind's navigation parameters.
   */
  openTab(kind: string, options?: SidebarqaSidebarRightOpenOptions): void
  /**
   * Open a kind in a NAMED session's right column.
   *
   * The Tab domain's own path (`ui-sidebar-right/src/client/service.ts:309-325`),
   * used by DSH's own `ui-sidebar-terminal`. It addresses that session's store
   * directly and does NOTHING while the store is not adopted, so unlike
   * {@link openTab} it can never land in the wrong session — which makes it the
   * only safe way to open immediately after a navigation.
   *
   * OPTIONAL: the source marks it "Not part of `ISidebarRight`", so it is probed
   * structurally and an upstream without it falls back to a deferred `openTab`.
   * @param sessionId - the session whose right column receives the tab.
   * @param kind - the page type's kind.
   * @param options - placement and the kind's navigation parameters.
   */
  openTabIn?(sessionId: string, kind: string, options?: SidebarqaSidebarRightOpenOptions): void
  /**
   * Focus a tab and the pane holding it, raising a floating one.
   * @param tabId - the tab; one that does not exist is left alone.
   */
  focus(tabId: string): void
  /** Whether the column is currently showing its panel. */
  isExpanded(): boolean
  /**
   * The MOUNTED surface's active tab, or undefined when nothing is mounted.
   *
   * A READ, so it never throws the way a write without a surface does. This is what
   * lets an open be CONFIRMED rather than assumed: `openTabIn` reports nothing, so a
   * retry needs another way to learn whether it landed.
   */
  active?(): { kind?: string } | undefined
}

/**
 * DSH's web-bundle runtime face (`webRuntime`, provided by
 * `@deepseek-ai/dsh-bundle-web-app`).
 *
 * It carries the ALREADY-EVALUATED `trustedHosts` list — the very value the
 * connection row's `trustedHosts: !!js ctx.webRuntime.trustedHosts` expression
 * reads. See `trustedHostsOf` in `src/index.ts` for why reading the row's own
 * config instead is not merely useless but dangerous.
 */
export interface SidebarqaWebRuntimeService {
  /** Loopback/LAN authorities plus the deployment's `--trusted-host` extras. */
  trustedHosts?: unknown
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
  register(
    options: {
      name: string
      /** KEYED seats dispatch on this — the right column's tab body uses the tab id. */
      key?: string
      /** LIST seats require this: it is the entry's identity, and it picks the nav icon. */
      id?: string
      /** Ascending position within the seat. */
      order?: number
      /** A list entry's display text, re-read whenever the owner re-projects. */
      label?: string | (() => string)
    },
    component: unknown,
  ): () => void
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
    /**
     * The web bundle's runtime face. Client-agnostic and OPTIONAL: deployments
     * that do not compose `@deepseek-ai/dsh-bundle-web-app` have no `webRuntime`,
     * so it is read with `ctx.get` and every value is array-checked.
     */
    webRuntime: SidebarqaWebRuntimeService
    settings: SidebarqaSettingsService
    sessions: SidebarqaSessionsService
    /**
     * DSH's workspace service, the owner of "which session is on screen".
     *
     * Client side only, and OPTIONAL: read with `ctx.get('uiWorkspace')` and guard
     * the result, like `conversation` and the sidebar services. Everything that
     * needs a session made visible degrades to "leave the current session alone"
     * without it — which is strictly better than parking the fiber, because a parked
     * fiber fails the entire web boot.
     */
    uiWorkspace: SidebarqaUiWorkspaceService
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
     * DSH's right-sidebar slot registry (`@deepseek-ai/dsh-client-ui-slots`, a
     * PLATFORM_MODULES seed word). Client side only; a deployment that ships
     * DSH's own sidebar always has it. Read with `ctx.get('slots')` rather than
     * listed in `inject`, because the sidebar is an optional surface. Declaring
     * it here is what lets `ctx.get` return the typed face instead of `any`.
     */
    slots: SidebarqaSlotsService
    /**
     * DSH's own right-sidebar tab-type registry
     * (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1), published
     * by `ctx.reflect.provide('sidebarRightTabs', …)`. ABSENT on a DSH older than
     * that package, so it is read with `ctx.get()` and NEVER injected: an
     * injected service with no implementation parks this plugin's fiber, and
     * `boot-client.ts` fails the entire web boot on a parked fiber instead of
     * degrading. A host without it still gets the selection popover and
     * 「添加到对话」. See `src/client/sidebar-native.ts`.
     */
    sidebarRightTabs: SidebarqaSidebarRightTabsService
    /**
     * DSH's own right-sidebar navigation face, published by
     * `ctx.reflect.provide('sidebarRight', …)`. Optional in the same sense as
     * `sidebarRightTabs`; the two are provided together. See
     * `src/client/sidebar-native.ts`.
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
