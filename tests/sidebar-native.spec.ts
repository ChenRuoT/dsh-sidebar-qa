import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  Context,
  SidebarqaSidebarRightService,
  SidebarqaSidebarRightTabDefinition,
  SidebarqaSidebarRightTabInfo,
  SidebarqaSidebarRightTabsService,
  SidebarqaSlotsService,
} from '../src/context-types.ts'
import {
  createNativeSidebarPort,
  nativeCapabilities,
  quoteOfNavParams,
} from '../src/client/sidebar-native.ts'
import { ASK_TAB, HISTORY_TAB, type SidebarPortTabSpec } from '../src/client/sidebar-port.ts'

/**
 * Doubles for the two native services plus the slot registry.
 *
 * The native adapter's contract is: register the type in one place, the body in
 * the other under the SAME id, and open by the registered kind.
 */
function fakeNative(): {
  types: SidebarqaSidebarRightTabDefinition[]
  slotInjections: Array<{ name: string; component: unknown }>
  opened: Array<{ kind: string; options: unknown }>
  slots: SidebarqaSlotsService
  tabs: SidebarqaSidebarRightTabsService
  sidebar: SidebarqaSidebarRightService
} {
  const types: SidebarqaSidebarRightTabDefinition[] = []
  const slotInjections: Array<{ name: string; component: unknown }> = []
  const opened: Array<{ kind: string; options: unknown }> = []
  const slots = {
    inject(_name: string, contribute: () => () => void) {
      contribute()
      return () => {}
    },
    register(options: { name: string; key?: string }, component: unknown) {
      slotInjections.push({ name: options.name, component })
      return () => {}
    },
    has: () => true,
  }
  const tabs = {
    register(definition: SidebarqaSidebarRightTabDefinition) {
      types.push(definition)
      return () => {}
    },
  }
  const sidebar = {
    openTab(kind: string, options?: unknown) {
      opened.push({ kind, options })
    },
    focus: () => {},
    isExpanded: () => false,
  }
  return {
    types,
    slotInjections,
    opened,
    slots: slots as unknown as SidebarqaSlotsService,
    tabs: tabs as unknown as SidebarqaSidebarRightTabsService,
    sidebar: sidebar as unknown as SidebarqaSidebarRightService,
  }
}

const ctx = {} as Context

/**
 * A spec whose KIND differs from its KEY, exactly like the real ones
 * (`dsh-sidebar-qa:ask` registered as kind `ask`). Keeping them different is the
 * point: an adapter that re-derives one from the other registers under a kind it
 * never opens, which DSH answers with
 * `no tab type is registered as "<kind>"`.
 */
function specOf(kind: 'ask' | 'history' = 'ask'): SidebarPortTabSpec {
  return {
    key: kind === 'ask' ? ASK_TAB.key : HISTORY_TAB.key,
    kind,
    title: () => 'TITLE',
    order: 60,
    icon: () => null,
    component: () => () => null,
  }
}

describe('quoteOfNavParams', () => {
  it('accepts the rich payload and keeps its optional fields', () => {
    expect(quoteOfNavParams({ quote: 'q', messageId: 'm1', role: 'assistant' }))
      .toEqual({ text: 'q', messageId: 'm1', role: 'assistant' })
  })

  it('rejects everything that carries no usable quote', () => {
    expect(quoteOfNavParams(undefined)).toBeNull()
    expect(quoteOfNavParams(null)).toBeNull()
    expect(quoteOfNavParams('q')).toBeNull()
    expect(quoteOfNavParams({})).toBeNull()
    expect(quoteOfNavParams({ quote: '' })).toBeNull()
    expect(quoteOfNavParams({ quote: 42 })).toBeNull()
  })
})

describe('nativeCapabilities', () => {
  it('hands the quote over exactly once', () => {
    const capabilities = nativeCapabilities(() => ({ quote: 'q' }), () => {})
    expect(capabilities.takeQuote()).toEqual({ text: 'q' })
    expect(capabilities.takeQuote()).toBeNull()
  })

  it('stays armed while the payload carries no quote', () => {
    let params: unknown = { other: true }
    const capabilities = nativeCapabilities(() => params, () => {})
    expect(capabilities.takeQuote()).toBeNull()
    params = { quote: 'later' }
    expect(capabilities.takeQuote()).toEqual({ text: 'later' })
  })

  it('is a documented no-op for title and panel healing', () => {
    const capabilities = nativeCapabilities(() => undefined, () => {})
    expect(() => { capabilities.setTitle('ignored'); capabilities.healVisibility() }).not.toThrow()
  })

  it('delegates its own history open to the port', () => {
    const openHistory = vi.fn()
    nativeCapabilities(() => undefined, openHistory).openHistory({ sessionId: 's1' })
    expect(openHistory).toHaveBeenCalledWith({ sessionId: 's1' })
  })
})

describe('createNativeSidebarPort', () => {
  it('registers the type as an extension page type and the body under the same id', () => {
    const fake = fakeNative()
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab(specOf('ask'))

    expect(fake.types).toHaveLength(1)
    expect(fake.types[0]).toMatchObject({ id: ASK_TAB.key, kind: 'ask', priority: 'extension' })
    // No `patterns`: this is a page type opened by kind, not a resource viewer.
    expect(fake.types[0]).not.toHaveProperty('patterns')
    expect((fake.types[0]?.title as (address: string) => string)('sidebar://x')).toBe('TITLE')

    expect(fake.slotInjections).toHaveLength(1)
    expect(fake.slotInjections[0]?.name).toBe('sidebar.right.pane.tab')
  })

  it('opens by the REGISTERED kind, carrying the quote as navigation params', () => {
    const fake = fakeNative()
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab(specOf('ask'))
    port.openAsk({ sessionId: 's1' }, { quote: 'q', messageId: 'm1', role: 'user' })

    // The kind that was OPENED must be the one that was REGISTERED. Asserting
    // against a constant would not catch a drift between the two — the real bug
    // was registering `ask` while opening `dsh-sidebar-qa:ask`.
    expect(fake.opened).toEqual([{
      kind: fake.types[0]?.kind,
      options: { params: { quote: 'q', messageId: 'm1', role: 'user' } },
    }])
    expect(fake.opened[0]?.kind).toBe('ask')
  })

  it('opens a kind that differs from the tab key', () => {
    const fake = fakeNative()
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab({ ...specOf('ask'), kind: 'ask' })
    port.openAsk({ sessionId: 's1' })

    expect(fake.opened[0]?.kind).toBe('ask')
    expect(fake.opened[0]?.kind).not.toBe(ASK_TAB.key)
  })

  it('refuses to open an ask tab that was never registered', () => {
    const fake = fakeNative()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // No registration: opening would otherwise reach DSH with an unknown kind
    // and throw out of a click handler.
    createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx).openAsk({ sessionId: 's1' })
    expect(fake.opened).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not registered'))
    warn.mockRestore()
  })

  it('accepts a bare string quote and omits params otherwise', () => {
    const fake = fakeNative()
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab(specOf('ask'))
    port.openAsk({ sessionId: 's1' }, 'bare')
    port.openAsk({ sessionId: 's1' })

    expect(fake.opened[0]?.options).toEqual({ params: { quote: 'bare' } })
    expect(fake.opened[1]?.options).toBeUndefined()
  })

  it('opens the history tab under its own registered kind, without params', () => {
    const fake = fakeNative()
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab(specOf('history'))
    port.openHistory({ sessionId: 's1' })
    expect(fake.opened).toEqual([{ kind: 'history', options: undefined }])
  })

  it('disposes both registrations in reverse order', () => {
    const order: string[] = []
    const fake = fakeNative()
    const tabs = { register: () => { order.push('type'); return () => { order.push('untype') } } }
    const slots = {
      // Faithful to the contract: `inject` returns the DISPOSER of whatever the
      // contribution registered, which is what the adapter chains.
      inject: (_name: string, contribute: () => () => void) => contribute(),
      register: () => { order.push('body'); return () => { order.push('unbody') } },
      has: () => true,
    }
    const port = createNativeSidebarPort(tabs, fake.sidebar, slots, ctx)
    const dispose = port.registerTab(specOf('ask'))
    dispose()
    expect(order).toEqual(['type', 'body', 'unbody', 'untype'])
  })

  it('renders a body with the seat session id and a live revision read', () => {
    const fake = fakeNative()
    const seen: Array<{ sessionId?: string; revision?: number; visible?: boolean }> = []
    const port = createNativeSidebarPort(fake.tabs, fake.sidebar, fake.slots, ctx)
    port.registerTab({
      ...specOf('ask'),
      component: () => props => {
        seen.push({
          sessionId: props.scope.sessionId,
          revision: props.sidebar?.revision,
          visible: props.visible,
        })
        return createElement('span', null, 'BODY')
      },
    })

    const tabInfo = (revision: number): SidebarqaSidebarRightTabInfo => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'p1' },
      tab: {
        id: 'tab-1',
        visible: true,
        navigation: { address: 'sidebar://ask', params: { quote: 'q' }, revision },
      },
    })

    const body = fake.slotInjections[0]?.component as (props: unknown) => unknown
    const markup = renderToStaticMarkup(createElement(
      body as never,
      { sessionId: 's1', useTabInfo: () => tabInfo(4) } as never,
    ))

    expect(markup).toContain('BODY')
    expect(seen[0]).toEqual({ sessionId: 's1', revision: 4, visible: true })
  })
})
