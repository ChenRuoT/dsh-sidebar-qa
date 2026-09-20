/**
 * The `betterSidebar` backend of the sidebar port — the third-party
 * `dsh-better-sidebar` framework this plugin shipped on before DSH grew its own
 * right column.
 *
 * This adapter is the ONLY place that knows better-sidebar's vocabulary:
 * `registerTab` / `openTab(seed, scope)` / `updateTab(id, patch)`, the
 * `TabComponentProps` shape, and the panel-healing trick `ensure-panel.ts`
 * exists for. Everything above it speaks the port's language.
 *
 * The adapter is pure: it is a factory over the injected service plus one
 * helper (`expandPanelIfCollapsed`), so it is unit-testable with a fake service
 * and no cordis, React, or DOM.
 *
 * ## Why the bridge exists
 *
 * Three facts differ between the backends, and the panels must not branch on
 * them:
 *
 * - **Title** — better-sidebar persists an OPEN tab's title as a plain string,
 *   so the `registerTab` title thunk never re-runs for it and a language change
 *   must be pushed with `updateTab`.
 * - **Cross-plugin quote** — better-sidebar carries it on the tab's `meta` and
 *   clears it with `updateTab`, so a later focus cannot resurface it. The
 *   adapter also remembers what it handed out, because React may re-render the
 *   same props before the store round-trips the cleared meta.
 * - **Panel healing (issue #6)** — better-sidebar exposes NO panel-expansion
 *   method (`togglePanel` is an internal store reducer), so a type-only open
 *   lands the tab inside an invisible collapsed panel and the plugin expands it
 *   itself through the `SidebarStore` handed to every tab component.
 */
import type {
  Context,
  SidebarqaBetterSidebarService,
  SidebarqaPendingQuote,
  SidebarqaSidebarBridge,
  SidebarqaSidebarStore,
} from '../context-types.ts'
import { expandPanelIfCollapsed } from './ensure-panel.ts'
import { resolveMetaQuote } from './meta-quote.ts'
import {
  ASK_TAB,
  HISTORY_TAB,
  type SidebarPort,
  type SidebarPortBodyProps,
  type SidebarPortCapabilities,
  type SidebarPortOpen,
  type SidebarPortScope,
  type SidebarPortTabSpec,
} from './sidebar-port.ts'

/** The props better-sidebar hands a registered tab component. */
interface BetterSidebarTabProps {
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; meta?: unknown }
  visible: boolean
  store?: SidebarqaSidebarStore
}

/**
 * The better-sidebar port, with the one extra capability its settings surface
 * offers: a per-tab gear popup (the "功能配置" entry on the 追问 tab card in the
 * DSH Settings → 侧边卡片 page).
 *
 * This is deliberately NOT on the neutral {@link SidebarPort}: the native
 * sidebar has no per-tab settings surface at all, and inventing one on the port
 * would promise a capability one backend cannot honor. A future native
 * configuration surface belongs in DSH's own settings page.
 */
export interface BetterSidebarPort extends SidebarPort {
  /**
   * Install the settings popup renderer for one registered tab type.
   *
   * better-sidebar reads `settings.render` off the tab DESCRIPTOR, so this
   * re-registers that tab with the renderer attached. Call it right after
   * {@link SidebarPort.registerTab} for the same spec, inside the same effect.
   * @param spec - the tab the popup belongs to (must already be registered).
   * @param render - renders the plugin's own config panel.
   * @returns whether the re-registration succeeded.
   */
  attachSettings(spec: SidebarPortTabSpec, render: () => unknown): boolean
}

/**
 * The bridge for one better-sidebar tab occurrence.
 *
 * Consumed state lives in this closure rather than on the component, so a React
 * re-render with identical props cannot re-consume the same quote.
 * @param port - the port this bridge belongs to (for the panels' own opens).
 * @param service - the better-sidebar service.
 * @param runtimeTabId - the runtime tab id better-sidebar minted at open time.
 * @param metaOf - reads the tab's CURRENT meta (the panel's props snapshot).
 * @param storeOf - reads better-sidebar's state store, when present.
 * @returns the bridge handed to the panel.
 */
export function betterSidebarBridge(
  port: SidebarPort,
  service: SidebarqaBetterSidebarService,
  runtimeTabId: string,
  metaOf: () => unknown,
  storeOf: () => SidebarqaSidebarStore | undefined,
): SidebarqaSidebarBridge {
  /** Set once a quote was handed out, so a re-render cannot hand it out twice. */
  let quoteTaken = false
  return {
    setTitle(title: string): void {
      service.updateTab(runtimeTabId, { title })
    },
    takeQuote(): SidebarqaPendingQuote | null {
      if (quoteTaken) return null
      const quote = resolveMetaQuote(metaOf())
      if (quote === null) return null
      quoteTaken = true
      // Clear the persisted meta too, so a PAGE RELOAD (meta survives in
      // better-sidebar's layout state; this closure does not) cannot resurface
      // the stale quote.
      service.updateTab(runtimeTabId, { meta: undefined })
      return quote
    },
    healVisibility(): void {
      const store = storeOf()
      // An absent store means no session state (no active session), which the
      // helper already treats as a no-op.
      if (store === undefined) return
      expandPanelIfCollapsed(store)
    },
    openHistory(scope): void {
      // better-sidebar's targeted open: the tab lands in the NAMED session's
      // layout state even when that session is not on screen.
      port.openHistory(scope)
    },
  }
}

/**
 * Adapt one spec's body factory to better-sidebar's component contract.
 * @param spec - the registered tab.
 * @param ctx - the plugin's activation context.
 * @param port - the port this body's bridge delegates its own opens to.
 * @param service - the better-sidebar service every body's bridge drives.
 * @param revisionOf - reads the current activation count (the port's stand-in
 *   for the native navigation revision).
 * @returns the component to hand `registerTab`.
 */
function bodyFor(
  spec: SidebarPortTabSpec,
  ctx: Context,
  port: SidebarPort,
  service: SidebarqaBetterSidebarService,
  revisionOf: () => number,
): unknown {
  return function BetterSidebarBody(raw: BetterSidebarTabProps): unknown {
    const capabilities: SidebarPortCapabilities = betterSidebarBridge(
      port,
      service,
      raw.tab.id,
      () => raw.tab.meta,
      () => raw.store,
    )
    const open: SidebarPortOpen = { tabId: raw.tab.id, revision: revisionOf(), capabilities }
    const props: SidebarPortBodyProps = {
      ctx,
      scope: { sessionId: raw.scope.sessionId },
      tab: { id: raw.tab.id },
      visible: raw.visible,
      store: raw.store,
      sidebar: open,
    }
    return spec.component(ctx, open)(props)
  }
}

/**
 * Build the better-sidebar backend.
 * @param service - the injected `ctx.betterSidebar` service.
 * @param ctx - the plugin's activation context, handed to every body.
 * @returns the port.
 */
export function createBetterSidebarPort(service: SidebarqaBetterSidebarService, ctx: Context): BetterSidebarPort {
  const activationListeners = new Set<() => void>()
  /**
   * How many times one of this plugin's tabs has been activated.
   *
   * better-sidebar has no per-tab navigation counter — it re-renders a tab
   * component with fresh props instead — so this is the port's substitute for
   * the native `navigation.revision`. A body re-runs its open-payload read on
   * each value, which is exactly "the tab was focused again".
   */
  let activationCount = 0

  /** The settings renderer installed per tab key, if the host asked for one. */
  const settingsOf = new Map<string, () => unknown>()

  /**
   * Record one activation: bump the revision bodies read, then tell the
   * subscribers (the mounted panels' heal hooks).
   *
   * Re-activation is the whole reason this exists: an open that merely
   * re-focuses an existing tab does not remount it, so the mounted panel must be
   * told to re-check its own visibility AND to re-read its open payload.
   */
  const onActivated = (): void => {
    activationCount += 1
    for (const listener of [...activationListeners]) listener()
  }

  /** Build a descriptor for one spec, with the settings renderer when present. */
  const descriptorOf = (spec: SidebarPortTabSpec, render: (() => unknown) | undefined): never => ({
    id: spec.key,
    title: () => spec.title(),
    icon: (size: number) => spec.icon(size),
    order: spec.order,
    single: true,
    component: bodyFor(spec, ctx, port, service, () => activationCount),
    onActivate: onActivated,
    ...render === undefined ? {} : { settings: { render: () => render() } },
  }) as never

  const port: BetterSidebarPort = {
    backend: 'betterSidebar',

    registerTab(spec: SidebarPortTabSpec): () => void {
      return service.registerTab(descriptorOf(spec, settingsOf.get(spec.key)))
    },

    attachSettings(spec: SidebarPortTabSpec, render: () => unknown): boolean {
      settingsOf.set(spec.key, render)
      try {
        // `registerTab` is idempotent per id: re-registering the same key
        // replaces the descriptor, which is how the renderer gets attached to
        // an already-registered tab.
        service.registerTab(descriptorOf(spec, render))
        return true
      } catch (error) {
        console.warn('[dsh-sidebar-qa] better-sidebar settings registration failed:', error)
        return false
      }
    },

    openAsk(scope: SidebarPortScope, quote?: unknown): void {
      service.openTab(
        { type: ASK_TAB.key, ...quote === undefined ? {} : { meta: { quote } } },
        { sessionId: scope.sessionId },
      )
    },

    openHistory(scope: SidebarPortScope): void {
      service.openTab({ type: HISTORY_TAB.key }, { sessionId: scope.sessionId })
    },

    onActivate(listener: () => void): () => void {
      activationListeners.add(listener)
      return () => { activationListeners.delete(listener) }
    },

    dispose(): void {
      activationListeners.clear()
    },
  }
  return port
}
