/**
 * Acceptance test for the sidebar seam: drive the REAL installation path
 * (`installSidebarTabs`, the function `apply` calls) against fake cordis
 * contexts, and assert what actually reaches each backend.
 *
 * This is the layer a unit test cannot cover: a tab body registered under the
 * wrong key, a backend picked when the other should have won, a missing settings
 * popup, an activation signal nobody forwards, or registrations that never get
 * released.
 *
 * `sidebar-install.ts` is imported for the functions under test; it deliberately
 * holds no React, JSX, or panel imports, so this suite stays in the project's
 * plain `node` environment. The panels themselves are rendered by the two
 * adapter suites.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  Context,
  SidebarqaSidebarRightTabDefinition,
  SidebarqaSlotsService,
} from '../src/context-types.ts'
import { installSidebarTabs } from '../src/client/sidebar-install.ts'
import { ASK_TAB, HISTORY_TAB, type SidebarPortTabSpec } from '../src/client/sidebar-port.ts'

/**
 * The tab specs the plugin contributes. The real ones render panels, which this
 * suite does not care about: the seam's contract is about WHICH specs reach
 * WHICH backend, and what happens on activation.
 * @param withGuide - whether to declare guide entries (the real specs do; a
 *   test that asserts their absence passes false).
 */
function fakeSpecs(withGuide = true): readonly SidebarPortTabSpec[] {
  return [ASK_TAB, HISTORY_TAB].map((tab, index) => {
    const kind = (index === 0 ? 'ask' : 'history') as 'ask' | 'history'
    return {
      key: tab.key,
      kind,
      title: () => 'T',
      order: tab.order,
      icon: () => null,
      ...withGuide
        ? { guide: [{ id: kind, order: tab.order, title: () => `${kind} title`, description: () => `${kind} desc` }] }
        : {},
      component: () => () => null,
    }
  })
}

/**
 * A context double with just enough behaviour for the installation path.
 *
 * Two things here are load-bearing, because getting either wrong is how three
 * earlier revisions passed this suite and failed in a real browser:
 *
 * 1. **`inject` keys are REQUIREMENTS.** Cordis's `Fiber._refresh` walks
 *    `Object.keys(this.inject)` and drops the fiber to INACTIVE if any one of
 *    them has no implementation, so the callback runs only when ALL of them
 *    exist. There is no optional form, and this double must not invent one.
 * 2. **Services arrive through `internal/service`.** The plugin reads backends
 *    with `ctx.get()` and re-checks on that event, so a double that provides the
 *    service silently would leave the plugin waiting forever — exactly the
 *    silent-inactivity failure mode being defended against.
 * @param services - the service table, keyed exactly as the plugin reads it
 *   (`sessions`, `sidebarRightTabs`, ...).
 */
function harnessOf(services: Record<string, unknown>): {
  ctx: Context
  runEffects: () => void
  /** Publish a service the way cordis's `reflect.provide` does. */
  provide: (name: string, value: unknown) => void
} {
  const effects: Array<() => void> = []
  /** `internal/service` listeners, as registered by the plugin's effect. */
  const serviceListeners = new Set<() => void>()
  const ctx = {
    get: (name: string) => services[name],
    on: (event: string, listener: () => void) => {
      if (event !== 'internal/service') return () => {}
      serviceListeners.add(listener)
      return () => { serviceListeners.delete(listener) }
    },
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    sessions: services.sessions,
  } as unknown as Context
  return {
    ctx,
    runEffects: () => { for (const cleanup of effects.reverse()) cleanup() },
    provide: (name, value) => {
      services[name] = value
      for (const listener of [...serviceListeners]) listener()
    },
  }
}

/**
 * The `sessions` service slice a wiring test needs: a client list feed plus the
 * `list.getSnapshot().current` read `apply`'s activation callback performs.
 */
function sessionsService(current: string | undefined): {
  sessions: Record<string, unknown>
  current: () => string | undefined
} {
  const list = { getSnapshot: () => ({ current, byId: {}, items: [] }) }
  return { sessions: { list }, current: () => list.getSnapshot().current }
}

/** A native sidebar composition that records what it was handed. */
function nativeServices(): {
  services: Record<string, unknown>
  types: SidebarqaSidebarRightTabDefinition[]
  bodies: Map<string, unknown>
  opened: Array<{ kind: string; options: unknown }>
  disposals: string[]
} {
  const types: SidebarqaSidebarRightTabDefinition[] = []
  const bodies = new Map<string, unknown>()
  const opened: Array<{ kind: string; options: unknown }> = []
  const disposals: string[] = []
  return {
    types,
    bodies,
    opened,
    disposals,
    services: {
      sidebarRightTabs: {
        register(definition: SidebarqaSidebarRightTabDefinition) {
          types.push(definition)
          return () => { disposals.push(`type:${definition.id}`) }
        },
      },
      sidebarRight: {
        openTab(kind: string, options?: unknown) { opened.push({ kind, options }) },
        focus: () => {},
        isExpanded: () => false,
      },
      slots: {
        inject: (_name: string, contribute: () => () => void) => contribute(),
        register: (options: { name: string; key?: string }, component: unknown) => {
          if (options.key === undefined) return () => {}
          bodies.set(options.key, component)
          return () => { disposals.push(`body:${options.key}`) }
        },
        has: () => true,
      } as unknown as SidebarqaSlotsService,
    },
  }
}

/** A better-sidebar composition that records what it was handed. */
function betterServices(): {
  services: Record<string, unknown>
  descriptors: Array<Record<string, unknown>>
  opened: Array<{ seed: Record<string, unknown>; scope: unknown }>
} {
  const descriptors: Array<Record<string, unknown>> = []
  const opened: Array<{ seed: Record<string, unknown>; scope: unknown }> = []
  return {
    descriptors,
    opened,
    services: {
      betterSidebar: {
        registerTab: (descriptor: Record<string, unknown>) => {
          descriptors.push(descriptor)
          return () => {}
        },
        openTab: (seed: Record<string, unknown>, scope?: unknown) => { opened.push({ seed, scope }) },
        updateTab: () => {},
      },
    },
  }
}

describe('installSidebarTabs — native backend', () => {
  it('registers both types as page types and both bodies under the same ids', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    const port = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })


    expect(port.backend()).toBe('native')
    expect(native.types.map(type => type.id)).toEqual([ASK_TAB.key, HISTORY_TAB.key])
    expect(native.types.map(type => type.kind)).toEqual(['ask', 'history'])
    // `extension` is the band for a type shipped from outside the product.
    expect(native.types.every(type => type.priority === 'extension')).toBe(true)
    // No `patterns`: these are page types opened by kind, not resource viewers.
    expect(native.types.every(type => type.patterns === undefined)).toBe(true)
    // The body seat is keyed by the implementation id, not by the kind.
    expect([...native.bodies.keys()]).toEqual([ASK_TAB.key, HISTORY_TAB.key])
  })

  it('opens the kind that was REGISTERED (the bug: opening the tab key instead)', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    opener.openAsk({ sessionId: 'main' }, { quote: 'Q', messageId: 'm1', role: 'user' })
    opener.openHistory({ sessionId: 'main' })

    // DSH resolves an open BY KIND (`placeTab` → `tabs.get(kind)`), so a kind the
    // registry does not hold throws `no tab type is registered as "<kind>"` from
    // inside a click handler. Both asserted values come from the registration
    // itself, so registering one name and opening another cannot pass.
    const registered = native.types.map(type => type.kind)
    expect(native.opened.map(entry => entry.kind)).toEqual(registered)
    expect(native.opened[0]?.options).toEqual({
      params: { quote: 'Q', messageId: 'm1', role: 'user' },
    })
    expect(native.opened[1]?.options).toBeUndefined()
  })

  it('drops a settings-popup request instead of faking one', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    const render = vi.fn(() => null)
    installSidebarTabs(harness.ctx, {
      specs: () => fakeSpecs(),
      settingsFor: { kind: 'ask', render },
    })

    // Exactly the two type registrations; nothing re-registered for settings.
    expect(native.types).toHaveLength(2)
    expect(render).not.toHaveBeenCalled()
  })

  it('releases every registration on disposal', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    harness.runEffects()
    // Both tabs are gone — bodies and types. The interleaving is the adapter's
    // business; what the seam promises is that nothing survives disposal.
    expect(native.disposals).toHaveLength(4)
    expect(new Set(native.disposals)).toEqual(new Set([
      `body:${ASK_TAB.key}`, `body:${HISTORY_TAB.key}`,
      `type:${ASK_TAB.key}`, `type:${HISTORY_TAB.key}`,
    ]))
  })
})

describe('installSidebarTabs — better-sidebar backend', () => {
  it('registers both tabs and re-registers the ask tab with its settings popup', () => {
    const better = betterServices()
    const harness = harnessOf({ ...better.services, ...sessionsService('main').sessions })
    const port = installSidebarTabs(harness.ctx, {
      specs: () => fakeSpecs(),
      settingsFor: { kind: 'ask', render: () => 'PANEL' },
    })

    expect(port.backend()).toBe('betterSidebar')
    expect(better.descriptors.map(descriptor => descriptor.id)).toEqual([
      ASK_TAB.key, HISTORY_TAB.key, ASK_TAB.key,
    ])
    const withSettings = better.descriptors[2] as { settings?: { render: (props: unknown) => unknown } }
    expect(withSettings.settings?.render?.({ close: () => {} })).toBe('PANEL')
  })

  it('registers no settings popup when none was requested', () => {
    const better = betterServices()
    const harness = harnessOf({ ...better.services, ...sessionsService('main').sessions })
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    expect(better.descriptors.map(descriptor => descriptor.id)).toEqual([ASK_TAB.key, HISTORY_TAB.key])
  })

  it('opens with the quote on the tab meta, scoped to the named session', () => {
    const better = betterServices()
    const harness = harnessOf({ ...better.services, ...sessionsService('main').sessions })
    const port = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })


    port?.openAsk({ sessionId: 's1' }, { quote: 'Q' })
    expect(better.opened).toEqual([
      { seed: { type: ASK_TAB.key, meta: { quote: { quote: 'Q' } } }, scope: { sessionId: 's1' } },
    ])
  })
})

describe('installSidebarTabs — backend selection and activation', () => {
  it('prefers the native backend when both are installed', () => {
    const native = nativeServices()
    const better = betterServices()
    const harness = harnessOf({
      ...native.services, ...better.services, ...sessionsService('main').sessions,
    })
    const port = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })


    expect(port.backend()).toBe('native')
    // The better-sidebar column is left alone: no double registration.
    expect(better.descriptors).toEqual([])
    expect(native.types).toHaveLength(2)
  })

  it('reports the absence and registers nothing when neither backend exists', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const harness = harnessOf({ ...sessionsService('main').sessions })
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    // The OPENER is always returned (it must be safe to call), but no backend
    // was installed and the absence is reported.
    expect(opener.backend()).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no sidebar backend'))
    warn.mockRestore()
  })

  it('forwards every backend activation to the plugin callback', () => {
    const better = betterServices()
    const onActivate = vi.fn()
    const harness = harnessOf({ ...better.services, ...sessionsService('main').sessions })
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs(), onActivate })


    const descriptor = better.descriptors[0] as { onActivate?: () => void }
    descriptor.onActivate?.()
    descriptor.onActivate?.()
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('lets the activation callback clear the current session\'s store quote (apply\'s contract)', () => {
    const better = betterServices()
    const cleared: string[] = []
    const sessions = sessionsService('s7')
    const harness = harnessOf({ ...better.services, ...sessions.sessions })
    installSidebarTabs(harness.ctx, {
      specs: () => fakeSpecs(),
      onActivate: () => {
        // The same read `apply` performs: the client session list is a service
        // the panels reach through `ctx`, not through the occurrence.
        const current = sessions.current()
        if (current !== undefined) cleared.push(current)
      },
    })

    ;(better.descriptors[0] as { onActivate?: () => void }).onActivate?.()
    expect(cleared).toEqual(['s7'])
  })

  it('hands the guide entries to the native registry (the only way a native tab is discoverable)', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })


    // The native strip's `+` control only re-opens the guide page, so a type
    // without an entry box is reachable by code alone.
    expect(native.types[0]?.guide?.map(entry => entry.id)).toEqual(['ask'])
    expect(native.types[1]?.guide?.map(entry => entry.id)).toEqual(['history'])
    expect(native.types[0]?.guide?.[0]?.title()).toBe('ask title')
    expect(native.types[0]?.guide?.[0]?.description?.()).toBe('ask desc')
  })

  it('registers no guide entries when the specs declare none', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs(false) })

    expect(native.types[0]?.guide).toBeUndefined()
  })

  it('installs once the backend ARRIVES, not only when it is already there', () => {
    // The bug this covers: `ctx.get()` probed exactly once at apply time, so a
    // deployment where this plugin's fiber activated before ui-sidebar-right
    // got no tabs at all, silently.
    const services = { ...sessionsService('main').sessions } as Record<string, unknown>
    const harness = harnessOf(services)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })
    expect(opener.backend()).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no sidebar backend'))
    warn.mockRestore()

    // Now the native sidebar mounts and publishes its services, which cordis
    // reports as `internal/service` — the plugin's whole reason for watching it.
    const native = nativeServices()
    harness.provide('sidebarRightTabs', native.services.sidebarRightTabs)
    harness.provide('sidebarRight', native.services.sidebarRight)
    harness.provide('slots', native.services.slots)

    expect(opener.backend()).toBe('native')
    expect(native.types.map(type => type.id)).toEqual([ASK_TAB.key, HISTORY_TAB.key])
    expect([...native.bodies.keys()]).toEqual([ASK_TAB.key, HISTORY_TAB.key])
  })

  it('waits for the LAST needed service, not the first', () => {
    // `sidebarRightTabs` alone cannot host a body (the seat lives on the slot
    // registry), so a partial backend must not settle the watch.
    const native = nativeServices()
    // The navigation face is already there; the registry and the seat are not.
    const services = {
      ...sessionsService('main').sessions,
      sidebarRight: native.services.sidebarRight,
    } as Record<string, unknown>
    const harness = harnessOf(services)
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    harness.provide('sidebarRightTabs', native.services.sidebarRightTabs)
    expect(opener.backend()).toBeUndefined()
    expect(native.types).toEqual([])

    harness.provide('slots', native.services.slots)
    expect(opener.backend()).toBe('native')
    expect(native.types).toHaveLength(2)
  })

  it('does not require a current session to install', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService(undefined).sessions })
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })
    expect(opener.backend()).toBe('native')
    expect(native.types).toHaveLength(2)
  })

  it('installs synchronously when a backend is already composed, and the opener forwards', () => {
    const native = nativeServices()
    const harness = harnessOf({ ...native.services, ...sessionsService('main').sessions })
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    // The backend is already there, so registration happened inside the call.
    expect(native.types).toHaveLength(2)
    expect(opener.backend()).toBe('native')
    opener.openAsk({ sessionId: 'main' }, { quote: 'q' })
    expect(native.opened).toHaveLength(1)
  })

  it('keeps the opener safe before any backend exists', () => {
    // A backend-less deployment still renders the popover, so a click can reach
    // an opener with nothing behind it; it must be a silent no-op, not a throw.
    const harness = harnessOf({ ...sessionsService('main').sessions })
    const opener = installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })

    expect(opener.backend()).toBeUndefined()
    expect(() => {
      opener.openAsk({ sessionId: 'main' }, { quote: 'q' })
      opener.openHistory({ sessionId: 'main' })
    }).not.toThrow()
  })

  it('releases the watch on disposal so a late service cannot re-register', () => {
    const native = nativeServices()
    const services = { ...sessionsService('main').sessions } as Record<string, unknown>
    const harness = harnessOf(services)
    installSidebarTabs(harness.ctx, { specs: () => fakeSpecs() })
    harness.runEffects()

    harness.provide('sidebarRightTabs', native.services.sidebarRightTabs)
    harness.provide('sidebarRight', native.services.sidebarRight)
    harness.provide('slots', native.services.slots)
    expect(native.types).toEqual([])
  })
})
