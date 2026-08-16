import { describe, expect, it } from 'vitest'
import { createSidebarqaStore } from '../src/client/store.ts'

describe('createSidebarqaStore', () => {
  it('tracks parent→child mapping and its reverse index', () => {
    const store = createSidebarqaStore()
    store.addChild('main1', 'side1')
    store.addChild('main1', 'side2')
    expect(store.childrenOf('main1')).toEqual(['side1', 'side2'])
    expect(store.parentOf('side1')).toBe('main1')
    expect(store.parentOf('side2')).toBe('main1')
  })

  it('dedupes repeated child ids and refuses self-parenting', () => {
    const store = createSidebarqaStore()
    store.addChild('main1', 'side1')
    store.addChild('main1', 'side1')
    store.addChild('x', 'x')
    expect(store.childrenOf('main1')).toEqual(['side1'])
    expect(store.childrenOf('x')).toEqual([])
  })

  it('supports nested follow-ups and resolves roots', () => {
    const store = createSidebarqaStore()
    store.addChild('main1', 'side1')
    store.addChild('side1', 'side2') // nested
    expect(store.isSideSession('side1')).toBe(true)
    expect(store.isSideSession('side2')).toBe(true)
    expect(store.isSideSession('main1')).toBe(false)
    expect(store.rootOf('side2')).toBe('main1')
    expect(store.rootOf('side1')).toBe('main1')
    expect(store.rootOf('main1')).toBe('main1')
  })

  it('stores and clears pending quotes per session', () => {
    const store = createSidebarqaStore()
    store.setPendingQuote('s1', { text: 'q' })
    expect(store.getSnapshot().pendingBySession.s1).toEqual({ text: 'q' })
    store.setPendingQuote('s1', null)
    expect(store.getSnapshot().pendingBySession.s1).toBeUndefined()
  })

  it('returns a stable snapshot reference between mutations (useSyncExternalStore contract)', () => {
    const store = createSidebarqaStore()
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before) // no fresh object per read
    store.addChild('main1', 'side1')
    const after = store.getSnapshot()
    expect(after).not.toBe(before) // changed after a mutation
    expect(store.getSnapshot()).toBe(after) // stable again
  })

  it('marks a side session as titled exactly once', () => {
    const store = createSidebarqaStore()
    expect(store.isTitled('side1')).toBe(false)
    store.markTitled('side1')
    expect(store.isTitled('side1')).toBe(true)
    store.markTitled('side1') // idempotent
    expect(store.isTitled('side1')).toBe(true)
    expect(store.isTitled('other')).toBe(false)
  })
})
