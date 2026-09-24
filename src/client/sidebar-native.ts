/**
 * The sidebar seam: DSH's own dockable right column
 * (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1).
 *
 * This is the ONLY module that knows the right column's vocabulary and the only
 * one that registers anything into it. `index.tsx` describes its tabs in this
 * module's terms; `AskPanel` / `HistoryPanel` never see a service.
 *
 * ## One tab type, three registrations, one implementation id
 *
 * 1. **the type** into `ctx.sidebarRightTabs` — identity, kind, title, guide;
 * 2. **the body** into the keyed `sidebar.right.pane.tab` slot, under that same
 *    id (the seat resolves the tab's `kind` to its implementation and dispatches
 *    on the implementation's `id`, not on the kind);
 * 3. **the live chip text** into the keyed `sidebar.right.pane.tab.title` slot,
 *    also under that id.
 *
 * Stage 3 is optional to the host and load-bearing for this plugin: without it a
 * tab keeps whatever `title(address)` produced when it was OPENED, because the
 * layout record is never retitled — so a language switch would leave the chip
 * stale forever. Registering a component there is what makes an already-open
 * tab's chip follow the language, since a component can subscribe to the locale
 * revision and the host renders it in place of the frozen string.
 *
 * All three live inside `ctx.effect`, so a plugin reload unregisters them with
 * the fiber (HMR-safe).
 *
 * ## `id` and `kind` are two names, and neither is derived from the other
 *
 * - `id` — implementation identity: unique across every registration, and the key
 *   the body and the title register under.
 * - `kind` — the dispatch name `openTab(kind)` resolves. `placeTab` looks the
 *   registry up BY KIND and throws `no tab type is registered as "<kind>"`
 *   otherwise.
 *
 * Both are fields of ONE {@link SidebarTab} object, and an open reads its `kind`
 * back off the object that was registered. An earlier revision kept the ask
 * tab's kind in a module constant derived from the tab's KEY, which registered
 * `ask` and opened `dsh-sidebar-qa:ask` — a mismatch that only appears at click
 * time. Deriving one name from the other is now unrepresentable.
 *
 * ## Why the services are probed, not injected
 *
 * `sidebarRightTabs` / `sidebarRight` are published by `ui-sidebar-right`'s own
 * `apply`, and cordis has NO optional-dependency form: every key of an `inject`
 * descriptor is a requirement (`Fiber._refresh` drops the fiber to INACTIVE when
 * any key has no implementation). Injecting them would park this plugin's fiber
 * on any host whose DSH predates the native sidebar — and `boot-client.ts` fails
 * the WHOLE web boot on a parked fiber, so that is a white screen, not a
 * graceful degradation. `ctx.get()` needs no inject (exactly like
 * `conversation`), and the `internal/service` event that `ReflectService.notify`
 * emits on every `provide` is what keeps the contribution correct whichever
 * fiber happens to land first.
 *
 * ## Zero value imports of DSH UI
 *
 * Everything here goes through cordis services and the slot registry. That is not
 * a style choice: a third-party client bundle may only `require` the nine
 * PLATFORM_MODULES seed words, and DSH policy forbids a feature plugin from
 * requesting another feature plugin's values (`packages/client/AGENTS.md:37,79`).
 * `ui-sidebar-right` is not a seed word, so importing it would fail the purity
 * gate at build time AND the module table at runtime. Its service faces live in
 * `../context-types.ts`.
 */
import { createElement, Fragment, useMemo } from 'react'
import type { ComponentType } from 'react'
import type {
  Context,
  SidebarqaPendingQuote,
  SidebarqaSidebarRightService,
  SidebarqaSidebarRightTabInfo,
  SidebarqaSidebarRightTabsService,
  SidebarqaSlotsService,
  SidebarqaTabComponentProps,
  SidebarqaTabOccurrence,
} from '../context-types.ts'
import { resolveCurrentSessionId } from './current-session.ts'
import { containPanel } from './panel-boundary.tsx'
import { Glyph, type IconComponent } from './primitives.ts'
import { showSessionFirst } from './show-session.ts'
import { slotsServiceOf } from './slots.ts'
import { useLocaleRevision } from './use-locale.ts'
import titleCss from './tab-title.module.css'

/**
 * How many frames an open may wait for its target's session surface to mount.
 * Roughly 100ms: long enough for the navigation that preceded it to reach a React
 * commit, short enough that the confirmation check cannot race a user's own click.
 */
const OPEN_RETRY_FRAMES = 6

// ────────────────────────────────────────────────────────────────────────────
// What a tab is
// ────────────────────────────────────────────────────────────────────────────

/** Which of this plugin's bodies a tab renders. */
export type SidebarTabRole = 'ask' | 'history'

/**
 * The body component a tab contributes.
 *
 * A component type, not an anonymous function: `bodyFor` hands it to
 * {@link containPanel}, which exists so the panel is MOUNTED inside this
 * plugin's containment boundary — a direct call would run it in the wrapper's own
 * render, outside the boundary's reach.
 */
export type SidebarTabBody = ComponentType<SidebarqaTabComponentProps>

/**
 * One tab type this plugin contributes to DSH's right column.
 *
 * `id` and `kind` are both read back off the object that was registered, so the
 * opener cannot name a kind the registry does not know.
 */
export interface SidebarTab {
  /** Which body this is, and how the opener finds its target. */
  readonly role: SidebarTabRole
  /**
   * Implementation identity: unique across every registration, and the key both
   * the body and the live title register under in their seats.
   */
  readonly id: string
  /** The dispatch name `openTab` resolves. NEVER derived from {@link id}. */
  readonly kind: string
  /** Ascending position among every registered type's guide entries. */
  readonly order: number
  /**
   * The tab's glyph, drawn by the chip (through the live title seat) and by this
   * type's guide capsule.
   *
   * Both placements are the host's, and both FALL BACK to something generic when
   * this is absent — the chip shows bare text, the guide capsule draws its cube
   * placeholder — so an icon-less type reads as a placeholder rather than as this
   * plugin. It is therefore OPTIONAL, and it is resolved rather than imported:
   * the host renamed its whole icon set in 0.1.7, so a name that exists on one
   * deployment is `undefined` on another (see `primitives.ts`).
   */
  readonly icon?: IconComponent | undefined
  /** The tab chip's initial text, captured into the layout record at open time. */
  readonly title: () => string
  /** One line under the guide capsule, when the guide has room to draw it. */
  readonly description: () => string
  /** The body factory. */
  readonly component: SidebarTabBody
}

/** The mounted right column's services. */
interface NativeSidebarServices {
  tabs: SidebarqaSidebarRightTabsService
  sidebar: SidebarqaSidebarRightService
  slots: SidebarqaSlotsService
}

/** What a tab body's injected `hooks.tabInfo` reader is. */
type UseTabInfo = () => SidebarqaSidebarRightTabInfo

/** The props the native seat hands a tab body. */
interface NativeBodyProps {
  /** The session whose sidebar hosts this tab. */
  sessionId: string
  /** The injected per-tab information hook (stable across renders). */
  useTabInfo: UseTabInfo
}

// ────────────────────────────────────────────────────────────────────────────
// Service probing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Whether a probed value exposes a callable member under `name`.
 *
 * A type predicate, so a probe narrows the service it just checked. Probing the
 * wrong verb is invisible until the one deployment that exercises it, which is
 * exactly the failure this helper exists to prevent.
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
 * DSH's right-column services, or undefined when this host has no native sidebar.
 *
 * All three must be present. The registry and the navigation face are provided
 * by `ui-sidebar-right` in the same `apply` body, and a tab type with no
 * registered body renders the sidebar owner's "nothing can view this" notice
 * instead of the panel — so a half-composed deployment is a composition fault,
 * and degrading to "no sidebar" beats crashing at activation.
 * @param ctx - the client plugin context.
 * @returns the service trio, or undefined.
 */
export function nativeSidebarServicesOf(ctx: Context): NativeSidebarServices | undefined {
  const tabs = ctx.get('sidebarRightTabs')
  const sidebar = ctx.get('sidebarRight')
  const slots = slotsServiceOf(ctx)
  if (!hasMethod(tabs, 'register') || !hasMethod(sidebar, 'openTab') || slots === undefined) {
    return undefined
  }
  return { tabs, sidebar, slots }
}

/**
 * Whether this client already KNOWS the target session is archived.
 *
 * The archive set is registry-global and arrives whole from the host, so a
 * positive answer is a fact, not a guess — which is what makes it safe to turn
 * the gesture into a no-op. Everything about the read is defensive: a host whose
 * workspaces feed is missing or malformed answers "not archived", because a
 * guard that cannot read its input must not start refusing opens.
 * @param ctx - the client plugin context.
 * @param sessionId - the session an open is aimed at.
 * @returns whether the session is archived.
 */
export function isArchivedTarget(ctx: Context, sessionId: string): boolean {
  try {
    const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds
    return Array.isArray(archived) && archived.includes(sessionId)
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Open payloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a native open payload into a quote.
 *
 * `navigation.params` is unvalidated by design (caller and body meet at a typed
 * same-process boundary), so a foreign caller may have put anything there.
 * @param params - the tab's `navigation.params`.
 * @returns the quote, or null when absent or malformed.
 */
export function quoteOfNavParams(params: unknown): SidebarqaPendingQuote | null {
  if (params === null || typeof params !== 'object') return null
  const record = params as Record<string, unknown>
  if (typeof record.quote !== 'string' || record.quote === '') return null
  const quote: SidebarqaPendingQuote = { text: record.quote }
  if (typeof record.messageId === 'string') quote.messageId = record.messageId
  if (typeof record.role === 'string') quote.role = record.role
  return quote
}

/**
 * Wrap a params reader into a quote reader that hands its quote over ONCE.
 *
 * The payload rides `navigation.params`, which the layout record cannot clear
 * (there is no per-tab update on this host), so "already delivered" has to live
 * in the caller. One wrapper per navigation is what makes a SECOND external open
 * into the same tab deliver its new quote: a fresh occurrence starts armed.
 * @param paramsOf - reads the tab's current `navigation.params`.
 * @returns the reader.
 */
export function takeQuoteOnce(paramsOf: () => unknown): () => SidebarqaPendingQuote | null {
  let taken = false
  return () => {
    if (taken) return null
    const quote = quoteOfNavParams(paramsOf())
    if (quote === null) return null
    taken = true
    return quote
  }
}

/**
 * Build the native navigation params for an open.
 * @param quote - the quote to hand the panel.
 * @returns the params object, or undefined when there is nothing to carry.
 */
function nativeAskParams(quote: unknown): Record<string, unknown> | undefined {
  if (typeof quote === 'string' && quote !== '') return { quote }
  if (quote === null || typeof quote !== 'object') return undefined
  const record = quote as Record<string, unknown>
  if (typeof record.quote !== 'string' || record.quote === '') return undefined
  const params: Record<string, unknown> = { quote: record.quote }
  if (typeof record.messageId === 'string') params.messageId = record.messageId
  if (typeof record.role === 'string') params.role = record.role
  return params
}

// ────────────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────────────

/**
 * The live chip content for one tab type: the type's glyph, then its title text.
 *
 * A COMPONENT, not a string: the seat renders whatever this returns, and only a
 * component can subscribe to the plugin's locale revision. `title(address)` is
 * read once, when the tab opens, and the layout record is never retitled — so
 * this seat is the only way an already-open tab's chip follows a language switch.
 *
 * The glyph belongs HERE rather than in the registration's `title`: the layout
 * record keeps a tab's title as a plain STRING, so a title-captured glyph could
 * only ever be text — and, on this host, only this seat draws anything before it.
 * `createElement`, not JSX: this module is a `.ts`. The fragment mirrors the
 * guide type's own chip (`ui-sidebar-right/tabs/guide/GuideTitle.tsx`), which is
 * what the strip's row layout is written against.
 *
 * The glyph goes through {@link Glyph} because a tab may have none on this host:
 * `createElement(undefined, …)` is React error #130, and this seat sits OUTSIDE
 * this plugin's containment boundary, so the throw would be handled by the host's
 * per-entry boundary — which retires the registration for every session.
 * @param tab - the registered tab.
 * @returns the component to register in the title seat.
 */
function titleFor(tab: SidebarTab): () => unknown {
  return function NativeSidebarTitle(): unknown {
    useLocaleRevision()
    return createElement(
      Fragment,
      null,
      createElement(Glyph, { icon: tab.icon, className: titleCss.titleIcon }),
      tab.title(),
    )
  }
}

/**
 * The tab information to fall back to when the host's reader throws.
 *
 * A detached occurrence: nothing to navigate, nothing to read, not visible. It
 * renders the panel inert for one commit instead of retiring the tab FOR THE
 * WHOLE PAGE (see {@link useTabInfoSafely}).
 */
const DETACHED_TAB_INFO: SidebarqaSidebarRightTabInfo = {
  sidebar: { expanded: false, fullscreen: false },
  panel: { id: '' },
  tab: { id: '', visible: false, navigation: { address: '', params: undefined, revision: 0 } },
}

/**
 * Read the host's per-tab information WITHOUT letting a throw escape.
 *
 * `useTabInfo()` throws (`sidebarRight: tab "<id>" is not committed in session
 * "<id>"`, `ui-sidebar-right/src/client/tab-info.ts:35`) whenever the store's
 * committed layout does not list the tab being drawn. That is a transient
 * inconsistency the HOST can produce on its own — a store commit that drops or
 * re-mints a layout lands a render before the dock unmounts the body — and an
 * escaping error here is not a cosmetic problem: the seat's per-entry boundary
 * handles it by ABDICATING this registration (`ui-slots/src/index.ts:1541`,
 * `abdicated.add(entry)`), which retires this plugin's tab body for EVERY
 * session until a page reload. Re-opening the tab cannot bring it back, because
 * the registration is gone — the exact "the panel went blank and never returns"
 * symptom this guard exists to make impossible.
 *
 * The hook order is unaffected: `tabInfoFactory` calls its own hooks before the
 * `useMemo` whose factory throws, so every hook this call makes is made either
 * way. A host that instead throws BETWEEN hooks would be an upstream API break,
 * which React reports on its own terms.
 * @param useTabInfo - the seat's injected reader.
 * @returns the information, or a detached stand-in when the reader failed.
 */
function useTabInfoSafely(useTabInfo: UseTabInfo): SidebarqaSidebarRightTabInfo {
  try {
    return useTabInfo()
  } catch (error) {
    console.warn(
      '[dsh-sidebar-qa] the right column handed this tab no committed record '
      + '(the panel stays alive and re-reads on the next commit):',
      error,
    )
    return DETACHED_TAB_INFO
  }
}

/**
 * The body component for one tab: it reads the seat's injected tab-information
 * hook and renders the (hook-free, service-free) panel under it.
 *
 * The panel is wrapped in this plugin's OWN containment boundary. Letting a
 * render error reach the seat instead is not a per-tab problem: DSH's per-entry
 * boundary ABDICATES the crashed registration, so the tab body dies for every
 * session until the page reloads — the "panel went white and never came back"
 * report, with no message anywhere.
 * @param tab - the registered tab.
 * @param ctx - the plugin's activation context, handed to the panel.
 * @param openHistory - the plugin's own history open, for the tree's 跳转 action.
 * @returns the component to register in the body seat.
 */
function bodyFor(
  tab: SidebarTab,
  ctx: Context,
  openHistory: (scope: { sessionId: string }) => void,
): (props: NativeBodyProps) => unknown {
  return function NativeSidebarBody(props: NativeBodyProps): unknown {
    const tabInfo = useTabInfoSafely(props.useTabInfo)
    const tabId = tabInfo.tab.id
    const { revision } = tabInfo.tab.navigation
    // One occurrence per navigation: re-created when the tab is navigated to
    // again, which is exactly when the panel must re-read its open payload.
    // Depending on `revision` (not on the params object, which the layout record
    // may rebuild) keeps that contraction explicit.
    //
    // A DETACHED fallback (tab id '' and revision 0) is a distinct occurrence
    // from any real one, so recovering from it re-reads the payload: a quote
    // that arrived with the open is still delivered, because `takeQuoteOnce`
    // stays armed while the reader yields nothing.
    const occurrence = useMemo<SidebarqaTabOccurrence>(
      () => ({
        tabId,
        revision,
        takeQuote: takeQuoteOnce(() => tabInfo.tab.navigation.params),
        openHistory,
      }),
      [tabId, revision, openHistory],
    )
    const bodyProps: SidebarqaTabComponentProps = {
      ctx,
      scope: { sessionId: props.sessionId },
      tab: { id: tabId },
      visible: tabInfo.tab.visible,
      sidebar: occurrence,
    }
    // `containPanel`, not JSX: this module is a `.ts` (its spec imports it as
    // one), and that helper is also what keeps the panel MOUNTED inside the
    // boundary rather than called in this component's own render.
    return containPanel(props.sessionId, tab.component, bodyProps)
  }
}

/**
 * Register one tab type: the type, its body, and its live chip title.
 * @param services - the mounted right column.
 * @param tab - the tab to contribute.
 * @param ctx - the plugin's activation context.
 * @param openHistory - the plugin's own history open.
 * @returns disposer for all three registrations.
 */
function registerTab(
  services: NativeSidebarServices,
  tab: SidebarTab,
  ctx: Context,
  openHistory: (scope: { sessionId: string }) => void,
): () => void {
  const { tabs, slots } = services
  const disposers: Array<() => void> = []

  // Stage one: what the tab type IS. No `patterns` (this is a PAGE type, opened
  // by kind rather than by resource address) and no `multiple` (one page per
  // kind per pane). `extension` is the band for a type from outside the product.
  //
  // `guide` is what makes the type DISCOVERABLE: the strip's `+` control only
  // ever re-opens the guide page, and the guide lists registered types through
  // exactly these entry boxes. Without one the tab could only be opened by code.
  //
  // The entry's `icon` is optional to the host, which draws its cube placeholder
  // for an entry that names no glyph — so an unresolved glyph (see `primitives.ts`)
  // is passed as NO key rather than as `undefined`, keeping the host's own
  // fallback the only thing the capsule can do.
  disposers.push(tabs.register({
    id: tab.id,
    kind: tab.kind,
    priority: 'extension',
    title: () => tab.title(),
    guide: [{
      id: tab.role,
      order: tab.order,
      title: tab.title,
      description: tab.description,
      ...(tab.icon === undefined ? {} : { icon: tab.icon }),
    }],
  }))

  // Stage two: the body, keyed by the SAME implementation id.
  disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: tab.id },
    bodyFor(tab, ctx, openHistory),
  )))

  // Stage three: the live chip text, keyed by the same id. A host that does not
  // declare this seat never runs the contribution, and the chip falls back to the
  // title captured at open time — stale after a language switch, but harmless.
  disposers.push(slots.inject('sidebar.right.pane.tab.title', () => slots.register(
    { name: 'sidebar.right.pane.tab.title', key: tab.id },
    titleFor(tab),
  )))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Installation
// ────────────────────────────────────────────────────────────────────────────

/**
 * The plugin's handle onto the sidebar.
 *
 * Available immediately, and a no-op until a sidebar exists: the services may be
 * published after this plugin's `apply`, so a caller that captured a service at
 * return time would hold `undefined` forever.
 */
export interface SidebarOpener {
  /** Whether the tabs are currently registered. */
  installed(): boolean
  /**
   * Open the ask tab, optionally carrying a cross-plugin quote.
   *
   * The quote is a cross-plugin seam: an external plugin may open the ask tab
   * with a quote it captured itself (a preview selection, a file excerpt) instead
   * of going through this plugin's own selection popover.
   * @param scope - the session whose sidebar receives the open.
   * @param quote - the quote to hand the panel, or omitted.
   */
  openAsk(scope: { sessionId: string }, quote?: unknown): void
  /**
   * Open the history tab.
   * @param scope - the session whose sidebar receives the open.
   */
  openHistory(scope: { sessionId: string }): void
}

/**
 * Contribute this plugin's tabs to DSH's right column, as soon as it exists.
 *
 * The contribution is owned by this plugin's effect, so it unregisters with the
 * plugin (HMR-safe) and re-registers if the sidebar is replaced.
 * @param ctx - the client plugin context.
 * @param opts - the tab types to contribute.
 * @returns the opener surface (always usable; a no-op until a sidebar exists).
 */
export function installSidebarTabs(ctx: Context, opts: { tabs: readonly SidebarTab[] }): SidebarOpener {
  const { tabs } = opts
  /** The mounted sidebar, once it exists. */
  let services: NativeSidebarServices | undefined
  /**
   * The kind each role registered under, recorded from the registered object.
   *
   * `openTab` resolves the registry BY KIND, so an open naming anything else
   * throws `no tab type is registered as "<kind>"` at click time. Reading the
   * kind back off the same object that was registered is what makes that
   * unrepresentable.
   */
  const kindByRole = new Map<SidebarTabRole, string>()
  /** Set once a sidebar was found, so later service arrivals are ignored. */
  let settled = false

  /** Open a tab in the session already on screen (the contract path). */
  const openNow = (kind: string, params: Record<string, unknown> | undefined): void => {
    const mounted = services
    if (mounted === undefined) return
    try {
      mounted.sidebar.openTab(kind, params === undefined ? undefined : { params })
    } catch (error) {
      // Opening is a UI gesture whose failure is otherwise invisible: the popover
      // has already closed itself by the time this runs, so an escaping error looks
      // exactly like "the button did nothing".
      console.warn('[dsh-sidebar-qa] opening the sidebar tab failed:', error)
    }
  }

  /**
   * Open a tab in `sessionId`'s right column, across a few frames.
   *
   * Needed ONLY when a navigation precedes the open, because the navigation face
   * acts on the binding published by the seat MOUNTED for the session on screen —
   * and that binding is republished from a React `useEffect`. A plain `openTab`
   * issued right after the switch therefore still targets the session we LEFT, and
   * does so SILENTLY, since a stale binding does not throw. Waiting without a signal
   * cannot be made exact, so this uses the primitive that cannot be wrong:
   * `openTabIn(sessionId, …)` addresses that session's store directly and does
   * nothing while the store is not adopted. It reports nothing, so it is re-issued
   * across the budget — re-opening the same kind only reveals the tab that is
   * already there — and confirmed through `active()`, a read that cannot throw.
   *
   * A host without `openTabIn` (it is not on the frozen `ISidebarRight` face) waits
   * the same budget out and then falls back to `openTab`, guarded by a check that no
   * later navigation has taken over.
   */
  const openInSession = (
    sessionId: string,
    kind: string,
    params: Record<string, unknown> | undefined,
    framesLeft: number,
  ): void => {
    const mounted = services
    if (mounted === undefined) return
    const options = params === undefined ? undefined : { params }
    const openIn = mounted.sidebar.openTabIn

    if (typeof openIn !== 'function') {
      if (framesLeft > 0 && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { openInSession(sessionId, kind, params, framesLeft - 1) })
        return
      }
      // Superseded by a later navigation: opening now would place the tab in
      // whatever is on screen instead, which is worse than not opening at all.
      if (resolveCurrentSessionId(ctx.sessions.list.getSnapshot()) !== sessionId) return
      openNow(kind, params)
      return
    }

    openIn.call(mounted.sidebar, sessionId, kind, options)
    if (framesLeft <= 0) {
      // `openTabIn` is silent, so `active()` is the only confirmation available.
      // Without it, a tab that never appeared would be indistinguishable from a
      // click that did nothing — the failure mode this plugin keeps re-learning.
      if (mounted.sidebar.active?.()?.kind !== kind) {
        console.warn(`[dsh-sidebar-qa] the ${kind} tab did not open in session ${sessionId}.`)
      }
      return
    }
    if (typeof requestAnimationFrame !== 'function') return
    requestAnimationFrame(() => { openInSession(sessionId, kind, params, framesLeft - 1) })
  }

  /** Open one of this plugin's tabs in its target session's sidebar. */
  const openRole = (role: SidebarTabRole, scope: { sessionId: string }, quote?: unknown): void => {
    const kind = kindByRole.get(role)
    if (kind === undefined) {
      console.warn(`[dsh-sidebar-qa] the ${role} tab is not registered; nothing to open.`)
      return
    }
    if (isArchivedTarget(ctx, scope.sessionId)) {
      // Navigating to an archived session is WORSE than a failed navigation:
      // `uiWorkspace.openSession` retains it happily, and DSH's own navigation
      // policy then drops it again (`clearArchivedCurrent` → `clearMain`:
      // `ui-workspace/src/client/navigation.ts:287-301`), leaving an empty main
      // pane with no mounted conversation — and therefore no right column either.
      // The panel the user was reading disappears with it, so the gesture is
      // refused up front and the current view is left alone.
      console.warn(
        `[dsh-sidebar-qa] session ${scope.sessionId} is archived; not navigating to it.`,
      )
      return
    }
    const params = quote === undefined ? undefined : nativeAskParams(quote)
    let switched = false
    try {
      switched = showSessionFirst(ctx, scope.sessionId)
    } catch (error) {
      console.warn('[dsh-sidebar-qa] switching to the target session failed:', error)
    }
    if (switched) openInSession(scope.sessionId, kind, params, OPEN_RETRY_FRAMES)
    else openNow(kind, params)
  }

  const installIfPossible = (): void => {
    if (settled) return
    const found = nativeSidebarServicesOf(ctx)
    if (found === undefined) return
    settled = true
    services = found
    const disposers = tabs.map((tab) => {
      kindByRole.set(tab.role, tab.kind)
      return registerTab(found, tab, ctx, scope => { openRole('history', scope) })
    })
    console.info(`[dsh-sidebar-qa] registered ${String(tabs.length)} tabs in DSH's own right sidebar`)

    ctx.effect(() => () => {
      for (const dispose of disposers.reverse()) dispose()
      kindByRole.clear()
      if (services === found) services = undefined
      settled = false
    }, 'dsh-sidebar-qa: sidebar tab registrations')
  }

  ctx.effect(() => {
    // Any service publication may be the sidebar we are waiting for.
    // `internal/service` is emitted by `ReflectService.notify` on every
    // `provide`, so this is exactly "a service arrived".
    const off = ctx.on('internal/service', () => { installIfPossible() })
    // The sidebar may already be composed (the common case), so look once now.
    installIfPossible()
    return off
  }, 'dsh-sidebar-qa: sidebar service watch')

  // A host with no native sidebar still gets this plugin's non-sidebar surfaces,
  // so say why the tabs are missing instead of leaving the user guessing.
  const warnIfAbsent = (): void => {
    if (settled || nativeSidebarServicesOf(ctx) !== undefined) return
    console.warn(
      '[dsh-sidebar-qa] this DSH has no right sidebar '
      + '(@deepseek-ai/dsh-client-ui-sidebar-right, DSH >= 0.1.5-alpha.1); '
      + 'the selection popover and 「添加到对话」 stay available, the sidebar tabs do not.',
    )
  }
  warnIfAbsent()
  queueMicrotask(warnIfAbsent)

  return {
    installed: () => services !== undefined,
    openAsk: (scope, quote) => { openRole('ask', scope, quote) },
    openHistory: scope => { openRole('history', scope) },
  }
}
