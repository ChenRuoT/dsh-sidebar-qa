/**
 * Client half of dsh-sidebar-qa: the selection-capture controller + floating
 * 「添加到对话」/「提问」 popover, and this plugin's two sidebar tabs (追问 /
 * 追问记录).
 *
 * ## The sidebar seam
 *
 * The plugin runs on two right-column backends and does not care which:
 *
 * - **native** — DSH's own dockable right column (`ctx.sidebarRightTabs` /
 *   `ctx.sidebarRight` + the `sidebar.right.pane.tab` slot), available from DSH
 *   0.1.5-alpha.1; and
 * - **betterSidebar** — the third-party `dsh-better-sidebar` framework, which is
 *   what this plugin shipped on before DSH grew its own.
 *
 * `sidebar-port.ts` probes for one (native wins when both are installed) and the
 * matching adapter implements the port. This file is the only place that picks a
 * backend; the panels and every other module speak the port's language.
 *
 * ## Degradation
 *
 * `betterSidebar` is deliberately NOT in the cordis `inject` list any more: a
 * hard dependency would keep the whole plugin inactive on DSH's own sidebar.
 * With NEITHER backend composed, the sidebar tabs are simply not registered —
 * everything else (the selection popover and 「添加到对话」) still works, because
 * neither of those needs a sidebar.
 */
import { createRoot, type Root } from 'react-dom/client'
import { IconQuestionOutline14, IconQueueOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { AskPanel } from './AskPanel.tsx'
import { ConfigPanel } from './ConfigPanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { SelectionPopover } from './SelectionPopover.tsx'
import { createSelectionController } from './selection.ts'
import { attachLocale, en, LOCALE_NS, t, zh } from './locales.ts'
import { insertQuoteIntoComposerDeferred } from './draft-insert.ts'
import { createSidebarqaStore, type SidebarqaStore } from './store.ts'
import { resolveCurrentSessionId } from './current-session.ts'
import type { PendingQuote } from './store.ts'
import { notifyTabActivated } from './tab-activation.ts'
import { installSidebarTabs as installTabs, type SidebarOpener } from './sidebar-install.ts'
import { ASK_TAB, HISTORY_TAB, type SidebarPortTabSpec } from './sidebar-port.ts'

/**
 * Services required before mounting. `remote` is the typed client RPC service
 * and `remote.session` its session namespace — each generated namespace is its
 * own cordis service, so BOTH names must be injected before `ctx.remote.session`
 * may be touched.
 *
 * The sidebar service is NOT here: `betterSidebar` used to be a hard dependency,
 * which disabled the plugin entirely on a deployment whose sidebar is DSH's own.
 * It is probed at runtime instead (see the module doc).
 */
export const inject = ['sessions', 'remote', 'remote.session', 'workspaces']

/**
 * This plugin's two sidebar tab types, in backend-neutral terms.
 * @param store - the plugin's own store, merged into every panel's props.
 * @returns the tab specs; each `kind` matches what the port's opens name.
 */
function sidebarTabSpecs(store: SidebarqaStore): readonly SidebarPortTabSpec[] {
  return [
    {
      key: ASK_TAB.key,
      kind: 'ask',
      title: () => t('askTabTitle'),
      order: ASK_TAB.order,
      icon: (size: number) => <IconQuestionOutline14 size={size} />,
      // The native sidebar's `+` control only re-opens the GUIDE page, and the
      // guide is what lists registered types — without an entry box the tab
      // would only ever be reachable by code. (better-sidebar lists tabs in its
      // own `+` menu and ignores this.)
      guide: [{
        id: 'ask',
        order: 60,
        title: () => t('askTabTitle'),
        description: () => t('askGuideDesc'),
      }],
      component: (ctx, open) => props => (
        <AskPanel {...props} ctx={ctx} sidebar={open} store={store} />
      ),
    },
    {
      key: HISTORY_TAB.key,
      kind: 'history',
      title: () => t('histTabTitle'),
      order: HISTORY_TAB.order,
      icon: (size: number) => <IconQueueOutline14 size={size} />,
      guide: [{
        id: 'history',
        order: 70,
        title: () => t('histTabTitle'),
        description: () => t('histGuideDesc'),
      }],
      component: (ctx, open) => props => (
        <HistoryPanel {...props} ctx={ctx} sidebar={open} store={store} />
      ),
    },
  ]
}

/**
 * Install this plugin's sidebar tabs on whichever backend the deployment has.
 *
 * The returned opener is usable immediately but forwards to the real port only
 * once the backend exists — `ctx.inject` activates its child fiber
 * asynchronously, so nothing about this is synchronous. See
 * `sidebar-install.ts` for why that must not be papered over.
 * @param ctx - the client plugin context.
 * @param opts - the plugin's own store and the activation callback.
 * @returns the opener surface.
 */
export function installSidebarTabs(
  ctx: Context,
  opts: {
    /** The plugin's own store, merged into every panel's props. */
    store: SidebarqaStore
    /** Runs once per activation of one of this plugin's tabs. */
    onActivate?: () => void
  },
): SidebarOpener {
  return installTabs(ctx, {
    specs: () => sidebarTabSpecs(opts.store),
    settingsFor: { kind: 'ask', render: () => <ConfigPanel /> },
    ...opts.onActivate === undefined ? {} : { onActivate: opts.onActivate },
  })
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (sessions, remote, workspaces, and
 *   whichever sidebar backend the deployment composed).
 */
export function apply(ctx: Context): void {
  // An UNCONDITIONAL first line, on purpose: this is the one line that tells a
  // user whether the plugin's fiber activated at all. Everything below can fail
  // silently (a missing service parks the fiber before `apply` even runs, and a
  // parked fiber logs nothing), so without this there is no way to tell "the
  // plugin never ran" from "the plugin ran and registered nothing".
  console.info('[dsh-sidebar-qa] applied')

  // One store and one selection controller per activation (no module-level
  // singletons — the official createXXX factory rule).
  const store = createSidebarqaStore()
  // The controller reads the CURRENT session id at capture time through the same
  // rule the rest of the plugin uses (see `current-session.ts`: the session the
  // main pane retains — NOT a `current` field, which does not exist).
  const selectionController = createSelectionController(
    () => resolveCurrentSessionId(ctx.sessions.list.getSnapshot()) ?? '',
  )

  // ── DSH language ──────────────────────────────────────────────────────────
  // The locale service is OPTIONAL (mirror of the host half's `settings`
  // degradation): without it `t()` falls back to the browser language and every
  // surface still renders, so a DSH build without the locale plugin must not
  // take the panel down. Attaching feeds the module-level t(); registering
  // publishes the dictionaries into DSH's own registry so other surfaces can
  // bind `sidebarQa` instead of importing our t().
  ctx.inject(['locale'], (lctx) => {
    attachLocale(lctx.locale)
    lctx.effect(() => {
      try {
        const offZh = lctx.locale.register(LOCALE_NS, 'zh', zh)
        const offEn = lctx.locale.register(LOCALE_NS, 'en', en)
        return () => { offZh(); offEn() }
      } catch (error) {
        // A duplicate-namespace registration (re-activation racing the
        // disposer) must never disable the plugin — the copy still resolves.
        console.warn('[dsh-sidebar-qa] locale registration failed:', error)
        return () => {}
      }
    }, 'dsh-sidebar-qa: locale dictionaries')
    // Detach on disposal so a disposed activation leaves no dangling service
    // reference in the module holder (HMR safety).
    lctx.effect(() => () => { attachLocale(undefined) }, 'dsh-sidebar-qa: locale detach')
  })

  // ── Sidebar backend ───────────────────────────────────────────────────────
  // One activation callback does both jobs: heal the mounted panel (through the
  // module-level bridge the panels subscribe to) and clear the STORE quote
  // channel — the OPEN's own quote is the panel's to consume, but a
  // collapsed-and-reopened panel must not resurrect the one already sent.
  const sidebar = installSidebarTabs(ctx, {
    store,
    onActivate: () => {
      const sessionId = resolveCurrentSessionId(ctx.sessions.list.getSnapshot())
      if (sessionId !== undefined) store.setPendingQuote(sessionId, null)
      notifyTabActivated()
    },
  })

  // Capture a selection → park the quote → open the ask tab. The quote goes on
  // the OPEN (not only into the store) because an external plugin may also open
  // this tab with a quote of its own; both ride the same channel.
  const onAsk = (quote: PendingQuote, sessionId: string): void => {
    store.setPendingQuote(sessionId, quote)
    sidebar.openAsk({ sessionId }, { quote: quote.text, messageId: quote.messageId, role: quote.role })
  }

  // Capture a selection → append it as a `>` blockquote to the CURRENT
  // session's MAIN composer and focus it, caret at the end. Deliberately does
  // NOT open (or expand) the sidebar — this is the lightweight sibling of 追问.
  // Returns false when the composer could not be reached, so the popover keeps
  // the selection and 提问 stays one click away.
  //
  // It runs DEFERRED because reaching the composer needs the session's Agent
  // scope, which is retained by a React reconciliation: when the quote belongs
  // to a session that is not the one on screen, `sessions.open` makes it visible
  // only on the next frame.
  const onAddToConversation = (quote: PendingQuote, sessionId: string): boolean => {
    insertQuoteIntoComposerDeferred(ctx, sessionId, quote.text)
    return true
  }

  // The floating 「添加到对话」/「提问」 bar (own body host root, fixed-position).
  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-sidebar-qa', '')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(
      <SelectionPopover
        controller={selectionController}
        onAsk={onAsk}
        onAddToConversation={onAddToConversation}
      />,
    )
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-sidebar-qa: selection popover mount')

  // Release the selection listeners on disposal.
  ctx.effect(() => () => { selectionController.dispose() }, 'dsh-sidebar-qa: selection listeners')
}

/**
 * The settings panel, for surfaces that render it themselves (the better-sidebar
 * tab's gear popup today; DSH's own settings page in a later phase).
 */
export { ConfigPanel }
