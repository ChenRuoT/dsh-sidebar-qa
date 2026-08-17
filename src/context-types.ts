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

/** The llm service face this plugin uses (stream a one-shot summary call). */
export interface SidebarqaLlmService {
  stream(options: SidebarqaLlmRequest): AsyncIterable<SidebarqaStreamChunk>
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
  component: (props: SidebarqaTabComponentProps) => unknown
}

/** Props every tab component receives (mirror of better-sidebar TabComponentProps). */
export interface SidebarqaTabComponentProps {
  ctx: Context
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; path?: string; diff?: unknown }
  visible: boolean
}

/** The betterSidebar registry service published as `ctx.betterSidebar`. */
export interface SidebarqaBetterSidebarService {
  registerTab(descriptor: SidebarqaTabDescriptor): () => void
  /**
   * Open (or focus) a tab. `scope` (v0.12.0+ targeted open) names the session
   * whose sidebar state receives the open — the tab lands there even when that
   * session is not the one on screen, and the UI's active session is not
   * switched. Omitted scope targets the active session.
   */
  openTab(
    seed: { type: string; title?: string; id?: string; path?: string; url?: string },
    scope?: { sessionId: string; cwd?: string },
  ): void
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

/** The client sessions service face (list feed + create + open). */
export interface SidebarqaSessionsService {
  list: {
    getSnapshot(): SidebarqaSessionListSnapshot
    subscribe(fn: () => void): () => void
  }
  create(opts: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  open(id: string): void
}

/** One raw session event on the append feed. */
export interface SidebarqaSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
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

/** The sessions RPC surface the client reaches through `ctx.connection.api`. */
export interface SidebarqaSessionsRpc {
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }):
    Promise<SidebarqaRpcResponse<{ sessionId: string; agentPreset?: string }>>
  rename(payload: { sessionId: string; title: string }):
    Promise<SidebarqaRpcResponse<{ title: string; seq: number }>>
  selectModel(payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }):
    Promise<SidebarqaRpcResponse<{ selected: SidebarqaModelSelection }>>
  models(payload: { sessionId: string }):
    Promise<SidebarqaRpcResponse<{ current: SidebarqaModelSelection; routable: boolean }>>
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
}

/** The client workspaces service face (only the list feed is needed). */
export interface SidebarqaWorkspacesService {
  list: {
    getSnapshot(): SidebarqaWorkspaceListSnapshot
    subscribe(fn: () => void): () => void
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
    connection: SidebarqaConnectionHandle
    workspaces: SidebarqaWorkspacesService
    /**
     * The client-side sidebar registry: external plugins register tab types
     * here. Provided by dsh-better-sidebar's client half; undefined on the
     * host side. The plugin requires it (hard peer dependency).
     */
    betterSidebar: SidebarqaBetterSidebarService
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
