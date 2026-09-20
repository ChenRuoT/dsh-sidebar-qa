/**
 * Client half of dsh-sidebar-qa: the selection-capture controller + floating
 * 「添加到对话」/「提问」 popover, and this plugin's two sidebar tabs (追问 /
 * 追问记录).
 *
 * ## The sidebar seam
 *
 * The tabs go into DSH's OWN dockable right column
 * (`@deepseek-ai/dsh-client-ui-sidebar-right`, DSH ≥ 0.1.5-alpha.1).
 * `sidebar-native.ts` owns that vocabulary — it probes for the services, registers
 * the types, their bodies and their live titles, and opens them. This file only
 * describes its two tabs in that module's terms; the panels never see a service.
 *
 * ## Degradation
 *
 * The sidebar services are deliberately NOT in the cordis `inject` list, and must
 * never be added to it: cordis has no optional-dependency form, so an injected
 * service that a host does not provide parks this plugin's fiber — and a parked
 * fiber fails the ENTIRE web boot rather than skipping this plugin. They are
 * probed with `ctx.get` instead. On a DSH without the native sidebar the tabs are
 * simply not registered; everything else (the selection popover and
 * 「添加到对话」) still works, because neither of those needs a sidebar.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '../context-types.ts'
import { AskPanel } from './AskPanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { SelectionPopover } from './SelectionPopover.tsx'
import { createSelectionController } from './selection.ts'
import { attachLocale, en, LOCALE_NS, t, zh } from './locales.ts'
import { insertQuoteIntoComposerDeferred } from './draft-insert.ts'
import { createSidebarqaStore, type SidebarqaStore } from './store.ts'
import { resolveCurrentSessionId } from './current-session.ts'
import type { PendingQuote } from './store.ts'
import { ConfigSection } from './settings-section.tsx'
import { installSettingsSection } from './settings-slot.ts'
import { installSidebarTabs, type SidebarTab } from './sidebar-native.ts'

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
 * This plugin's two sidebar tabs, in `sidebar-native.ts`'s terms.
 *
 * Each tab spells out `id` and `kind` separately on purpose. `id` is the
 * implementation identity DSH keys the body and the live-title seats by; `kind`
 * is the dispatch name `openTab` resolves. Deriving either from the other is what
 * once registered a type as `ask` and then opened `dsh-sidebar-qa:ask`.
 * @param store - the plugin's own store, merged into every panel's props.
 * @returns the tab descriptors.
 */
function sidebarTabSpecs(store: SidebarqaStore): readonly SidebarTab[] {
  return [
    {
      role: 'ask',
      id: 'dsh-sidebar-qa:ask',
      kind: 'ask',
      order: 60,
      title: () => t('askTabTitle'),
      description: () => t('askGuideDesc'),
      component: props => <AskPanel {...props} store={store} />,
    },
    {
      role: 'history',
      id: 'dsh-sidebar-qa:history',
      kind: 'history',
      order: 70,
      title: () => t('histTabTitle'),
      description: () => t('histGuideDesc'),
      component: props => <HistoryPanel {...props} store={store} />,
    },
  ]
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

  // ── Sidebar ───────────────────────────────────────────────────────────────
  // Registered on DSH's own right column as soon as it exists: the services may
  // be published after this plugin's `apply`, so the opener is a forwarding
  // surface rather than a service handle. Nothing about this is synchronous.
  const sidebar = installSidebarTabs(ctx, { tabs: sidebarTabSpecs(store) })

  // ── Settings page ─────────────────────────────────────────────────────────
  // The config panel lives in DSH's own settings as a section. Independent of the
  // sidebar (and of whether the sidebar exists at all), so it is installed on its own.
  installSettingsSection(ctx, { label: () => t('cfgNavLabel'), component: ConfigSection })

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
  // It runs DEFERRED because the session FEED may not have named a current session
  // yet, and because `uiWorkspace.openSession` refuses an id the controller cannot
  // resolve — both of which the next frame can cure.
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
