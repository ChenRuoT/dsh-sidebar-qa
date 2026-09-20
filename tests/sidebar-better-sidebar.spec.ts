import { describe, expect, it, vi } from 'vitest'
import type {
  Context,
  SidebarqaBetterSidebarService,
  SidebarqaPendingQuote,
  SidebarqaTabDescriptor,
} from '../src/context-types.ts'
import { betterSidebarBridge, createBetterSidebarPort } from '../src/client/sidebar-better-sidebar.ts'
import { ASK_TAB, HISTORY_TAB, type SidebarPortTabSpec } from '../src/client/sidebar-port.ts'

/**
 * A recording double for the better-sidebar service.
 *
 * The adapter's whole job is to translate the port's vocabulary into this
 * service's, so the assertion surface IS the recorded calls.
 */
function fakeService(): {
  registered: SidebarqaTabDescriptor[]
  opened: Array<{ seed: Record<string, unknown>; scope: unknown }>
  updated: Array<{ id: string; patch: Record<string, unknown> }>
  failNextRegister: () => void
  service: SidebarqaBetterSidebarService
} {
  const registered: SidebarqaTabDescriptor[] = []
  const opened: Array<{ seed: Record<string, unknown>; scope: unknown }> = []
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = []
  let failNextRegister = false
  return {
    registered,
    opened,
    updated,
    failNextRegister: () => { failNextRegister = true },
    service: {
      registerTab(descriptor: SidebarqaTabDescriptor) {
        if (failNextRegister) {
          failNextRegister = false
          throw new Error('registration refused')
        }
        registered.push(descriptor)
        return () => {}
      },
      openTab(seed: Record<string, unknown>, scope?: unknown) {
        opened.push({ seed, scope })
      },
      updateTab(id: string, patch: Record<string, unknown>) {
        updated.push({ id, patch })
      },
    } as unknown as SidebarqaBetterSidebarService,
  }
}

/** A context double: the port only ever passes it through to body factories. */
const ctx = {} as Context

/** A spec whose body records the props it was handed. */
function specOf(kind: 'ask' | 'history' = 'ask', seen?: { props?: unknown }): SidebarPortTabSpec {
  return {
    key: kind === 'ask' ? ASK_TAB.key : HISTORY_TAB.key,
    kind,
    title: () => 'TITLE',
    order: 60,
    icon: () => null,
    component: (_ctx, open) => (props) => {
      if (seen !== undefined) seen.props = { props, open }
      return null
    },
  }
}
describe('createBetterSidebarPort', () => {
  it('registers a single-instance tab under the spec key, with its title and order', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    port.registerTab(specOf('ask'))

    expect(fake.registered).toHaveLength(1)
    const descriptor = fake.registered[0]
    expect(descriptor?.id).toBe(ASK_TAB.key)
    expect(descriptor?.order).toBe(60)
    expect(descriptor?.single).toBe(true)
    expect(typeof descriptor?.title === 'function' ? descriptor.title() : descriptor?.title).toBe('TITLE')
    expect(typeof descriptor?.onActivate).toBe('function')
  })

  it('opens the ask tab with the quote on the tab meta, scoped to the named session', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    port.openAsk({ sessionId: 's1' }, { quote: 'quoted', messageId: 'm1', role: 'assistant' })

    expect(fake.opened).toHaveLength(1)
    expect(fake.opened[0]?.seed).toEqual({
      type: ASK_TAB.key,
      meta: { quote: { quote: 'quoted', messageId: 'm1', role: 'assistant' } },
    })
    expect(fake.opened[0]?.scope).toEqual({ sessionId: 's1' })
  })

  it('opens the ask tab with no meta when there is no quote', () => {
    const fake = fakeService()
    createBetterSidebarPort(fake.service, ctx).openAsk({ sessionId: 's1' })
    expect(fake.opened[0]?.seed).toEqual({ type: ASK_TAB.key })
  })

  it('opens the history tab without meta', () => {
    const fake = fakeService()
    createBetterSidebarPort(fake.service, ctx).openHistory({ sessionId: 's2' })
    expect(fake.opened[0]?.seed).toEqual({ type: HISTORY_TAB.key })
    expect(fake.opened[0]?.scope).toEqual({ sessionId: 's2' })
  })

  it('relays the descriptor activation to every subscriber and clears them on dispose', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    const first = vi.fn()
    const second = vi.fn()
    port.onActivate(first)
    const off = port.onActivate(second)
    port.registerTab(specOf('ask'))

    const onActivate = fake.registered[0]?.onActivate as () => void
    onActivate()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    off()
    onActivate()
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)

    port.dispose()
    onActivate()
    expect(first).toHaveBeenCalledTimes(2)
  })

  it('bumps the revision bodies read on every activation', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    const seen: Array<{ revision?: number }> = []
    port.registerTab({
      ...specOf('ask'),
      component: (_ctx, open) => () => {
        seen.push({ revision: open.revision })
        return null
      },
    })

    const body = (fake.registered[0]?.component as (raw: unknown) => unknown)
    const rawProps = { scope: { sessionId: 's1' }, tab: { id: 't1' }, visible: true }
    body(rawProps)
    expect(seen[0]?.revision).toBe(0)

    const onActivate = fake.registered[0]?.onActivate as () => void
    onActivate()
    body(rawProps)
    expect(seen[1]?.revision).toBe(1)
  })

  it('attaches a settings renderer by re-registering the same tab', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    port.registerTab(specOf('ask'))
    expect(fake.registered[0]).not.toHaveProperty('settings')

    expect(port.attachSettings(specOf('ask'), () => 'PANEL')).toBe(true)
    expect(fake.registered).toHaveLength(2)
    const descriptor = fake.registered[1]
    expect(descriptor?.id).toBe(ASK_TAB.key)
    expect(descriptor?.settings?.render?.({ close: () => {} })).toBe('PANEL')
  })

  it('reports a refused settings registration instead of throwing', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fake.failNextRegister()
    expect(port.attachSettings(specOf('ask'), () => 'PANEL')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('betterSidebarBridge', () => {
  const fakeBridge = (meta: unknown = undefined) => {
    const fake = fakeService()
    let current = meta
    const bridge = betterSidebarBridge(
      createBetterSidebarPort(fake.service, ctx),
      fake.service,
      't1',
      () => current,
      () => undefined,
    )
    return { fake, bridge, setMeta: (next: unknown) => { current = next } }
  }

  it('takes a valid quote once and clears the persisted meta', () => {
    const { fake, bridge } = fakeBridge({ quote: ' hello ', messageId: 'm1' })
    const quote: SidebarqaPendingQuote | null = bridge.takeQuote()
    expect(quote).toEqual({ text: ' hello ', messageId: 'm1' })
    // The meta is cleared for the page-reload path...
    expect(fake.updated).toEqual([{ id: 't1', patch: { meta: undefined } }])
    // ...and the closure refuses to hand the same quote out twice.
    expect(bridge.takeQuote()).toBeNull()
  })

  it('returns null for an absent or malformed meta and stays armed', () => {
    const { bridge, setMeta } = fakeBridge(undefined)
    expect(bridge.takeQuote()).toBeNull()
    expect(bridge.takeQuote()).toBeNull()
    setMeta({ quote: 42 })
    expect(bridge.takeQuote()).toBeNull()
    setMeta({ quote: 'now valid' })
    expect(bridge.takeQuote()).toEqual({ text: 'now valid' })
  })

  it('pushes the title through updateTab', () => {
    const { fake, bridge } = fakeBridge()
    bridge.setTitle('NEW')
    expect(fake.updated).toEqual([{ id: 't1', patch: { title: 'NEW' } }])
  })

  it('does nothing when no panel store was handed over (nothing to heal)', () => {
    const { bridge } = fakeBridge()
    expect(() => { bridge.healVisibility() }).not.toThrow()
  })

  it('delegates its own history open back to the port', () => {
    const fake = fakeService()
    const port = createBetterSidebarPort(fake.service, ctx)
    const bridge = betterSidebarBridge(port, fake.service, 't1', () => undefined, () => undefined)
    bridge.openHistory({ sessionId: 's9' })
    expect(fake.opened[0]?.seed).toEqual({ type: HISTORY_TAB.key })
    expect(fake.opened[0]?.scope).toEqual({ sessionId: 's9' })
  })
})
