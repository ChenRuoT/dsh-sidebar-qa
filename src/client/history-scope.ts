/**
 * Workspace scoping for the 追问记录 (history) tab: pure helpers that resolve
 * the workspace owning the current session and restrict the parent→children
 * tree to that workspace's sessions. Zero dependencies, unit-tested.
 *
 * The workspace membership source is the client `workspaces` service list
 * (the same feed the DSH runtime uses to scope new-session creation — see
 * `startSession` in @deepseek-ai/dsh-client-runtime's workspaces service):
 * every workspace row carries the ordered `sessionIds` it accounts for, and
 * the "current workspace" is the workspace whose `sessionIds` contains the
 * currently active session. A 追问 (follow-up) session is always created in
 * its parent's workspace, so a whole tree lives in exactly one workspace —
 * filtering on either end of an edge keeps that invariant.
 */
import type { SidebarqaWorkspaceView } from '../context-types.ts'

/** The workspace owning a session (undefined when the session is ungrouped). */
export function workspaceOwningSession(
  workspaces: readonly SidebarqaWorkspaceView[],
  sessionId: string,
): SidebarqaWorkspaceView | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
}

/**
 * Restrict a parent→children history tree to one workspace: keep only edges
 * whose parent AND child are in the allowed set. A parent outside the set is
 * dropped with its whole subtree (its follow-ups share its workspace); a
 * parent inside the set keeps only its in-workspace children (an empty
 * children list renders the parent as a leaf row).
 */
export function filterHistoryToWorkspace(
  parentToChildren: Record<string, string[]>,
  allowedSessionIds: ReadonlySet<string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [parentId, children] of Object.entries(parentToChildren)) {
    if (!allowedSessionIds.has(parentId)) continue
    out[parentId] = children.filter(child => allowedSessionIds.has(child))
  }
  return out
}

/**
 * The tree roots: parents that are not themselves a child in the map. Recompute
 * this on the FILTERED map — a child whose parent was filtered out must not
 * resurface as a root (it belongs to another workspace's subtree).
 */
export function rootsOf(parentToChildren: Record<string, string[]>): string[] {
  const childSet = new Set<string>()
  for (const children of Object.values(parentToChildren)) {
    for (const child of children) childSet.add(child)
  }
  return Object.keys(parentToChildren).filter(id => !childSet.has(id))
}

/**
 * The most recent activity (`updatedAt`) across a node and its whole subtree —
 * the "最近访问时间" of one conversation group. Returns undefined when no
 * session in the subtree has a timestamp yet (e.g. still hydrating). A visited
 * set guards against a corrupted map forming a cycle.
 */
export function subtreeLatestUpdatedAt(
  id: string,
  parentToChildren: Record<string, string[]>,
  updatedAtOf: (sessionId: string) => number | undefined,
): number | undefined {
  const seen = new Set<string>()
  const visit = (sessionId: string): number | undefined => {
    if (seen.has(sessionId)) return undefined
    seen.add(sessionId)
    let latest = updatedAtOf(sessionId)
    for (const child of parentToChildren[sessionId] ?? []) {
      const childLatest = visit(child)
      if (childLatest !== undefined && (latest === undefined || childLatest > latest)) latest = childLatest
    }
    return latest
  }
  return visit(id)
}
