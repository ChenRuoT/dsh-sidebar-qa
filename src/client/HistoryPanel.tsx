/**
 * The `dsh-sidebar-qa:history` tab: every follow-up session grouped by its ROOT
 * (main) session, rendered as a layered tree (main → follow-up → nested
 * follow-up). Clicking a node jumps into it. The tree is driven by the
 * plugin's self-maintained parent→children mapping, restricted to the CURRENT
 * workspace: only sessions accounted in the workspace owning the active
 * session are shown (mirror of the DSH runtime's current-workspace projection
 * over the `workspaces` list, where each workspace carries its sessionIds).
 *
 * Rows with follow-ups (leaf nodes) carry a right-aligned fold button whose
 * chevron rotates with the collapse state, and the row's most recent activity
 * time to its left — the same compact relative label ("刚刚"/"5分钟"/…) the
 * DSH left (workspace browser) panel uses.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SidebarqaSessionListSnapshot, SidebarqaTabComponentProps } from '../context-types.ts'
import type { SidebarqaStore } from './store.ts'
import { expandPanelIfCollapsed, type SidebarqaSidebarStore } from './ensure-panel.ts'
import { onTabActivated } from './tab-activation.ts'
import { filterHistoryToWorkspace, rootsOf, sessionStatus, subtreeLatestUpdatedAt, workspaceOwningSession } from './history-scope.ts'
import { timeLabel } from './history-time.ts'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import css from './history-panel.module.css'

interface HistoryPanelProps extends Omit<SidebarqaTabComponentProps, 'store'> {
  store: SidebarqaStore
  /** The better-sidebar state store (self-healing panel expansion, issue #6). */
  bsStore?: SidebarqaSidebarStore
}

/** How often the relative-time labels refresh while the tab is visible. */
const NOW_TICK_MS = 60_000

export function HistoryPanel({ ctx, store, scope, visible, bsStore, tab }: HistoryPanelProps) {
  // Follow the DSH language: t() reads at call time, so this single root
  // re-render re-localizes the whole tree (keep it free of React.memo).
  const localeRevision = useLocaleRevision()
  const snapshot = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  const tabId = tab.id

  // An OPEN tab's title is a plain string persisted in better-sidebar's
  // per-session state, so the registerTab title thunk (live in the + menu)
  // never re-runs for it. Re-push it whenever the language changes; every
  // other session's tab heals the moment the user visits it. updateTab
  // short-circuits an unchanged title, so the mount-time call is free.
  useEffect(() => {
    ctx.betterSidebar.updateTab(tabId, { title: t('histTabTitle') })
  }, [ctx, tabId, localeRevision])

  // Self-healing panel expansion (issue #6): the 追问记录 tab is also opened
  // by a type-only openTab (+ menu / 跳转), which never auto-expands a
  // collapsed panel. Heal on mount (fresh tab) and on re-activation (the
  // panel was collapsed since the tab's last focus — openTab only re-focuses,
  // never remounts).
  useEffect(() => {
    if (bsStore === undefined) return
    expandPanelIfCollapsed(bsStore)
    return onTabActivated(() => expandPanelIfCollapsed(bsStore))
  }, [bsStore])

  // The workspace feed (session↔workspace membership is not in the session
  // list; the workspaces list is the authoritative projection).
  const workspaceList = useSyncExternalStore(
    (cb: () => void) => ctx.workspaces.list.subscribe(cb),
    () => ctx.workspaces.list.getSnapshot(),
  )
  const sessionList = useSyncExternalStore(
    (cb: () => void) => ctx.sessions.list.subscribe(cb),
    () => ctx.sessions.list.getSnapshot(),
  )

  // Relative-time labels need a fresh "now" (mirror of the left panel's render
  // clock); tick while the tab is visible so "5分钟" does not go stale.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, NOW_TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [visible])

  // Current workspace = the one owning the active session (same projection as
  // the DSH runtime's startSession). When no workspace can be resolved (no
  // active session, or it is still ungrouped), fall back to the unfiltered
  // tree so records are never hidden by an undeterminable scope.
  const currentSessionId = scope.sessionId !== '' ? scope.sessionId : sessionList.current
  const currentWorkspace = currentSessionId === undefined
    ? undefined
    : workspaceOwningSession(workspaceList.items, currentSessionId)
  const parentToChildren = currentWorkspace === undefined
    ? snapshot.parentToChildren
    : filterHistoryToWorkspace(snapshot.parentToChildren, new Set(currentWorkspace.sessionIds))

  // Archive set (registry-global): an archived session is hidden from every
  // workspace's sessionIds but still accounted — its mapping row survives, so
  // it must be classified explicitly instead of relying on the workspace filter.
  const archivedIds = new Set(workspaceList.archivedSessionIds)

  const roots = rootsOf(parentToChildren)

  if (roots.length === 0) {
    return (
      <div className={css.root}>
        <div className={css.empty}>
          {currentWorkspace === undefined ? t('histEmptyAll') : t('histEmptyWorkspace')}
        </div>
      </div>
    )
  }

  return (
    <div className={css.root} role="tree" aria-label={t('histTabTitle')}>
      {currentWorkspace !== undefined && (
        <div className={css.workspaceLabel}>{t('histWorkspace', { name: currentWorkspace.title || currentWorkspace.workspaceId })}</div>
      )}
      {roots.map((rootId) => (
        <TreeNode
          key={rootId}
          ctx={ctx}
          id={rootId}
          depth={0}
          store={store}
          sessionList={sessionList}
          now={now}
          parentToChildren={parentToChildren}
          archivedIds={archivedIds}
        />
      ))}
    </div>
  )
}

/** One tree node: the session row plus its recursive children. */
function TreeNode(props: {
  ctx: Context
  id: string
  depth: number
  store: SidebarqaStore
  sessionList: SidebarqaSessionListSnapshot
  now: number
  parentToChildren: Record<string, string[]>
  archivedIds: ReadonlySet<string>
}) {
  const { ctx, id, depth, store, sessionList, now, parentToChildren, archivedIds } = props
  const children = parentToChildren[id] ?? []
  const isRoot = depth === 0
  const hasChildren = children.length > 0
  const collapsed = store.isCollapsed(id)

  // Stale classification: archived (DSH-side archive, feed may still list it)
  // or gone (deleted / not yet hydrated). Stale rows are non-navigable and
  // offer a "移除" entry that prunes the whole subtree from the mapping.
  const status = sessionStatus(id, sessionList.byId, archivedIds)
  const stale = status !== 'live'

  // The row's recent-activity time: the newest `updatedAt` across the whole
  // subtree (a conversation group's "最近访问"), formatted like the left panel.
  const updatedAt = subtreeLatestUpdatedAt(id, parentToChildren, sid => sessionList.byId[sid]?.updatedAt)
  const time = updatedAt === undefined ? undefined : timeLabel(updatedAt, now)

  return (
    <div className={css.group}>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? !collapsed : undefined}
        aria-disabled={stale || undefined}
        className={`${isRoot ? css.mainRow : css.sideRow}${stale ? ` ${css.stale}` : ''}`}
      >
        <button
          type="button"
          className={stale ? `${css.rowOpen} ${css.rowOpenDisabled}` : css.rowOpen}
          disabled={stale}
          onClick={() => { openConversation(ctx, id, sessionList.byId[id]?.cwd) }}
        >
          {isRoot && <span className={css.dot} />}
          <span className={isRoot ? css.mainLabel : css.sideLabel}>
            {titleOf(ctx, id)}
          </span>
          {stale && (
            <span className={css.staleBadge}>
              {status === 'archived' ? t('histArchived') : t('histDeleted')}
            </span>
          )}
        </button>
        {time !== undefined && <span className={css.time}>{time}</span>}
        {stale ? (
          <button
            type="button"
            className={css.remove}
            title={t('histRemoveTitle')}
            onClick={() => { store.removeSession(id) }}
          >
            {t('commonRemove')}
          </button>
        ) : hasChildren ? (
          <button
            type="button"
            className={css.collapse}
            aria-label={collapsed ? t('histExpand') : t('histCollapse')}
            aria-expanded={!collapsed}
            onClick={() => { store.toggleCollapsed(id) }}
          >
            <IconTriangleRightFill14 className={collapsed ? css.arrow : `${css.arrow} ${css.arrowOpen}`} />
          </button>
        ) : (
          <span className={css.collapseSpacer} aria-hidden="true" />
        )}
      </div>
      {hasChildren && !collapsed && (
        <div role="group" className={css.children}>
          {children.map((childId) => (
            <TreeNode
              key={childId}
              ctx={ctx}
              id={childId}
              depth={depth + 1}
              store={store}
              sessionList={sessionList}
              now={now}
              parentToChildren={parentToChildren}
              archivedIds={archivedIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Resolve a session's display title (fallback to the id). */
function titleOf(ctx: Context, id: string): string {
  try {
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    if (summary?.displayTitle !== undefined && summary.displayTitle !== '') return summary.displayTitle
    if (summary?.title !== undefined && summary.title !== '') return summary.title
  } catch {
    // fall through to the id
  }
  return id
}

/**
 * Jump into a conversation from the 追问记录 tree, keeping the 追问记录 tab
 * open in the TARGET session's sidebar state: `sessions.open` switches the
 * active conversation, then `betterSidebar.openTab(seed, scope)` lands the
 * tab in that session's state — focusing it if already open, creating it if
 * not — regardless of what tabs the target session had before (better-sidebar
 * v0.12+ targeted open; the tab is `single: true`, so the dedupe focuses).
 */
function openConversation(ctx: Context, sessionId: string, cwd: string | undefined): void {
  ctx.sessions.open(sessionId)
  ctx.betterSidebar.openTab(
    { type: 'dsh-sidebar-qa:history' },
    { sessionId, ...(cwd === undefined ? {} : { cwd }) },
  )
}
