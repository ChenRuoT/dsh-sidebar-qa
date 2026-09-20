/**
 * Backend selection and tab installation: the half of `index.tsx` that knows
 * about the two sidebar backends but nothing about React, JSX, or this plugin's
 * panels.
 *
 * It lives apart from `index.tsx` on purpose. `index.tsx` imports the panels,
 * the icons, and `react-dom/client`, so importing it in a Node test drags in a
 * chain ending at a `.module.css` file the Node ESM loader refuses to parse.
 * Keeping the seam here makes "which backend won, what did it receive, what
 * happens on activation" testable under the project's plain `node` environment
 * (`tests/sidebar-seam.spec.ts`), while `index.tsx` stays the only module that
 * needs a DOM.
 *
 * ## Why this is reactive, and why it does NOT use `ctx.inject`
 *
 * The sidebar services frequently do not exist yet when this plugin's `apply`
 * runs: `sidebarRightTabs` is published by `ui-sidebar-right`'s own `apply`, and
 * which of the two fibers lands first is composition order, not something a
 * plugin may assume. The contribution therefore has to wait for whichever
 * backend shows up.
 *
 * The obvious-looking tool for that is `ctx.inject(deps, cb)`, and it is the
 * WRONG one here. In cordis, **every key of the `inject` descriptor is a
 * REQUIREMENT**: `Fiber._refresh` walks `Object.keys(this.inject)` and drops the
 * fiber to `INACTIVE` the moment any one of them has no implementation, so the
 * callback only runs once ALL of them exist. There is no optional-dependency
 * form — `{ name: null }` is not "optional", it is "required, and I want to
 * intercept it with `null`".
 *
 * That distinction is invisible until it bites: `ctx.inject({ sidebarRightTabs:
 * null, betterSidebar: null }, cb)` demands that BOTH sidebars are installed at
 * once, which no real deployment does, so the callback never ran and this plugin
 * registered nothing while still reporting a clean activation.
 *
 * So the seam reads services with `ctx.get()` — which needs no inject at all,
 * exactly like `ui-conversation`'s `conversation` — and re-checks whenever cordis
 * publishes any service, through the `internal/service` event that
 * `ReflectService.notify` emits.
 */
import type { Context } from '../context-types.ts'
import { resolveCurrentSessionId } from './current-session.ts'
import { createBetterSidebarPort, type BetterSidebarPort } from './sidebar-better-sidebar.ts'
import { createNativeSidebarPort } from './sidebar-native.ts'
import {
  detectSidebarBackend,
  nativeSidebarServicesOf,
  slotsServiceOf,
  type SidebarPort,
  type SidebarPortTabSpec,
} from './sidebar-port.ts'

/** Whether a port is the better-sidebar backend (it alone has a settings popup). */
export function isBetterSidebarPort(port: SidebarPort): port is BetterSidebarPort {
  return port.backend === 'betterSidebar'
}

/**
 * Build the sidebar port a context can actually drive.
 *
 * Native wins when both are installed: it is the first-party surface, and
 * running the same tabs in two columns would show the plugin twice.
 * @param ctx - a context that has (or will have) at least one backend's services.
 * @returns the port, or undefined when nothing this deployment offers is usable.
 */
export function createSidebarPort(ctx: Context): SidebarPort | undefined {
  const backend = detectSidebarBackend(ctx)
  if (backend === 'native') {
    const services = nativeSidebarServicesOf(ctx)
    const slots = slotsServiceOf(ctx)
    // A native sidebar without its slot registry cannot host a body: a
    // registered type with no body entry renders the sidebar owner's "nothing
    // can view this" notice instead of the panel. `slots` belongs to
    // ui-renderer, which the graph puts before this plugin, so its absence is a
    // composition fault worth reporting rather than papering over.
    if (services === undefined || slots === undefined) {
      console.warn(
        '[dsh-sidebar-qa] the native sidebar is mounted but its slot registry is not available '
        + `(sidebar services=${String(services !== undefined)}, slots=${String(slots !== undefined)}); `
        + 'the sidebar tabs cannot be registered.',
      )
      return undefined
    }
    return createNativeSidebarPort(services.tabs, services.sidebar, slots, ctx)
  }
  if (backend === 'betterSidebar') {
    const service = ctx.get('betterSidebar')
    if (service === undefined) return undefined
    return createBetterSidebarPort(service, ctx)
  }
  return undefined
}

/**
 * The plugin's handle onto whichever sidebar backend ends up being used.
 *
 * This is deliberately NOT the port. `installSidebarTabs` cannot know the
 * backend when it returns — the services may be published later — so a caller
 * that captured a returned port would hold `undefined` forever.
 *
 * The opener surface is therefore available immediately and forwards to the real
 * port once there is one. An open before any backend exists is a no-op, which is
 * the honest answer: there is nowhere to open it yet.
 */
export interface SidebarOpener {
  /** Which backend is live; undefined until a backend is installed. */
  readonly backend: () => string | undefined
  /** Open the ask tab. @see SidebarPort.openAsk */
  openAsk(scope: { sessionId: string }, quote?: unknown): void
  /** Open the history tab. @see SidebarPort.openHistory */
  openHistory(scope: { sessionId: string }): void
}

/**
 * Install this plugin's sidebar tabs on whichever backend the deployment has,
 * as soon as that backend exists, and return the opener surface.
 *
 * The contribution is owned by this plugin's effect, so it unregisters with the
 * plugin (HMR-safe) and re-registers if the backend is replaced.
 * @param ctx - the client plugin context.
 * @param opts - the tab specs, the settings popup renderer, and the activation callback.
 * @returns the opener surface (always usable; a no-op until a backend arrives).
 */
export function installSidebarTabs(
  ctx: Context,
  opts: {
    /** The tab types to contribute, in menu order (read once per install). */
    specs: () => readonly SidebarPortTabSpec[]
    /** The kind whose tab carries the better-sidebar settings popup, if any. */
    settingsFor?: { kind: string; render: () => unknown }
    /** Runs once per activation of one of this plugin's tabs. */
    onActivate?: () => void
  },
): SidebarOpener {
  /** The live port, once a backend has been installed. */
  let port: SidebarPort | undefined
  /** Set once a backend was found, so later service arrivals are ignored. */
  let settled = false

  const installIfPossible = (): void => {
    if (settled) return
    const installed = createSidebarPort(ctx)
    if (installed === undefined) return
    settled = true
    port = installed

    const specs = opts.specs()
    const disposers = specs.map(spec => installed.registerTab(spec))
    // The 功能配置 entry. Only the better-sidebar backend has a per-tab settings
    // popup; on the native backend the same controls belong in DSH's own
    // settings page (a later phase), so the request is dropped rather than
    // faked.
    if (opts.settingsFor !== undefined && isBetterSidebarPort(installed)) {
      const { kind, render } = opts.settingsFor
      const target = specs.find(spec => spec.kind === kind)
      if (target !== undefined) installed.attachSettings(target, render)
    }
    const offActivate = installed.onActivate(() => { opts.onActivate?.() })
    console.info(`[dsh-sidebar-qa] registered ${String(specs.length)} sidebar tabs on the ${installed.backend} backend`)

    ctx.effect(() => () => {
      offActivate()
      for (const dispose of disposers.reverse()) dispose()
      installed.dispose()
      if (port === installed) port = undefined
      settled = false
    }, `dsh-sidebar-qa: ${installed.backend} sidebar tab registrations`)
  }

  ctx.effect(() => {
    // Any service publication may be the sidebar backend we are waiting for.
    // `internal/service` is emitted by `ReflectService.notify` on every
    // `provide`, so this is exactly "a service arrived".
    const off = ctx.on('internal/service', () => { installIfPossible() })
    // A backend may already be composed (the common case), so look once now.
    installIfPossible()
    return off
  }, 'dsh-sidebar-qa: sidebar backend watch')

  // A backend-less deployment still gets this plugin's non-sidebar surfaces, so
  // say why the tabs are missing instead of leaving the user guessing.
  const warnIfNoBackend = (): void => {
    if (settled || detectSidebarBackend(ctx) !== 'none') return
    console.warn(
      '[dsh-sidebar-qa] no sidebar backend (neither DSH\'s native sidebar nor dsh-better-sidebar); '
      + 'the selection popover stays available, the sidebar tabs do not.',
    )
  }
  warnIfNoBackend()
  queueMicrotask(warnIfNoBackend)

  return {
    backend: () => port?.backend,
    openAsk: (scope, quote) => {
      console.info(`[dsh-sidebar-qa] openAsk requested (backend=${String(port?.backend)}, session=${scope.sessionId})`)
      // Opening is a UI gesture whose failure is otherwise invisible: the
      // popover has already closed itself by the time this runs, so an escaping
      // error looks exactly like "the button did nothing".
      try {
        showSessionFirst(ctx, scope.sessionId)
        port?.openAsk(scope, quote)
      } catch (error) {
        console.error('[dsh-sidebar-qa] openAsk failed:', error)
      }
    },
    openHistory: scope => {
      try {
        showSessionFirst(ctx, scope.sessionId)
        port?.openHistory(scope)
      } catch (error) {
        console.error('[dsh-sidebar-qa] openHistory failed:', error)
      }
    },
  }
}

/**
 * Put `sessionId` on screen before an open, when it is not already there.
 *
 * The NATIVE navigation face acts on the session surface that is MOUNTED: its
 * `openTab` resolves the bound seat and throws `sidebarRight: no session surface
 * is mounted` when there is none. A quote can belong to a session other than the
 * visible one (the selection is captured against the active session, and the user
 * may switch before clicking), so the open must make its target visible first.
 * better-sidebar needs no such step — its `openTab` takes an explicit scope and
 * targets that session's stored layout directly — so this is only ever the first
 * switch (to whatever is already current there, it is a no-op).
 *
 * Best-effort by design: this is a nicety in front of the actual open, so a
 * deployment without the client sessions service (or one whose feed cannot say
 * what is current) must not lose the open over it.
 * @param ctx - the client plugin context.
 * @param sessionId - the session the open belongs to.
 */
function showSessionFirst(ctx: Context, sessionId: string): void {
  if (sessionId === '') return
  const sessions = ctx.sessions
  if (sessions === undefined || typeof sessions.open !== 'function') return
  const current = resolveCurrentSessionId(sessions.list.getSnapshot())
  if (current === sessionId) return
  console.info(`[dsh-sidebar-qa] switching to session ${sessionId} before opening (was ${String(current)})`)
  sessions.open(sessionId)
}
