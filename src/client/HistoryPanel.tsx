/**
 * The `dsh-side-qa:history` tab: every follow-up session grouped by its ROOT
 * (main) session, rendered as a layered tree (main → follow-up → nested
 * follow-up). Clicking a node jumps into it. The tree is driven by the
 * plugin's self-maintained parent→children mapping.
 */
import { useSyncExternalStore } from 'react'
import type { Context, SideqaTabComponentProps } from '../context-types.ts'
import type { SideqaStore } from './store.ts'
import css from './history-panel.module.css'

interface HistoryPanelProps extends SideqaTabComponentProps {
  store: SideqaStore
}

export function HistoryPanel({ ctx, store }: HistoryPanelProps) {
  const snapshot = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  const parentToChildren = snapshot.parentToChildren

  // Roots = sessions that have children but are not themselves a child.
  const childSet = new Set(Object.keys(snapshot.childToParent))
  const roots = Object.keys(parentToChildren).filter(id => !childSet.has(id))

  if (roots.length === 0) {
    return (
      <div className={css.root}>
        <div className={css.empty}>还没有追问记录。在对话中划选文本并点击「提问」即可生成。</div>
      </div>
    )
  }

  return (
    <div className={css.root} role="tree" aria-label="追问记录">
      {roots.map((rootId) => (
        <TreeNode
          key={rootId}
          ctx={ctx}
          id={rootId}
          depth={0}
          parentToChildren={parentToChildren}
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
  parentToChildren: Record<string, string[]>
}) {
  const { ctx, id, depth, parentToChildren } = props
  const children = parentToChildren[id] ?? []
  const isRoot = depth === 0
  return (
    <div className={css.group}>
      <button
        type="button"
        role="treeitem"
        aria-expanded={children.length > 0}
        aria-level={depth + 1}
        className={isRoot ? css.mainRow : css.sideRow}
        onClick={() => { ctx.sessions.open(id) }}
      >
        {isRoot && <span className={css.dot} />}
        <span className={isRoot ? css.mainLabel : css.sideLabel}>
          {isRoot ? '' : '❓ '}{titleOf(ctx, id)}
        </span>
      </button>
      {children.length > 0 && (
        <div role="group" className={css.children}>
          {children.map((childId) => (
            <TreeNode
              key={childId}
              ctx={ctx}
              id={childId}
              depth={depth + 1}
              parentToChildren={parentToChildren}
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
