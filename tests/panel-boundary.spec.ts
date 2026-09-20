/**
 * The panel's containment (`src/client/panel-boundary.tsx`).
 *
 * The render path needs a DOM, but the three things that decide whether a crash
 * is CONTAINED and RECOVERABLE rather than a different kind of dead end are plain
 * values: the state the two static methods derive, the element shape
 * {@link containPanel} builds, and the fact that the tab body returns it.
 *
 * Containment itself is asserted structurally, not by rendering: React's server
 * renderer RETHROWS a render error instead of consulting a boundary (verified),
 * while the client renderer — the one this plugin runs under — routes it to the
 * nearest boundary. The shape is what makes that reachable: the panel must be a
 * child ELEMENT, never a call whose result the wrapper returns.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SidebarqaTabComponentProps } from '../src/context-types.ts'
import { containPanel, PanelBoundary } from '../src/client/panel-boundary.tsx'

describe('PanelBoundary.getDerivedStateFromError', () => {
  it('keeps a thrown Error verbatim', () => {
    const error = new Error('boom')
    expect(PanelBoundary.getDerivedStateFromError(error).error).toBe(error)
  })

  it('wraps a thrown non-Error so the strip always has a message', () => {
    // The seat's own boundary would have taken a string the same way; the point
    // is that the strip renders text, never "undefined".
    const state = PanelBoundary.getDerivedStateFromError('boom')
    expect(state.error).toBeInstanceOf(Error)
    expect(state.error?.message).toBe('boom')
  })
})

describe('PanelBoundary.getDerivedStateFromProps', () => {
  const crashed = { error: new Error('boom'), resetKey: 's1' }

  it('keeps the crash face while the panel stays on the same session', () => {
    expect(PanelBoundary.getDerivedStateFromProps({ resetKey: 's1', children: null }, crashed)).toBeNull()
  })

  it('re-attempts the render when the panel moves to another session', () => {
    // Switching conversations is the user's most natural recovery: it must clear
    // the crash face instead of freezing one session's failure onto the next.
    expect(PanelBoundary.getDerivedStateFromProps({ resetKey: 's2', children: null }, crashed))
      .toEqual({ error: null, resetKey: 's2' })
  })
})

describe('containPanel', () => {
  function FakePanel(): null { return null }

  it('mounts the panel as a CHILD of the boundary, carrying the scope key', () => {
    const props = { ctx: {}, scope: { sessionId: 's1' }, tab: { id: 'tab-1' } } as unknown as SidebarqaTabComponentProps
    const tree = containPanel('s1', FakePanel, props)

    expect(tree.type).toBe(PanelBoundary)
    expect(tree.props.resetKey).toBe('s1')
    const child = tree.props.children as { type: unknown; props: SidebarqaTabComponentProps }
    expect(child.type).toBe(FakePanel)
    // `createElement` copies the props object, so this is equality by value.
    expect(child.props).toEqual(props)
  })

  it('is what the tab body returns', () => {
    // A wiring guard, not a style check: dropping the boundary (or going back to
    // CALLING the panel here, which runs it outside the boundary) is a silent
    // regression — the seat then retires the tab body for the whole page and the
    // panel goes white with nothing to read.
    const source = readFileSync(new URL('../src/client/sidebar-native.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/return containPanel\(props\.sessionId, tab\.component, bodyProps\)/)
    expect(source).not.toMatch(/tab\.component\(bodyProps\)/)
  })
})

