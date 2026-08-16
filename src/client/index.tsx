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
import { createSidebarqaStore } from './store.ts'
import type { PendingQuote } from './store.ts'

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
      title: () => '追问',
      icon: (size: number) => <IconQuestionOutline14 size={size} />,
      order: 60,
      single: true,
      // The "功能配置" entry: a gear button on the 追问 card in the DSH
      // Settings → 侧边卡片 page, opening this panel to edit the `sidebarqa`
      // settings namespace (better-sidebar v0.12.0+ renders `settings.render`).
      settings: {
        render: () => <ConfigPanel />,
      },
      component: (props) => <AskPanel {...props} store={store} />,
    })
    const offHistory = ctx.betterSidebar.registerTab({
      id: 'dsh-sidebar-qa:history',
      title: () => '追问记录',
      icon: (size: number) => <IconQueueOutline14 size={size} />,
      order: 70,
      single: true,
      component: (props) => <HistoryPanel {...props} store={store} />,
    })
    return () => {
      offAsk()
      offHistory()
    }
  }, 'dsh-sidebar-qa: register sidebar tabs')

  // Release the selection listeners on disposal.
  ctx.effect(() => () => { selectionController.dispose() }, 'dsh-sidebar-qa: selection listeners')
}
