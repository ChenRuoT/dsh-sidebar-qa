/**
 * The `native` backend of the sidebar port — DSH's own dockable right column
 * (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1).
 *
 * Unlike better-sidebar, a native tab type registers in TWO stages under one
 * implementation `id`:
 *
 * 1. the type itself into `ctx.sidebarRightTabs` (identity, kind, title), and
 * 2. the body into the keyed `sidebar.right.pane.tab` slot under that SAME id —
 *    the seat dispatches on the implementation id, not on the kind.
 *
 * Both stages live inside `ctx.effect`, so a plugin reload unregisters them with
 * the fiber (HMR-safe), exactly like the better-sidebar adapter.
 *
 * ## kind vs key, and why the opens cannot re-derive them
 *
 * A native type has TWO names and they are not interchangeable:
 *
 * - `id` — the implementation identity, unique across every registration, and the
 *   key its body is looked up under in the seat. This plugin uses the tab key
 *   (`dsh-sidebar-qa:ask`).
 * - `kind` — the dispatch name `openTab(kind)` resolves. `placeTab` looks the
 *   registry up BY KIND and throws `no tab type is registered as "<kind>"`
 *   otherwise. This plugin uses the short `ask` / `history`.
 *
 * An earlier revision kept `openAsk`'s kind in a constant derived from the tab
 * KEY, which registered `ask` and opened `dsh-sidebar-qa:ask` — a mismatch that
 * only shows up at click time. The adapter now records each type's kind as it
 * registers it and opens with exactly that value, so the two cannot drift.
 *
 * ## Zero value imports of DSH UI
 *
 * This module reaches the native sidebar purely through cordis services and the
 * slot registry. That is not a style choice: a third-party client bundle may only
 * `require` the nine PLATFORM_MODULES seed words, and DSH policy forbids a
 * feature plugin from requesting another feature plugin's values
 * (`packages/client/AGENTS.md:37,79`). `ui-sidebar-right` is not a seed word, so
 * importing it would fail the purity gate at build time AND the module table at
 * runtime. Its service faces live in `../context-types.ts`, reached with
 * `ctx.get(...)`.
 *
 * ## Differences from the better-sidebar backend
 *
 * - **The quote rides `navigation.params`**, not a tab `meta` blob, and there is
 *   no way to clear it. The adapter remembers what it handed out and re-arms only
 *   when the tab is navigated to again (`navigation.revision`) — that is what
 *   makes a second external open into the same tab deliver its new quote.
 * - **Titles are captured at open time** (`title(address)`), with no per-tab
 *   retitle, so {@link SidebarPortCapabilities.setTitle} is a no-op: an open tab
 *   keeps the language it was opened in until it is reopened.
 * - **Panel healing (issue #6) is unnecessary** — `openTab` expands the column as
 *   part of placing the tab — so `healVisibility` is a no-op too, and the whole
 *   `ensure-panel.ts` module stays better-sidebar-only.
 * - **There is no focus callback**, which the adapter does not need: a body sees
 *   every navigation through `navigation.revision`.
 */
import { useMemo } from 'react'
import type {
  Context,
  SidebarqaNavQuote,
  SidebarqaPendingQuote,
  SidebarqaSidebarRightService,
  SidebarqaSidebarRightTabInfo,
  SidebarqaSidebarRightTabsService,
  SidebarqaSlotsService,
} from '../context-types.ts'
import {
  ASK_TAB,
  HISTORY_TAB,
  type SidebarPort,
  type SidebarPortBodyFactory,
  type SidebarPortBodyProps,
  type SidebarPortCapabilities,
  type SidebarPortOpen,
  type SidebarPortTabSpec,
} from './sidebar-port.ts'

/** What a native tab body's injected `hooks.tabInfo` reader is. */
type UseTabInfo = () => SidebarqaSidebarRightTabInfo

/** The props the native seat hands a tab body. */
interface NativeSeatProps {
  /** The session whose sidebar hosts this tab. */
  sessionId: string
  /** The injected per-tab information hook (stable across renders). */
  useTabInfo: UseTabInfo
}

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
  const record = params as Record<string, unknown> & SidebarqaNavQuote
  if (typeof record.quote !== 'string' || record.quote === '') return null
  const quote: SidebarqaPendingQuote = { text: record.quote }
  if (typeof record.messageId === 'string') quote.messageId = record.messageId
  if (typeof record.role === 'string') quote.role = record.role
  return quote
}

/**
 * The capabilities for one native tab occurrence.
 *
 * The quote and the panel's own 追问记录 open are real here; `setTitle` and
 * `healVisibility` are deliberate no-ops documented above. The consumed flag
 * lives in this closure, so React re-renders cannot hand the same quote out
 * twice within one navigation.
 * @param paramsOf - reads the tab's CURRENT `navigation.params`.
 * @param openHistory - the port's own history open (the 追问记录 tree's 跳转).
 * @returns the capabilities handed to the panel.
 */
export function nativeCapabilities(
  paramsOf: () => unknown,
  openHistory: (scope: { sessionId: string }) => void,
): SidebarPortCapabilities {
  let quoteTaken = false
  return {
    setTitle(): void {
      // The native tab type's `title` was evaluated when the tab opened and the
      // layout record captured it; there is no per-tab retitle. The body's own
      // headings localize live, so the only stale copy is the tab chip.
    },
    takeQuote(): SidebarqaPendingQuote | null {
      if (quoteTaken) return null
      const quote = quoteOfNavParams(paramsOf())
      if (quote === null) return null
      quoteTaken = true
      return quote
    },
    healVisibility(): void {
      // `openTab` expands the column as part of placing the tab, so a type-only
      // open never lands an invisible tab. Nothing to heal.
    },
    openHistory(scope): void {
      openHistory(scope)
    },
  }
}

/**
 * The body component for one spec: it reads the injected tab information hook
 * and renders the (hook-free) panel body under it.
 * @param spec - the registered tab.
 * @param ctx - the plugin's activation context.
 * @param port - the port this body's capabilities delegate the panel's own opens to.
 * @returns the component to register in the seat.
 */
function bodyFor(spec: SidebarPortTabSpec, ctx: Context, port: SidebarPort): unknown {
  return function NativeSidebarBody(props: NativeSeatProps): unknown {
    const tabInfo = props.useTabInfo()
    const { revision } = tabInfo.tab.navigation
    // One capabilities object per navigation: re-created when the tab is
    // navigated to again, which is exactly when the panel must re-read its open
    // payload. Depending on `revision` (not on the params object, which the
    // layout record may rebuild) keeps that contraction explicit.
    const capabilities = useMemo(
      () => nativeCapabilities(() => tabInfo.tab.navigation.params, scope => { port.openHistory(scope) }),
      [revision],
    )
    const open: SidebarPortOpen = { tabId: tabInfo.tab.id, revision, capabilities }
    const bodyProps: SidebarPortBodyProps = {
      ctx,
      scope: { sessionId: props.sessionId },
      tab: { id: tabInfo.tab.id },
      visible: tabInfo.tab.visible,
      sidebar: open,
    }
    return spec.component(ctx, open)(bodyProps)
  }
}

/**
 * Build the native backend.
 * @param tabs - the injected `ctx.sidebarRightTabs` registry.
 * @param sidebar - the injected `ctx.sidebarRight` navigation face.
 * @param slots - the slot registry the seat is declared on.
 * @param ctx - the plugin's activation context, handed to every body.
 * @returns the port.
 */
export function createNativeSidebarPort(
  tabs: SidebarqaSidebarRightTabsService,
  sidebar: SidebarqaSidebarRightService,
  slots: SidebarqaSlotsService,
  ctx: Context,
): SidebarPort {
  /**
   * The kind each contributed type registered under, by tab key.
   *
   * The opens MUST use the same string the type was registered with — the
   * registry resolves `openTab(kind)` by kind — so the value is recorded here at
   * registration instead of being re-derived at open time. Re-deriving is what
   * produced `no tab type is registered as "dsh-sidebar-qa:ask"`: the open named
   * the tab KEY while the registration had used the short kind.
   */
  const kindByKey = new Map<string, string>()

  const port: SidebarPort = {
    backend: 'native',

    registerTab(spec: SidebarPortTabSpec): () => void {
      const disposes: Array<() => void> = []
      kindByKey.set(spec.key, spec.kind)
      // Stage one: what the tab type IS. No `patterns` (this is a PAGE type,
      // opened by kind rather than by resource address) and no `multiple` (one
      // page per kind per pane is what the better-sidebar id's `single: true`
      // already meant). `extension` is the band for a type from outside the
      // product, and it outranks every viewer DSH ships.
      //
      // `guide` is what makes the type DISCOVERABLE: the native strip's `+`
      // control only ever re-opens the guide page, and the guide lists
      // registered types through exactly these entry boxes. Without them the
      // tab can only ever be opened by code.
      disposes.push(tabs.register({
        id: spec.key,
        kind: spec.kind,
        priority: 'extension',
        title: () => spec.title(),
        ...spec.guide === undefined ? {} : { guide: spec.guide },
      }))
      // Stage two: the body, keyed by the SAME implementation id.
      disposes.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
        { name: 'sidebar.right.pane.tab', key: spec.key },
        bodyFor(spec, ctx, port),
      )))
      return () => {
        kindByKey.delete(spec.key)
        for (const dispose of disposes.reverse()) dispose()
      }
    },

    openAsk(_scope, quote?: unknown): void {
      // The quote is the only thing an open carries beyond the kind. The native
      // face has no `meta` and no way to target a session that is not on screen
      // (`_scope`): openTab acts on the mounted session surface, and the caller
      // makes the target session that surface first.
      const kind = kindByKey.get(ASK_TAB.key)
      if (kind === undefined) {
        console.warn('[dsh-sidebar-qa] the ask tab is not registered on this backend; nothing to open.')
        return
      }
      const params = nativeAskParams(quote)
      sidebar.openTab(kind, params === undefined ? undefined : { params })
    },

    openHistory(_scope): void {
      const kind = kindByKey.get(HISTORY_TAB.key)
      if (kind === undefined) return
      sidebar.openTab(kind)
    },

    onActivate(): () => void {
      // No focus callback, and none needed: a body learns of every navigation
      // through `navigation.revision`. Returning a no-op is more honest than
      // synthesizing a signal this backend does not emit.
      return () => {}
    },

    dispose(): void {
      kindByKey.clear()
    },
  }
  return port
}

/**
 * Build the native navigation params for an open.
 * @param quote - the quote to hand the panel, or omitted.
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
