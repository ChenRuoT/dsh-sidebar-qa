import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenerCount, notifyTabActivated, onTabActivated } from '../src/client/tab-activation.ts'

// The bridge keeps module-level state; every test registers through `track`
// and afterEach unregisters everything so no listener leaks between cases.
const disposers: Array<() => void> = []
function track(listener: () => void): () => void {
  const off = onTabActivated(listener)
  disposers.push(off)
  return off
}
afterEach(() => {
  while (disposers.length > 0) disposers.pop()!()
})

describe('tab-activation bridge', () => {
  it('notifies every registered listener', () => {
    const a = vi.fn()
    const b = vi.fn()
    track(a)
    track(b)
    notifyTabActivated()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('the disposer unregisters the listener', () => {
    const a = vi.fn()
    track(a)
    const off = track(vi.fn())
    off()
    notifyTabActivated()
    expect(a).toHaveBeenCalledTimes(1)
    expect(listenerCount()).toBe(1)
  })

  it('listenerCount reflects registrations', () => {
    expect(listenerCount()).toBe(0)
    track(() => {})
    track(() => {})
    expect(listenerCount()).toBe(2)
  })

  it('a listener registered during a notification is not called in that round', () => {
    const late = vi.fn()
    track(() => {
      track(late)
    })
    notifyTabActivated()
    expect(late).not.toHaveBeenCalled()
  })
})
