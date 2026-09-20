/**
 * The sidebar seam: one small port over the two right-column backends.
 *
 * This plugin must run on two very different hosts:
 *
 * - **`native`** — DSH's own dockable right column
 *   (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1). A tab type
 *   registers in two stages under one implementation `id` (the definition into
 *   `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab`
 *   slot), and it is opened by `ctx.sidebarRight.openTab(kind, { params })` with
 *   the payload arriving as `navigation.params`.
 * - **`betterSidebar`** — the third-party `dsh-better-sidebar` framework
 *   (`ctx.betterSidebar.registerTab` / `openTab` / `updateTab`), the backend
 *   this plugin shipped on before DSH grew its own sidebar.
 *
 * The two APIs share no vocabulary. This module is the ONLY place that knows
 * both: it probes which backend a deployment actually has, and hands the rest of
 * the plugin a port whose operations are expressed in the plugin's own terms.
 * `index.tsx` wires the active port; `AskPanel` / `HistoryPanel` never branch on
 * a backend.
 *
 * Everything here is pure: the module has no cordis, React, or DOM dependency,
 * so the detector and the specification normalizers are unit-testable under the
 * project's `node` test environment.
 *
 * ## Capability differences the port cannot hide
 *
 * - Tab titles — better-sidebar retitles a LIVE tab by runtime id
 *   (`updateTab`), which the panels already do from their own mount effect; a
 *   native tab type supplies a `title` function evaluated at open time, so the
 *   native backend needs a `navigation.revision`-driven refresh instead. That is
 *   the native adapter's problem, and it is why the port does not pretend to
 *   offer a backend-neutral `setTitle`.
 * - Panel expansion — better-sidebar needs the plugin to expand a collapsed
 *   panel itself (`ensure-panel.ts`); native `openTab` expands the column as
 *   part of placing the tab, and reports `sidebar.expanded` on the body.
 * - `openAsk(scope)` — better-sidebar can target a session that is not on
 *   screen (`openTab(seed, scope)`); the native navigation face only reaches the
 *   mounted session surface and throws otherwise.
 */
import type {
  Context,
  SidebarqaBetterSidebarService,
  SidebarqaPendingQuote,
  SidebarqaSidebarRightService,
  SidebarqaSidebarRightTabsService,
  SidebarqaSlotsService,
} from '../context-types.ts'

// ────────────────────────────────────────────────────────────────────────────
// Registration vocabulary
// ────────────────────────────────────────────────────────────────────────────

/**
 * The plugin's two sidebar tabs.
 *
 * The better-sidebar ids (`dsh-sidebar-qa:ask` / `:history`) are part of a
 * shipped contract: they are persisted in better-sidebar's per-session layout
 * state. The stable `key` doubles as the native implementation id and slot key.
 */
export const ASK_TAB = { key: 'dsh-sidebar-qa:ask', order: 60 } as const
export const HISTORY_TAB = { key: 'dsh-sidebar-qa:history', order: 70 } as const

/** The tab kinds a body may be rendered for. */
type SidebarTabKindId = 'ask' | 'history'

/**
 * One entry the host column's own landing page (the "guide") offers, contributed
 * by the tab type it opens.
 *
 * This is what makes a native tab DISCOVERABLE. The native sidebar's strip `+`
 * control only ever re-opens the GUIDE page — it does not enumerate types — and
 * the guide is the surface that lists registered types as clickable capsules. A
 * type with no entry box can therefore only be opened by code, which is how the
 * ship-with-DSH viewers work (a file link opens them, never a menu) but NOT what
 * this plugin wants: its tabs must also be reachable by hand.
 */
export interface SidebarPortGuideEntry {
  /** Stable entry identity within this plugin. */
  id: string
  /** Ascending position among every registered type's entries. */
  order: number
  /** The capsule's title, read in the current language on every use. */
  title: () => string
  /** One line under the title saying what picking it opens. */
  description?: () => string
}

/** One tab type this plugin contributes to whichever sidebar backend is active. */
export interface SidebarPortTabSpec {
  /**
   * Stable registration identity, stable across re-registration (HMR, locale
   * change, backend switch). It is the better-sidebar tab id AND the native
   * implementation id — the key the native sidebar looks the body up under.
   */
  key: string
  /**
   * Which of the plugin's bodies renders here.
   *
   * Kept SEPARATE from `key` on purpose: the native tab type's `kind` is the
   * name `openTab` dispatches on, and a kind is not unique (an extension may
   * take a builtin's over) while an implementation id is.
   */
  kind: SidebarTabKindId
  /** Tab chip text in the current language; re-read on every use. */
  title: () => string
  /** Menu position. Used by the better-sidebar backend only. */
  order: number
  /** Tab glyph factory. Used by the better-sidebar backend only. */
  icon: (size: number) => unknown
  /**
   * Entries for the host column's guide page. Used by the native backend only:
   * better-sidebar lists tabs in its own `+` menu, so it needs none.
   */
  guide?: readonly SidebarPortGuideEntry[]
  /** The body factory (see {@link SidebarPortBodyFactory}). */
  component: SidebarPortBodyFactory
}

/**
 * The target session of an open.
 *
 * `sessionId` is always carried. better-sidebar's `scope` also resolves a `cwd`;
 * the plugin never needed it, and the native face has no equivalent.
 */
export interface SidebarPortScope {
  sessionId: string
}

// ────────────────────────────────────────────────────────────────────────────
// Backend neutral body props
// ────────────────────────────────────────────────────────────────────────────

/**
 * The props every body component receives, normalized across backends — the
 * shape `AskPanel` / `HistoryPanel` declare as `SidebarqaTabComponentProps`.
 *
 * Each adapter maps its backend's native props onto this shape, adding the
 * backend half (`sidebar`: this occurrence's identity + capabilities) and
 * leaving the rest to the port. `store` is better-sidebar's own panel state
 * store, absent on the native backend where it is never needed.
 */
export interface SidebarPortBodyProps {
  /** The plugin's own activation context (resolves this plugin's injected services). */
  ctx: Context
  /** The session whose sidebar hosts the tab. */
  scope: SidebarPortScope
  /** Stable tab identity, when the backend mints one at open time. */
  tab: { id: string }
  /** Whether the tab is currently visible. */
  visible: boolean
  /** The backend's own panel state store (better-sidebar only). */
  store?: unknown
  /**
   * This occurrence's identity and backend capabilities. Optional at the type
   * level so a body still mounts without one; every panel guards it.
   */
  sidebar?: SidebarPortOpen
}

// ────────────────────────────────────────────────────────────────────────────
// The port
// ────────────────────────────────────────────────────────────────────────────

/** Which right-column backend a deployment actually provides. */
export type SidebarBackend = 'native' | 'betterSidebar' | 'none'

/**
 * What an adapter offers a body component beyond the neutral props — the
 * backend-specific half of {@link SidebarPortBodyProps}.
 *
 * Every member is the honest answer for THAT backend; the port never
 * synthesizes a capability a backend lacks.
 */
export interface SidebarPortCapabilities {
  /**
   * Re-push this tab's chip text in the current language, if the backend can.
   * A no-op on a backend that captured the title at open time.
   */
  setTitle(title: string): void
  /**
   * Read the pending cross-plugin quote off this tab and mark it consumed.
   * @returns the quote, or null when absent, already taken, or malformed.
   */
  takeQuote(): SidebarqaPendingQuote | null
  /** Heal a collapsed host column (issue #6) where the backend needs the help. */
  healVisibility(): void
  /**
   * Open (or focus) this plugin's 追问记录 tab for `scope`.
   *
   * The 追问记录 tree's 跳转 action switches the active conversation and keeps
   * the tree open in that session's sidebar. Panels cannot do that through the
   * cordis context (they do not know which backend is active), so the adapter
   * offers it here: better-sidebar can target a session that is not on screen,
   * the native face opens in the mounted session surface.
   * @param scope - the session whose sidebar receives the tab.
   */
  openHistory(scope: { sessionId: string }): void
}

/**
 * The per-open half of {@link SidebarPortBodyProps}, built once per tab body:
 * what the whole plugin knows about the open (its context and session) versus
 * what only the backend knows about THIS tab.
 *
 * Splitting it out lets one body implementation serve both backends: the
 * adapter supplies the backend half, the port supplies the rest.
 */
export interface SidebarPortOpen {
  /** Stable identity for this tab occurrence, when the backend mints one. */
  tabId: string
  /**
   * How many times this tab has been NAVIGATED TO — an open that created it,
   * and every later open that revealed or re-focused it.
   *
   * It is the one fact a body must observe for a re-open to do anything: an
   * open never remounts an existing tab, so a body that re-reads its open
   * payload only on mount would ignore the second external open into the same
   * tab. The native backend reports it directly
   * (`navigation.revision`); the better-sidebar backend has no such number and
   * synthesizes one from its own `onActivate` notifications.
   */
  revision: number
  /** Backend-specific capabilities for this tab. */
  capabilities: SidebarPortCapabilities
}

/**
 * A tab body factory: the component an adapter registers for one tab type.
 *
 * The plugin hands the adapter this factory once, and the adapter binds a
 * per-tab {@link SidebarPortOpen} to it for every occurrence. A backend that
 * derives per-tab facts from React hooks (the native one, through
 * `useTabInfo`) simply returns a component that calls those hooks and then
 * renders the result — the body itself stays hook- and backend-free.
 *
 * Typed as accepting the neutral props and returning anything React can render,
 * so neither the adapter nor the plugin needs a cast at the boundary.
 * @param ctx - the plugin's activation context (resolves this plugin's injected services).
 * @param open - this occurrence's identity and capabilities.
 * @returns the component to register.
 */
export type SidebarPortBodyFactory = (ctx: Context, open: SidebarPortOpen) => (props: SidebarPortBodyProps) => unknown

/** The sidebar operations the plugin needs, in its own vocabulary. */
export interface SidebarPort {
  /** Which backend this port drives. */
  readonly backend: SidebarBackend
  /**
   * Contribute one tab type for the caller's lifetime.
   * @param spec - the tab to contribute.
   * @returns disposer.
   */
  registerTab(spec: SidebarPortTabSpec): () => void
  /**
   * Open this plugin's ask tab, optionally carrying a cross-plugin quote.
   *
   * The quote is a cross-plugin seam: an external plugin may open the ask tab
   * with a quote it captured itself (a preview selection, a file excerpt)
   * instead of going through this plugin's own selection popover. It rides the
   * backend's per-open payload channel — better-sidebar's `meta`, the native
   * `navigation.params` — and is read back through
   * {@link SidebarPortCapabilities.takeQuote}.
   * @param scope - the session whose sidebar receives the open.
   * @param quote - the quote to hand the panel, or omitted.
   */
  openAsk(scope: SidebarPortScope, quote?: unknown): void
  /**
   * Open this plugin's history tab.
   * @param scope - the session whose sidebar receives the open.
   */
  openHistory(scope: SidebarPortScope): void
  /**
   * Subscribe to "a tab of this plugin was just focused".
   *
   * The authoritative heal signal for issue #6: when the panel was collapsed
   * and the user clicks 提问 again, the open only re-focuses the existing tab
   * (no remount), so the mounted panel must be told to re-check its own
   * visibility. Both backends can produce it — better-sidebar through the
   * descriptor's `onActivate`, the native backend through the tab body seeing
   * its `navigation.revision` change — so the plugin exposes ONE hook and each
   * adapter owns how it learns the fact.
   * @param listener - synchronous callback.
   * @returns disposer.
   */
  onActivate(listener: () => void): () => void
  /** Drop every activation listener (disposal). */
  dispose(): void
}

// ────────────────────────────────────────────────────────────────────────────
// Backend detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Whether a probed value exposes a callable member under `name`.
 *
 * A type predicate, so a probe narrows the service it just checked. The member
 * name differs per registry — the native tab registry and the slot registry both
 * expose `register`, while better-sidebar's registry exposes `registerTab` — so
 * every probe names the verb it is actually looking for. Probing the wrong verb
 * is invisible until the one deployment that exercises it, which is exactly the
 * failure this helper exists to prevent.
 * @param value - the probed service, if any.
 * @param name - the member the service must expose as a function.
 * @returns whether the value is usable.
 */
function hasMethod<T extends object, K extends string>(
  value: T | undefined,
  name: K,
): value is T & Record<K, (...args: never[]) => unknown> {
  return typeof (value as Record<string, unknown> | undefined)?.[name] === 'function'
}

/**
 * Which right-column backend this deployment provides.
 *
 * DSH's own sidebar wins when both are installed: it is the first-party
 * surface, and running the plugin's tabs in both columns at once would show the
 * same UI twice. The probe is deliberately structural rather than
 * version-based — the native services are published by
 * `ctx.reflect.provide()` only while `ui-sidebar-right` is composed, so their
 * presence IS the capability.
 *
 * A malformed service (present but without `register`) counts as absent, so a
 * half-composed deployment degrades to the other backend instead of crashing at
 * plugin activation.
 * @param ctx - the client plugin context.
 * @returns the backend to drive, or `none` when neither sidebar is installed.
 */
export function detectSidebarBackend(ctx: Context): SidebarBackend {
  if (hasMethod(ctx.get('sidebarRightTabs'), 'register')) return 'native'
  if (hasMethod(ctx.get('betterSidebar'), 'registerTab')) return 'betterSidebar'
  return 'none'
}

/**
 * The slot registry, or undefined when DSH's own UI is not composed.
 *
 * The native backend needs it as much as the two sidebar services: a tab type
 * without a registered body renders the sidebar owner's "nothing can view this"
 * notice rather than the panel.
 * @param ctx - the client plugin context.
 * @returns the slots service face, or undefined.
 */
export function slotsServiceOf(ctx: Context): SidebarqaSlotsService | undefined {
  const slots = ctx.get('slots')
  return hasMethod(slots, 'register') ? slots : undefined
}

/**
 * The two native services, or undefined when the native sidebar is not composed.
 *
 * Both must be present and well-formed: `ui-sidebar-right` provides the
 * registry and the navigation face in the same `apply()` body, so a deployment
 * with only one of them is a composition bug, not a supported shape.
 * @param ctx - the client plugin context.
 * @returns the native service pair, or undefined.
 */
export function nativeSidebarServicesOf(ctx: Context): {
  tabs: SidebarqaSidebarRightTabsService
  sidebar: SidebarqaSidebarRightService
} | undefined {
  const tabs = ctx.get('sidebarRightTabs')
  const sidebar = ctx.get('sidebarRight')
  if (!hasMethod(tabs, 'register') || !hasMethod(sidebar, 'openTab')) return undefined
  return { tabs, sidebar }
}

/**
 * The better-sidebar service, or undefined when better-sidebar is not composed.
 *
 * The verb is `registerTab`, NOT `register`: better-sidebar's registry is the
 * one backend whose registration method is not named `register`.
 * @param ctx - the client plugin context.
 * @returns the service face, or undefined.
 */
export function betterSidebarServiceOf(ctx: Context): SidebarqaBetterSidebarService | undefined {
  const service = ctx.get('betterSidebar')
  return hasMethod(service, 'registerTab') && hasMethod(service, 'openTab') ? service : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Open-payload normalization
// ────────────────────────────────────────────────────────────────────────────
//
// There is deliberately nothing here. An earlier draft normalized the payload
// centrally, which turned out to be the wrong seam: only an ADAPTER knows its
// backend's payload channel and, more importantly, which of them can be cleared
// (better-sidebar's `meta` can, the native `navigation.params` cannot). The
// payload logic therefore lives in each adapter — `quoteOfNavParams` in
// `sidebar-native.ts`, `resolveMetaQuote` in `meta-quote.ts` — behind the one
// contract the panels use: `SidebarPortCapabilities.takeQuote()`.

