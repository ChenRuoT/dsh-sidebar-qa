import { describe, expect, it } from 'vitest'
import {
  expandPanelIfCollapsed,
  expandPatch,
  NARROW_MAX_WIDTH,
  paneIdsOf,
  type SidebarqaPaneNode,
  type SidebarqaPanelState,
  type SidebarqaSidebarStore,
} from '../src/client/ensure-panel.ts'

/** A minimal pane tree builder: leaf(id) and split(children). */
const leaf = (id: string): SidebarqaPaneNode => ({ kind: 'leaf', id })
const split = (...children: SidebarqaPaneNode[]): SidebarqaPaneNode => ({ kind: 'split', id: 's', children })

function stateOf(overrides: Partial<SidebarqaPanelState> = {}): SidebarqaPanelState {
  return {
    panelOpen: true,
    bottomOpen: false,
    activePane: 'pane:1',
    bottomSplits: leaf('pane:bottom'),
    ...overrides,
  }
}

/**
 * A native-era state, exactly what better-sidebar >= 0.19 produces: the
 * plugin's own right panel is gone (no `panelOpen`), the bottom workbench is
 * the only tree, and `activePane` always names a bottom leaf
 * (`makeDefaultState()` / `sanitizeState()`).
 */
function nativeStateOf(overrides: Partial<SidebarqaPanelState> = {}): SidebarqaPanelState {
  return {
    bottomOpen: false,
    activePane: 'pane:bottom',
    bottomSplits: leaf('pane:bottom'),
    ...overrides,
  }
}

describe('paneIdsOf', () => {
  it('returns the leaf id for a leaf', () => {
    expect(paneIdsOf(leaf('pane:1'))).toEqual(['pane:1'])
  })
  it('collects all leaf ids recursively through splits', () => {
    const tree = split(split(leaf('pane:1'), leaf('pane:2')), leaf('pane:3'))
    expect(paneIdsOf(tree)).toEqual(['pane:1', 'pane:2', 'pane:3'])
  })
  it('handles an empty split', () => {
    expect(paneIdsOf({ kind: 'split', id: 's', children: [] })).toEqual([])
  })
})

describe('expandPatch', () => {
  it('returns null when the viewport width is unknown (no window)', () => {
    expect(expandPatch(stateOf({ panelOpen: false }), undefined)).toBeNull()
  })

  it('expands the drawer (panelOpen) on a narrow viewport', () => {
    expect(expandPatch(stateOf({ panelOpen: false }), NARROW_MAX_WIDTH - 1)).toEqual({ panelOpen: true })
  })
  it('is a no-op on a narrow viewport when the drawer is already open', () => {
    expect(expandPatch(stateOf({ panelOpen: true }), NARROW_MAX_WIDTH - 1)).toBeNull()
  })

  it('expands the right panel on a wide viewport when the active pane is in the right tree', () => {
    const state = stateOf({ panelOpen: false, activePane: 'pane:1' })
    expect(expandPatch(state, 1200)).toEqual({ panelOpen: true })
  })
  it('preserves the bottom panel state when expanding the right panel', () => {
    const state = stateOf({ panelOpen: false, bottomOpen: true, activePane: 'pane:1' })
    expect(expandPatch(state, 1200)).toEqual({ panelOpen: true })
  })
  it('is a no-op on a wide viewport when the right panel is already open', () => {
    expect(expandPatch(stateOf({ panelOpen: true }), 1200)).toBeNull()
  })

  it('expands the bottom panel when the active pane lives in the bottom tree', () => {
    const state = stateOf({ panelOpen: true, bottomOpen: false, activePane: 'pane:bottom' })
    expect(expandPatch(state, 1200)).toEqual({ bottomOpen: true })
  })
  it('is a no-op when the bottom panel hosting the active pane is already open', () => {
    const state = stateOf({ panelOpen: true, bottomOpen: true, activePane: 'pane:bottom' })
    expect(expandPatch(state, 1200)).toBeNull()
  })
  it('detects a bottom-tree active pane through nested splits', () => {
    const state = stateOf({
      panelOpen: true,
      bottomOpen: false,
      activePane: 'pane:deep',
      bottomSplits: split(leaf('pane:a'), split(leaf('pane:deep'), leaf('pane:b'))),
    })
    expect(expandPatch(state, 1200)).toEqual({ bottomOpen: true })
  })

  it('falls back to the right panel when there is no active pane', () => {
    expect(expandPatch(stateOf({ panelOpen: false, activePane: null }), 1200)).toEqual({ panelOpen: true })
  })
})

// The regression this block pins down: with better-sidebar >= 0.19 the right
// column is DSH's native Sidebar (which reveals the tab itself) and the bottom
// workbench is the plugin's only tree, whose `activePane` is ALWAYS a bottom
// leaf — so the legacy wide-viewport rule force-opened the bottom panel on
// every 提问. See dsh-sidebar-qa issue #16.
describe('expandPatch — native right Sidebar era (better-sidebar >= 0.19)', () => {
  it('is a no-op on a wide viewport even though activePane lives in the bottom tree', () => {
    const state = nativeStateOf({ activePane: 'pane:bottom', bottomOpen: false })
    expect(expandPatch(state, 1200)).toBeNull()
  })

  it('is a no-op on a wide viewport when the bottom panel is already open', () => {
    expect(expandPatch(nativeStateOf({ bottomOpen: true }), 1200)).toBeNull()
  })

  it('is a no-op on a wide viewport when activePane names a nested bottom leaf', () => {
    const state = nativeStateOf({
      activePane: 'pane:deep',
      bottomSplits: split(leaf('pane:a'), split(leaf('pane:deep'), leaf('pane:b'))),
    })
    expect(expandPatch(state, 1200)).toBeNull()
  })

  it('is a no-op on a narrow viewport (the drawer field is gone upstream)', () => {
    expect(expandPatch(nativeStateOf(), NARROW_MAX_WIDTH - 1)).toBeNull()
  })

  it('is a no-op on an unknown viewport width', () => {
    expect(expandPatch(nativeStateOf(), undefined)).toBeNull()
  })
})

describe('expandPanelIfCollapsed', () => {
  function mockStore(state: SidebarqaPanelState | undefined): {
    store: SidebarqaSidebarStore
    reduced: SidebarqaPanelState[]
  } {
    let current = state
    const reduced: SidebarqaPanelState[] = []
    return {
      store: {
        getSnapshot: () => ({ state: current }),
        reduce: (fn) => {
          current = fn(current as SidebarqaPanelState)
          reduced.push(current)
        },
      },
      reduced,
    }
  }

  it('expands a collapsed right panel and reports success', () => {
    const { store, reduced } = mockStore(stateOf({ panelOpen: false, activePane: 'pane:1' }))
    expect(expandPanelIfCollapsed(store, 1200)).toBe(true)
    expect(reduced).toHaveLength(1)
    expect(reduced[0]!.panelOpen).toBe(true)
  })

  it('expands a collapsed bottom panel when the active pane lives there', () => {
    const { store, reduced } = mockStore(stateOf({ panelOpen: true, bottomOpen: false, activePane: 'pane:bottom' }))
    expect(expandPanelIfCollapsed(store, 1200)).toBe(true)
    expect(reduced[0]!.bottomOpen).toBe(true)
  })

  it('does nothing when the panel is already expanded', () => {
    const { store, reduced } = mockStore(stateOf({ panelOpen: true }))
    expect(expandPanelIfCollapsed(store, 1200)).toBe(false)
    expect(reduced).toHaveLength(0)
  })

  it('does nothing when the sidebar state is missing (no active session)', () => {
    const { store, reduced } = mockStore(undefined)
    expect(expandPanelIfCollapsed(store, 1200)).toBe(false)
    expect(reduced).toHaveLength(0)
  })

  it('does nothing on a native-era state, leaving the bottom panel untouched (issue #16)', () => {
    const { store, reduced } = mockStore(nativeStateOf({ activePane: 'pane:bottom', bottomOpen: false }))
    expect(expandPanelIfCollapsed(store, 1200)).toBe(false)
    // Not just "no bottom patch": the store must not be reduced at all.
    expect(reduced).toHaveLength(0)
  })

  it('falls back to window.innerWidth when no viewport width is injected', () => {
    // Simulate a narrow browser window so the drawer path is exercised.
    const original = (globalThis as { window?: unknown }).window
    Object.defineProperty(globalThis, 'window', {
      value: { innerWidth: NARROW_MAX_WIDTH - 1 },
      configurable: true,
    })
    try {
      const { store, reduced } = mockStore(stateOf({ panelOpen: false }))
      expect(expandPanelIfCollapsed(store)).toBe(true)
      expect(reduced[0]!.panelOpen).toBe(true)
    } finally {
      if (original === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { value: original, configurable: true })
    }
  })
})
