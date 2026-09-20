import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Context,
  SidebarqaSidebarRightService,
  SidebarqaSidebarRightTabDefinition,
  SidebarqaSidebarRightTabInfo,
  SidebarqaSidebarRightTabsService,
  SidebarqaSlotsService,
  SidebarqaTabComponentProps,
  SidebarqaTabOccurrence,
} from '../src/context-types.ts'
import {
  installSidebarTabs,
  nativeSidebarServicesOf,
  quoteOfNavParams,
  takeQuoteOnce,
  type SidebarTab,
} from '../src/client/sidebar-native.ts'

const BODY_SEAT = 'sidebar.right.pane.tab'
const TITLE_SEAT = 'sidebar.right.pane.tab.title'
const ASK_ID = 'dsh-sidebar-qa:ask'
const HISTORY_ID = 'dsh-sidebar-qa:history'

/**
 * A recording double for DSH's right column plus the slot registry.
 *
 * The installer's contract is: register the type in the registry, the body and
 * the live title in their two seats, all under the SAME implementation id — and
 * open by the kind the REGISTRY holds. Every membership change is recorded, so a
 * leak shows up as a failed assertion instead of being assumed away.
 */
function fakeNative(opts: { openTabThrows?: boolean } = {}) {
  const types: SidebarqaSidebarRightTabDefinition[] = []
  const seats: Array<{ name: string; key: string | undefined; component: unknown }> = []
  const opened: Array<{ kind: string; options: unknown }> = []
  /** Ids/kinds disposed, so a leaked registration is visible. */
  const disposedTypes: string[] = []
  const disposedSeats: string[] = []
  const slots = {
    inject(_name: string, contribute: () => () => void): () => void {
      return contribute()
    },
    register(options: { name: string; key?: string }, component: unknown): () => void {
      seats.push({ name: options.name, key: options.key, component })
      return () => { disposedSeats.push(options.key ?? options.name) }
    },
    has: () => true,
  }
  const tabs = {
    register(definition: SidebarqaSidebarRightTabDefinition): () => void {
      types.push(definition)
      return () => { disposedTypes.push(definition.id) }
    },
  }
  const sidebar = {
    openTab(kind: string, options?: unknown): void {
      if (opts.openTabThrows === true) throw new Error('sidebarRight: no session surface is mounted')
      opened.push({ kind, options })
    },
    focus: () => {},
    isExpanded: () => false,
  }
  return {
    types,
    seats,
    opened,
    disposedTypes,
    disposedSeats,
    slots: slots as unknown as SidebarqaSlotsService,
    tabs: tabs as unknown as SidebarqaSidebarRightTabsService,
    sidebar: sidebar as unknown as SidebarqaSidebarRightService,
  }
}

/** A cordis context double exposing exactly what the installer touches. */
function fakeCtx(
  services: Record<string, unknown> = {},
  list: unknown = { ids: [], byId: {} },
) {
  const cleanups: Array<() => void> = []
  const serviceListeners: Array<() => void> = []
  const open = vi.fn()
  const ctx = {
    get: (name: string) => services[name],
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    on: (name: string, listener: () => void) => {
      if (name === 'internal/service') serviceListeners.push(listener)
      return () => {
        const at = serviceListeners.indexOf(listener)
        if (at >= 0) serviceListeners.splice(at, 1)
      }
    },
    sessions: {
      list: { getSnapshot: () => list, subscribe: () => () => {} },
      open,
    },
  } as unknown as Context
  return {
    ctx,
    open,
    /** Make a service visible, as `provide` does before it notifies. */
    provide(provided: Record<string, unknown>): void {
      Object.assign(services, provided)
    },
    /** Simulate `ReflectService.notify`: some service was just provided. */
    serviceArrived(): void {
      for (const listener of [...serviceListeners]) listener()
    },
    /** Run every recorded effect cleanup, i.e. dispose the plugin. */
    dispose(): void {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup()
    },
  }
}

/**
 * A tab whose KIND differs from its ID, exactly like the real ones
 * (`dsh-sidebar-qa:ask` registered as kind `ask`). Keeping them different is the
 * point: an installer that re-derives one from the other registers a kind it
 * never opens, which DSH answers with `no tab type is registered as "<kind>"`.
 */
function tabOf(
  role: 'ask' | 'history' = 'ask',
  render: SidebarTab['component'] = () => null,
): SidebarTab {
  return {
    role,
    id: role === 'ask' ? ASK_ID : HISTORY_ID,
    kind: role,
    order: role === 'ask' ? 60 : 70,
    title: () => `${role.toUpperCase()}-TITLE`,
    description: () => `${role.toUpperCase()}-DESC`,
    component: render,
  }
}

/** The component registered in one seat, failing loudly when it is missing. */
function seatOf(native: ReturnType<typeof fakeNative>, name: string, id: string): (props: never) => unknown {
  const seat = native.seats.find(entry => entry.name === name && entry.key === id)
  if (seat === undefined) throw new Error(`nothing registered in ${name} under ${id}`)
  if (typeof seat.component !== 'function') throw new Error(`${name}/${id} is not a component`)
  return seat.component as (props: never) => unknown
}

/** A tab-information snapshot, the shape the seat's `useTabInfo` hook returns. */
function tabInfoOf(revision: number, params: unknown, visible = true): SidebarqaSidebarRightTabInfo {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: { id: 'tab-1', visible, navigation: { address: 'sidebar://ask', params, revision } },
  }
}

/** Every service a mounted right column provides. */
function mounted(native: ReturnType<typeof fakeNative>): Record<string, unknown> {
  return { sidebarRightTabs: native.tabs, sidebarRight: native.sidebar, slots: native.slots }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('nativeSidebarServicesOf', () => {
  it('finds the trio when the right column is composed', () => {
    const native = fakeNative()
    expect(nativeSidebarServicesOf(fakeCtx(mounted(native)).ctx))
      .toEqual({ tabs: native.tabs, sidebar: native.sidebar, slots: native.slots })
  })

  it('reports no sidebar when any of the three is absent', () => {
    const native = fakeNative()
    const full = mounted(native)
    for (const missing of ['sidebarRightTabs', 'sidebarRight', 'slots']) {
      const { [missing]: _dropped, ...rest } = full
      expect(nativeSidebarServicesOf(fakeCtx(rest).ctx)).toBeUndefined()
    }
    expect(nativeSidebarServicesOf(fakeCtx({}).ctx)).toBeUndefined()
  })

  it('treats a service that lacks the verb it must expose as absent', () => {
    const native = fakeNative()
    // Present but malformed: this is what a half-composed deployment looks like,
    // and degrading to "no sidebar" beats throwing at activation.
    expect(nativeSidebarServicesOf(fakeCtx({ ...mounted(native), sidebarRightTabs: {} }).ctx))
      .toBeUndefined()
    expect(nativeSidebarServicesOf(fakeCtx({ ...mounted(native), sidebarRight: { openTab: 1 } }).ctx))
      .toBeUndefined()
  })
})

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

describe('takeQuoteOnce', () => {
  it('hands the quote over exactly once', () => {
    const take = takeQuoteOnce(() => ({ quote: 'q' }))
    expect(take()).toEqual({ text: 'q' })
    expect(take()).toBeNull()
  })

  it('stays armed while the payload carries no quote', () => {
    let params: unknown = { other: true }
    const take = takeQuoteOnce(() => params)
    expect(take()).toBeNull()
    params = { quote: 'later' }
    expect(take()).toEqual({ text: 'later' })
  })
})

describe('installSidebarTabs', () => {
  it('registers the type, the body and the live title under ONE implementation id', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })

    expect(native.types).toHaveLength(1)
    expect(native.types[0]?.id).toBe(ASK_ID)
    expect(typeof seatOf(native, BODY_SEAT, ASK_ID)).toBe('function')
    // A component, not a string: only a component can re-read the language, which
    // is what keeps an OPEN tab's chip from freezing in the language it opened in.
    expect(typeof seatOf(native, TITLE_SEAT, ASK_ID)).toBe('function')
  })

  it('opens the kind that was REGISTERED, never one re-derived from the id', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask'), tabOf('history')] })

    opener.openAsk({ sessionId: 's1' })
    opener.openHistory({ sessionId: 's1' })

    const ask = native.types.find(type => type.id === ASK_ID)
    const history = native.types.find(type => type.id === HISTORY_ID)
    expect(native.opened[0]?.kind).toBe(ask?.kind)
    expect(native.opened[1]?.kind).toBe(history?.kind)
    // The regression that produced `no tab type is registered as
    // "dsh-sidebar-qa:ask"`: an open naming the id while the type registered a
    // kind. Asserting the two names are NOT interchangeable is the point.
    expect(native.opened[0]?.kind).not.toBe(ask?.id)
    expect(native.opened[1]?.kind).not.toBe(history?.id)
  })

  it('carries the cross-plugin quote as navigation params', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })

    opener.openAsk({ sessionId: 's1' }, { quote: 'q', messageId: 'm1', role: 'user' })
    expect(native.opened[0]?.options).toEqual({ params: { quote: 'q', messageId: 'm1', role: 'user' } })
  })

  it('opens with no params at all when there is no quote', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] }).openAsk({ sessionId: 's1' })
    expect(native.opened[0]?.options).toBeUndefined()
  })

  it('puts the target session on screen before opening', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] }).openAsk({ sessionId: 's-target' })

    // `openTab` acts on the MOUNTED session surface and throws without one, so a
    // quote captured against a session the user has since left needs this first.
    expect(h.open).toHaveBeenCalledWith('s-target')
    expect(native.opened).toHaveLength(1)
  })

  it('does not switch when the target is already the session on screen', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native), {
      ids: ['s1'],
      byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } },
    })
    installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] }).openAsk({ sessionId: 's1' })

    expect(h.open).not.toHaveBeenCalled()
    expect(native.opened).toHaveLength(1)
  })

  it('survives an openTab that throws, because a UI gesture must not vanish', () => {
    const native = fakeNative({ openTabThrows: true })
    const h = fakeCtx(mounted(native))
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })

    expect(() => { opener.openAsk({ sessionId: 's1' }) }).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('opening the sidebar tab failed'),
      expect.anything(),
    )
  })

  it('warns instead of opening when the sidebar never appeared', () => {
    const h = fakeCtx({})
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })

    expect(opener.installed()).toBe(false)
    expect(() => { opener.openAsk({ sessionId: 's1' }) }).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not registered'))
  })

  it('contributes the guide entry that is the only way a hand can reach the tab', () => {
    const native = fakeNative()
    installSidebarTabs(fakeCtx(mounted(native)).ctx, { tabs: [tabOf('ask')] })

    const entry = native.types[0]?.guide?.[0]
    expect(native.types[0]?.guide).toHaveLength(1)
    expect(entry?.id).toBe('ask')
    expect(entry?.order).toBe(60)
    expect(entry?.title()).toBe('ASK-TITLE')
    expect(entry?.description?.()).toBe('ASK-DESC')
    // The host defaults a type with no explicit band to `extension`, but stating it
    // is what lets this plugin outrank a builtin viewer that claims the same kind.
    expect(native.types[0]?.priority).toBe('extension')
  })

  it('waits for a sidebar that arrives after apply, then registers exactly once', () => {
    const native = fakeNative()
    const h = fakeCtx({})
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })

    expect(native.types).toHaveLength(0)
    expect(opener.installed()).toBe(false)

    h.provide(mounted(native))
    h.serviceArrived()
    expect(native.types).toHaveLength(1)
    expect(opener.installed()).toBe(true)

    // Every later publication re-runs the probe; it must not double-register.
    h.serviceArrived()
    h.serviceArrived()
    expect(native.types).toHaveLength(1)
    expect(native.seats).toHaveLength(2)
  })

  it('says why the tabs are missing on a host with no right sidebar', async () => {
    installSidebarTabs(fakeCtx({}).ctx, { tabs: [tabOf('ask')] })
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no right sidebar'))
  })

  it('unregisters the type and both seats on disposal', () => {
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    const opener = installSidebarTabs(h.ctx, { tabs: [tabOf('ask')] })
    expect(opener.installed()).toBe(true)

    h.dispose()

    expect(native.disposedTypes).toEqual([ASK_ID])
    expect(native.disposedSeats).toEqual([ASK_ID, ASK_ID])
    expect(opener.installed()).toBe(false)
    // The watch went with it, so a late publication cannot resurrect the tabs.
    h.serviceArrived()
    expect(native.types).toHaveLength(1)
  })
})

describe('the body the seat renders', () => {
  /** Install one tab and return an accessor for the occurrence it hands the panel. */
  function harness(role: 'ask' | 'history' = 'ask') {
    const captured: SidebarqaTabComponentProps[] = []
    const native = fakeNative()
    const h = fakeCtx(mounted(native))
    installSidebarTabs(h.ctx, {
      tabs: [tabOf(role, (props) => { captured.push(props); return null })],
    })
    const Body = seatOf(native, BODY_SEAT, role === 'ask' ? ASK_ID : HISTORY_ID)
    return {
      native,
      h,
      ctx: h.ctx,
      /** Render once and hand back the occurrence the panel just received. */
      occurrenceOf(params: unknown, revision: number, visible = true): SidebarqaTabOccurrence {
        captured.length = 0
        renderToStaticMarkup(createElement(
          Body as never,
          { sessionId: 's1', useTabInfo: () => tabInfoOf(revision, params, visible) } as never,
        ))
        const occurrence = captured[0]?.sidebar
        if (occurrence === undefined) throw new Error('the panel received no occurrence')
        return occurrence
      },
      last(): SidebarqaTabComponentProps {
        const props = captured[0]
        if (props === undefined) throw new Error('the panel was never rendered')
        return props
      },
    }
  }

  it('renders the panel with its ctx, scope, tab and visibility', () => {
    const panel = harness()
    const occurrence = panel.occurrenceOf(undefined, 1, false)
    const props = panel.last()

    expect(props.ctx).toBe(panel.ctx)
    expect(props.scope).toEqual({ sessionId: 's1' })
    expect(props.tab).toEqual({ id: 'tab-1' })
    expect(props.visible).toBe(false)
    expect(occurrence.tabId).toBe('tab-1')
    expect(occurrence.revision).toBe(1)
  })

  it('hands the quote over once per navigation, and re-arms on the next one', () => {
    const panel = harness()
    const first = panel.occurrenceOf({ quote: 'first' }, 1)
    expect(first.takeQuote()).toEqual({ text: 'first' })
    expect(first.takeQuote()).toBeNull()

    // A second external open into the SAME tab: the payload rides
    // `navigation.params`, which the layout record cannot clear, so a fresh
    // occurrence is the only thing that can deliver the new quote.
    const second = panel.occurrenceOf({ quote: 'second' }, 2)
    expect(second.takeQuote()).toEqual({ text: 'second' })
  })

  it('lets the tree jump to another session without leaving the tab behind', () => {
    const panel = harness('history')
    panel.occurrenceOf(undefined, 1).openHistory({ sessionId: 's2' })

    expect(panel.h.open).toHaveBeenCalledWith('s2')
    const history = panel.native.types.find(type => type.id === HISTORY_ID)
    expect(panel.native.opened[0]?.kind).toBe(history?.kind)
  })
})
