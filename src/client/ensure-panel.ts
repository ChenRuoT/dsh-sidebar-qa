/**
 * Self-healing panel expansion for type-only tab opens.
 *
 * Background (dsh-sidebar-qa issue #6): better-sidebar only auto-expands a
 * collapsed panel for CONTENT opens (a `path`/`url` seed). Type-only opens —
 * exactly what `onAsk` uses to open the 追问 tab — land the tab inside the
 * invisible collapsed panel, so the user sees "clicked 提问, nothing
 * happened". The better-sidebar service exposes no panel-expansion method
 * (`togglePanel` is an internal store reducer), so this plugin expands the
 * panel itself through the ONE public seam it has: the `SidebarStore` handed
 * to every tab component (`TabComponentProps.store`).
 *
 * The expansion rule mirrors better-sidebar's own content-open rule
 * (`service.ts` openTab): on a narrow viewport (<768px) the two workbenches
 * merge into a single drawer and `panelOpen` is the only lever; on a wide
 * viewport the landing pane is the active pane — expand the bottom panel when
 * it lives in the bottom tree, else the right panel.
 *
 * The module is pure and dependency-free (no node-only imports) so the
 * decision logic is unit-testable; the only "impure" entry point is
 * `expandPanelIfCollapsed`, which reads `window.innerWidth` (guarded) and
 * calls `store.reduce`.
 */

/** Viewport widths strictly below this are "mobile" (mirror of better-sidebar's NARROW_MAX_WIDTH). */
export const NARROW_MAX_WIDTH = 768

/** The pane tree shape this plugin touches (mirror of better-sidebar's SplitNode). */
export interface SidebarqaPaneNode {
  kind: 'leaf' | 'split'
  id: string
  children?: SidebarqaPaneNode[]
}

/** The SidebarState fields this module reads (mirror of better-sidebar's SidebarState). */
export interface SidebarqaPanelState {
  panelOpen: boolean
  bottomOpen: boolean
  /** The pane receiving newly opened tabs (ids unique across both trees). */
  activePane: string | null
  /** The bottom panel's split tree. */
  bottomSplits: SidebarqaPaneNode
}

/** Field overrides to apply to the sidebar state (absent fields stay untouched). */
export interface SidebarqaPanelPatch {
  panelOpen?: boolean
  bottomOpen?: boolean
}

/** The SidebarStore face this plugin consumes (mirror of better-sidebar's SidebarStore). */
export interface SidebarqaSidebarStore {
  getSnapshot(): { sessionId?: string; state?: SidebarqaPanelState }
  reduce(reducer: (state: SidebarqaPanelState) => SidebarqaPanelState): void
}

/** All leaf pane ids under a split node. */
export function paneIdsOf(node: SidebarqaPaneNode): string[] {
  if (node.kind === 'leaf') return [node.id]
  const children = node.children ?? []
  const ids: string[] = []
  for (const child of children) ids.push(...paneIdsOf(child))
  return ids
}

/**
 * The expansion patch needed so a freshly opened tab lands in sight, or null
 * when nothing needs to change. Mirrors better-sidebar's content-open
 * auto-expand rule:
 * - unknown viewport width → null (the runtime skips auto-expand without a
 *   window too);
 * - narrow viewport → `panelOpen` is the only lever (merged drawer);
 * - wide viewport → expand the panel hosting the active pane: the bottom
 *   panel when the active pane lives in `bottomSplits`, else the right panel.
 */
export function expandPatch(
  state: SidebarqaPanelState,
  viewportWidth: number | undefined,
): SidebarqaPanelPatch | null {
  if (viewportWidth === undefined) return null
  if (viewportWidth < NARROW_MAX_WIDTH) {
    return state.panelOpen ? null : { panelOpen: true }
  }
  if (state.activePane !== null && paneIdsOf(state.bottomSplits).includes(state.activePane)) {
    return state.bottomOpen ? null : { bottomOpen: true }
  }
  return state.panelOpen ? null : { panelOpen: true }
}

/**
 * Expand the collapsed panel hosting this plugin's tabs, if needed. Safe to
 * call from a tab component's mount effect (or any other point with the
 * store in hand); a no-op when the sidebar state is missing (no active
 * session) or already expanded. Returns true when it expanded. `viewportWidth`
 * is injectable for tests; absent, it falls back to `window.innerWidth`.
 */
export function expandPanelIfCollapsed(store: SidebarqaSidebarStore, viewportWidth?: number): boolean {
  const state = store.getSnapshot().state
  if (state === undefined) return false
  const width = viewportWidth ?? (typeof window === 'undefined' ? undefined : window.innerWidth)
  const patch = expandPatch(state, width)
  if (patch === null) return false
  store.reduce((s) => ({ ...s, ...patch }))
  return true
}
