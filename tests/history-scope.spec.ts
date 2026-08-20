import { describe, expect, it } from 'vitest'
import type { SidebarqaWorkspaceView } from '../src/context-types.ts'
import {
  filterHistoryToWorkspace, removeSubtree, rootsOf, sessionStatus, subtreeIds,
  subtreeLatestUpdatedAt, workspaceOwningSession,
} from '../src/client/history-scope.ts'

function workspace(id: string, sessionIds: string[]): SidebarqaWorkspaceView {
  return { workspaceId: id, title: `ws-${id}`, sessionIds }
}

describe('workspaceOwningSession', () => {
  it('finds the workspace whose sessionIds contains the session', () => {
    const items = [workspace('a', ['s1']), workspace('b', ['s2', 's3'])]
    expect(workspaceOwningSession(items, 's2')?.workspaceId).toBe('b')
    expect(workspaceOwningSession(items, 's1')?.workspaceId).toBe('a')
  })

  it('returns the first matching workspace for a session accounted twice', () => {
    const items = [workspace('a', ['s1']), workspace('b', ['s1'])]
    expect(workspaceOwningSession(items, 's1')?.workspaceId).toBe('a')
  })

  it('returns undefined for an ungrouped session or an empty list', () => {
    expect(workspaceOwningSession([], 's1')).toBeUndefined()
    expect(workspaceOwningSession([workspace('a', ['s1'])], 'missing')).toBeUndefined()
  })
})

describe('filterHistoryToWorkspace', () => {
  it('keeps only edges whose parent and child are both in the workspace', () => {
    const tree = { main1: ['side1', 'side2'], side1: ['nested'] }
    const allowed = new Set(['main1', 'side1', 'nested']) // side2 lives elsewhere
    expect(filterHistoryToWorkspace(tree, allowed)).toEqual({
      main1: ['side1'],
      side1: ['nested'],
    })
  })

  it('drops a parent (and its whole subtree) outside the workspace', () => {
    const tree = { main1: ['side1'], main2: ['side2'], side1: ['nested'] }
    const allowed = new Set(['main2', 'side2'])
    expect(filterHistoryToWorkspace(tree, allowed)).toEqual({
      main2: ['side2'],
    })
  })

  it('keeps an in-workspace parent as a leaf when all its children are out', () => {
    const tree = { main1: ['side1'] }
    const allowed = new Set(['main1'])
    expect(filterHistoryToWorkspace(tree, allowed)).toEqual({ main1: [] })
  })

  it('returns an empty map when nothing is in the workspace', () => {
    const tree = { main1: ['side1'] }
    expect(filterHistoryToWorkspace(tree, new Set(['other']))).toEqual({})
  })
})

describe('rootsOf', () => {
  it('finds parents that are not themselves children', () => {
    const tree = { main1: ['side1', 'side2'], side1: ['nested'] }
    expect(rootsOf(tree)).toEqual(['main1'])
  })

  it('does not resurface a child whose parent was filtered out', () => {
    // side1's parent was dropped by a workspace filter → side1 must not become
    // a root of the filtered tree (it belongs to another workspace's subtree).
    const tree = filterHistoryToWorkspace(
      { main1: ['side1'], side1: ['nested'] },
      new Set(['side1', 'nested']),
    )
    expect(tree).toEqual({ side1: ['nested'] })
    expect(rootsOf(tree)).toEqual(['side1'])
  })
})

describe('subtreeLatestUpdatedAt', () => {
  const updatedAt: Record<string, number> = { main1: 100, side1: 200, side2: 50, nested: 300 }

  it('returns the newest updatedAt across a node and its whole subtree', () => {
    const tree = { main1: ['side1', 'side2'], side1: ['nested'] }
    const of = (id: string): number | undefined => updatedAt[id]
    expect(subtreeLatestUpdatedAt('main1', tree, of)).toBe(300) // nested is newest
    expect(subtreeLatestUpdatedAt('side1', tree, of)).toBe(300)
    expect(subtreeLatestUpdatedAt('side2', tree, of)).toBe(50)
  })

  it('returns undefined when no session in the subtree has a timestamp', () => {
    const tree = { main1: ['side1'], side1: ['nested'] }
    expect(subtreeLatestUpdatedAt('main1', tree, () => undefined)).toBeUndefined()
  })

  it('tolerates missing timestamps in parts of the subtree', () => {
    const tree = { main1: ['side1', 'side2'] }
    const of = (id: string): number | undefined => (id === 'side1' ? 99 : undefined)
    expect(subtreeLatestUpdatedAt('main1', tree, of)).toBe(99)
  })

  it('guards against a cyclic map (corrupted localStorage)', () => {
    const tree = { a: ['b'], b: ['a'] }
    const of = (id: string): number | undefined => (id === 'a' ? 1 : 2)
    expect(subtreeLatestUpdatedAt('a', tree, of)).toBe(2)
  })
})

describe('sessionStatus', () => {
  it('live when present in the session feed and not archived', () => {
    expect(sessionStatus('s1', { s1: {} }, new Set())).toBe('live')
  })

  it('archived wins over a present feed entry (archive check comes first)', () => {
    expect(sessionStatus('s1', { s1: {} }, new Set(['s1']))).toBe('archived')
  })

  it('archived even when the feed no longer lists the session', () => {
    expect(sessionStatus('s1', {}, new Set(['s1']))).toBe('archived')
  })

  it('gone when absent from the feed and not archived', () => {
    expect(sessionStatus('s1', {}, new Set())).toBe('gone')
  })
})

describe('subtreeIds', () => {
  const tree = { main1: ['side1', 'side2'], side1: ['nested'], side2: [] }

  it('collects the node and all descendants', () => {
    expect(subtreeIds(tree, 'main1').sort()).toEqual(['main1', 'side1', 'side2', 'nested'].sort())
    expect(subtreeIds(tree, 'side1')).toEqual(['side1', 'nested'])
    expect(subtreeIds(tree, 'side2')).toEqual(['side2'])
  })

  it('includes the root itself even without a mapping key', () => {
    expect(subtreeIds({}, 'unknown')).toEqual(['unknown'])
  })

  it('terminates on a cyclic map (corrupted localStorage)', () => {
    const cyclic = { a: ['b'], b: ['a'] }
    expect(subtreeIds(cyclic, 'a').sort()).toEqual(['a', 'b'].sort())
  })
})

describe('removeSubtree', () => {
  it('unlinks the root from its parent and keeps siblings', () => {
    const tree = { main1: ['side1', 'side2'], side1: ['nested'], side2: [] }
    expect(removeSubtree(tree, 'side1')).toEqual({ main1: ['side2'], side2: [] })
  })

  it('drops the whole subtree so descendants do not resurface as roots', () => {
    const tree = { main1: ['side1'], side1: ['nested'], nested: [] }
    const next = removeSubtree(tree, 'main1')
    expect(next).toEqual({})
    expect(rootsOf(next)).toEqual([])
  })

  it('drops dangling references to removed descendants (corrupted map)', () => {
    // nested is referenced by main2 but lives under the removed side1 subtree.
    // The dangling edge is pruned; main1 — side1's real parent — stays as an
    // empty-shell leaf (same convention as filterHistoryToWorkspace).
    const tree = { main1: ['side1'], side1: ['nested'], main2: ['nested'] }
    expect(removeSubtree(tree, 'side1')).toEqual({ main1: [], main2: [] })
  })

  it('returns the input map unchanged for an unknown id', () => {
    const tree = { main1: ['side1'] }
    expect(removeSubtree(tree, 'unknown')).toBe(tree)
  })
})
