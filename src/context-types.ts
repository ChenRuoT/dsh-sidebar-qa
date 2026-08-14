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
export interface SideqaWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface SideqaWebServer {
  register(route: SideqaWebRoute): () => void
}

/** Minimal structural mirror of one session surface event (readSurface output). */
export interface SideqaSurfaceEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One atomic live-preferred observation of a session's current model surface. */
export interface SideqaSurfaceSnapshot {
  session: unknown
  /** Highest raw-log seq included in the observation, or null for an empty log. */
  capturedThroughSeq: number | null
  events: SideqaSurfaceEvent[]
}

/** The sessionQuery service face (only readSurface is needed). */
export interface SideqaSessionQueryService {
  readSurface(sessionId: string): Promise<SideqaSurfaceSnapshot>
}

/** One message passed to the fast summarize model (structural Message mirror). */
export interface SideqaLlmMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: readonly { type: 'text'; text: string }[]
  source: { kind: string; plugin?: string }
}

/** One model request, fully assembled (structural GenerateOptions mirror). */
export interface SideqaLlmRequest {
  provider: string
  model: string
  messages: SideqaLlmMessage[]
  system?: string
  maxTokens?: number
  reasoningEffort?: string
  signal?: AbortSignal
}

/** One raw streaming chunk emitted by the adapter (structural StreamChunk mirror). */
export type SideqaStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; text?: string } }
  | { type: 'usage'; usage: unknown }
  | { type: 'finish'; reason: { kind?: string } }

/** The llm service face this plugin uses (stream a one-shot summary call). */
export interface SideqaLlmService {
  stream(options: SideqaLlmRequest): AsyncIterable<SideqaStreamChunk>
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface SideqaLoaderEntry {
  options: { name: string; config?: { trustedHosts?: string[] } }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface SideqaLoader {
  entries(): Iterable<SideqaLoaderEntry>
}

/** The settings namespace scope this plugin reads. */
export interface SideqaSettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void): () => void
}

/** The settings service face (only register is needed). */
export interface SideqaSettingsService {
  register<T>(ns: string, schema: unknown, options?: object): SideqaSettingsScope<T>
}

// ────────────────────────────────────────────────────────────────────────────
// Client faces
// ────────────────────────────────────────────────────────────────────────────

/** A plugin-contributed sidebar tab (mirror of better-sidebar TabDescriptor). */
export interface SideqaTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: unknown | ((size: number) => unknown)
  order?: number
  hidden?: boolean
  single?: boolean
  component: (props: SideqaTabComponentProps) => unknown
}

/** Props every tab component receives (mirror of better-sidebar TabComponentProps). */
export interface SideqaTabComponentProps {
  ctx: Context
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; path?: string; diff?: unknown }
  visible: boolean
}

/** The betterSidebar registry service published as `ctx.betterSidebar`. */
export interface SideqaBetterSidebarService {
  registerTab(descriptor: SideqaTabDescriptor): () => void
  openTab(seed: { type: string; title?: string; id?: string; path?: string; url?: string }): void
}

/** One session list row the client reads (display title + lineage + cwd). */
export interface SideqaSessionSummary {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  blank: boolean
}

/** The client session list snapshot this plugin subscribes to. */
export interface SideqaSessionListSnapshot {
  current: string | undefined
  byId: Record<string, SideqaSessionSummary>
}

/** The client sessions service face (list feed + create + open). */
export interface SideqaSessionsService {
  list: {
    getSnapshot(): SideqaSessionListSnapshot
    subscribe(fn: () => void): () => void
  }
  create(opts: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  open(id: string): void
}

/** One raw session event on the append feed. */
export interface SideqaSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** RPC result slot mirror (`RpcResult<T>` on the wire). */
export type SideqaRpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Unary response mirror (`RpcResponse<T>` on the wire). */
export interface SideqaRpcResponse<T> {
  result: SideqaRpcResult<T>
}

/** One history page entry. */
export interface SideqaHistoryEntry {
  event: SideqaSessionEvent
  view?: unknown
}

/** Complete model selection for one session. */
export interface SideqaModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The sessions RPC surface the client reaches through `ctx.connection.api`. */
export interface SideqaSessionsRpc {
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }):
    Promise<SideqaRpcResponse<{ sessionId: string; agentPreset?: string }>>
  rename(payload: { sessionId: string; title: string }):
    Promise<SideqaRpcResponse<{ title: string; seq: number }>>
  selectModel(payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }):
    Promise<SideqaRpcResponse<{ selected: SideqaModelSelection }>>
  models(payload: { sessionId: string }):
    Promise<SideqaRpcResponse<{ current: SideqaModelSelection; routable: boolean }>>
  prompt(payload: { sessionId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[]; clientTimeZone?: string }):
    Promise<SideqaRpcResponse<{ accepted: true }>>
  history(payload: { sessionId: string; beforeSeq?: number; maxMessages?: number }):
    Promise<SideqaRpcResponse<{ events: SideqaHistoryEntry[]; hasMore: boolean }>>
}

/** The connection handle face (only the sessions RPC is needed). */
export interface SideqaConnectionHandle {
  api: {
    sessions: SideqaSessionsRpc
  }
}

/** One workspace row the client reads (workspaceId + accounted session ids). */
export interface SideqaWorkspaceView {
  workspaceId: string
  title: string
  sessionIds: string[]
}

/** The client workspaces list snapshot. */
export interface SideqaWorkspaceListSnapshot {
  items: SideqaWorkspaceView[]
}

/** The client workspaces service face (only the list feed is needed). */
export interface SideqaWorkspacesService {
  list: {
    getSnapshot(): SideqaWorkspaceListSnapshot
    subscribe(fn: () => void): () => void
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Context augmentation (dual cordis scope)
// ────────────────────────────────────────────────────────────────────────────

declare module 'cordis' {
  interface Context {
    webServer: SideqaWebServer
    sessionQuery: SideqaSessionQueryService
    llm: SideqaLlmService
    loader: SideqaLoader
    settings: SideqaSettingsService
    sessions: SideqaSessionsService
    connection: SideqaConnectionHandle
    workspaces: SideqaWorkspacesService
    /**
     * The client-side sidebar registry: external plugins register tab types
     * here. Provided by dsh-better-sidebar's client half; undefined on the
     * host side. The plugin requires it (hard peer dependency).
     */
    betterSidebar: SideqaBetterSidebarService
    /**
     * Subscribe to the session append feed (mirror of the cordis event API):
     * the listener receives every appended session event with the LIVE
     * Session instance that appended it. Returns the disposer.
     */
    on(event: string, listener: (session: unknown, event: SideqaSessionEvent) => void): () => void
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
