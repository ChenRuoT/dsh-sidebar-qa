/**
 * Client half of dsh-sidebar-qa: the selection-capture controller + floating
 * "提问" popover, and the two better-sidebar tabs (`dsh-sidebar-qa:ask` and
 * `dsh-sidebar-qa:history`). It is a thin consumer of dsh-better-sidebar — it
 * builds no panel chrome (portal/resize/折叠/persistence/settings shell);
 * the panel container is entirely better-sidebar's.
 *
 * The client requires the `betterSidebar` service (hard peer dependency):
 * `inject = ['betterSidebar', ...]` keeps the plugin inactive (no UI, no
 * behavior, no session creation) until better-sidebar provides it.
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
import { createSidebarqaStore } from './store.ts'
import type { PendingQuote } from './store.ts'
import { notifyTabActivated } from './tab-activation.ts'

/** Services required before mounting (provided by the client runtime; betterSidebar by dsh-better-sidebar). */
export const inject = ['betterSidebar', 'sessions', 'connection', 'workspaces']

/**
 * Client plugin body.
 * @param ctx - the client cordis context (betterSidebar, sessions, connection, workspaces).
 */
export function apply(ctx: Context): void {
  // One store and one selection controller per activation (no module-level
  // singletons — the official createXXX factory rule).
  const store = createSidebarqaStore()
  const selectionController = createSelectionController(() => ctx.sessions.list.getSnapshot().current ?? '')

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

  // Capture a selection → park the quote → open the ask tab.
  const onAsk = (quote: PendingQuote, sessionId: string): void => {
    store.setPendingQuote(sessionId, quote)
    ctx.betterSidebar.openTab({ type: 'dsh-sidebar-qa:ask' })
  }

  // The floating "提问" button (own body host root, fixed-position).
  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-sidebar-qa', '')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(<SelectionPopover controller={selectionController} onAsk={onAsk} />)
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-sidebar-qa: selection popover mount')

  // The two sidebar tabs (registered through better-sidebar's service).
  ctx.effect(() => {
    const offAsk = ctx.betterSidebar.registerTab({
      id: 'dsh-sidebar-qa:ask',
      title: () => t('askTabTitle'),
      icon: (size: number) => <IconQuestionOutline14 size={size} />,
      order: 60,
      single: true,
      // The "功能配置" entry: a gear button on the 追问 card in the DSH
      // Settings → 侧边卡片 page, opening this panel to edit the `sidebarqa`
      // settings namespace (better-sidebar v0.12.0+ renders `settings.render`).
      settings: {
        render: () => <ConfigPanel />,
      },
      component: (props) => <AskPanel {...props} bsStore={props.store} store={store} />,
      // Re-activation heal (issue #6): when the user collapsed the panel and
      // clicks 提问 again, openTab only re-focuses the existing tab (no
      // remount) — the activation signal lets the mounted panel self-heal.
      onActivate: () => notifyTabActivated(),
    })
    const offHistory = ctx.betterSidebar.registerTab({
      id: 'dsh-sidebar-qa:history',
      title: () => t('histTabTitle'),
      icon: (size: number) => <IconQueueOutline14 size={size} />,
      order: 70,
      single: true,
      component: (props) => <HistoryPanel {...props} bsStore={props.store} store={store} />,
      onActivate: () => notifyTabActivated(),
    })
    return () => {
      offAsk()
      offHistory()
    }
  }, 'dsh-sidebar-qa: register sidebar tabs')

  // Release the selection listeners on disposal.
  ctx.effect(() => () => { selectionController.dispose() }, 'dsh-sidebar-qa: selection listeners')
}
