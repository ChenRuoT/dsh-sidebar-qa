import { describe, expect, it } from 'vitest'
import type { Context } from '../src/context-types.ts'
import {
  ASK_TAB,
  HISTORY_TAB,
  betterSidebarServiceOf,
  detectSidebarBackend,
  nativeSidebarServicesOf,
  slotsServiceOf,
} from '../src/client/sidebar-port.ts'

/**
 * A context double exposing only `get`, which is the entire surface
 * `detectSidebarBackend` and the service probes touch. The real cordis
 * `Context` carries dozens of members this plugin never reads, so the double is
 * cast rather than spelled out.
 */
function ctxOf(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

/** A service shape that satisfies the native/slots structural `register` probe. */
const withRegister = (extra: Record<string, unknown> = {}) => ({ register: () => () => {}, ...extra })

/** A better-sidebar shape, whose registration verb is `registerTab`, not `register`. */
const withRegisterTab = (extra: Record<string, unknown> = {}) => ({ registerTab: () => () => {}, ...extra })

describe('detectSidebarBackend', () => {
  it('prefers the native DSH sidebar when both backends are installed', () => {
    const ctx = ctxOf({
      sidebarRightTabs: withRegister(),
      sidebarRight: { openTab: () => {} },
      betterSidebar: withRegisterTab({ openTab: () => {} }),
    })
    expect(detectSidebarBackend(ctx)).toBe('native')
  })

  it('detects the native backend without better-sidebar present', () => {
    const ctx = ctxOf({ sidebarRightTabs: withRegister() })
    expect(detectSidebarBackend(ctx)).toBe('native')
  })

  it('falls back to better-sidebar when the native sidebar is absent (DSH < 0.1.5-alpha.1)', () => {
    const ctx = ctxOf({ betterSidebar: withRegisterTab({ openTab: () => {} }) })
    expect(detectSidebarBackend(ctx)).toBe('betterSidebar')
  })

  it('reports none when neither sidebar is installed', () => {
    expect(detectSidebarBackend(ctxOf({}))).toBe('none')
  })

  it('treats a service present without a callable register as absent', () => {
    expect(detectSidebarBackend(ctxOf({ sidebarRightTabs: { register: 'nope' } }))).toBe('none')
    expect(detectSidebarBackend(ctxOf({ sidebarRightTabs: undefined }))).toBe('none')
    expect(detectSidebarBackend(ctxOf({ sidebarRightTabs: null, betterSidebar: null }))).toBe('none')
  })

  it('does not mistake a native-shaped registry for better-sidebar', () => {
    // `register` without `registerTab` is the NATIVE verb: a bare `register`
    // probe used to classify this as better-sidebar.
    expect(detectSidebarBackend(ctxOf({ betterSidebar: { register: () => () => {}, openTab: () => {} } })))
      .toBe('none')
  })

  it('degrades to the other backend when the native registry is malformed', () => {
    const ctx = ctxOf({
      sidebarRightTabs: {},
      betterSidebar: withRegisterTab({ openTab: () => {} }),
    })
    expect(detectSidebarBackend(ctx)).toBe('betterSidebar')
  })
})

describe('slotsServiceOf', () => {
  it('returns the registry when it exposes register', () => {
    const slots = withRegister({ inject: () => () => {}, has: () => true })
    expect(slotsServiceOf(ctxOf({ slots }))).toBe(slots)
  })

  it('returns undefined when the slots service is absent or malformed', () => {
    expect(slotsServiceOf(ctxOf({}))).toBeUndefined()
    expect(slotsServiceOf(ctxOf({ slots: {} }))).toBeUndefined()
  })
})

describe('nativeSidebarServicesOf', () => {
  it('returns both faces when the native sidebar is fully composed', () => {
    const tabs = withRegister()
    const sidebar = { openTab: () => {}, focus: () => {}, isExpanded: () => false }
    expect(nativeSidebarServicesOf(ctxOf({ sidebarRightTabs: tabs, sidebarRight: sidebar })))
      .toEqual({ tabs, sidebar })
  })

  it('returns undefined when either half is missing or malformed', () => {
    expect(nativeSidebarServicesOf(ctxOf({ sidebarRightTabs: withRegister() }))).toBeUndefined()
    expect(nativeSidebarServicesOf(ctxOf({ sidebarRight: { openTab: () => {} } }))).toBeUndefined()
    expect(nativeSidebarServicesOf(ctxOf({ sidebarRightTabs: withRegister(), sidebarRight: {} }))).toBeUndefined()
    expect(nativeSidebarServicesOf(ctxOf({}))).toBeUndefined()
  })
})

describe('betterSidebarServiceOf', () => {
  it('returns the service when it exposes both registerTab and openTab', () => {
    const service = withRegisterTab({ openTab: () => {}, updateTab: () => {} })
    expect(betterSidebarServiceOf(ctxOf({ betterSidebar: service }))).toBe(service)
  })

  it('returns undefined for a bare register (the native verb) and for an absent service', () => {
    expect(betterSidebarServiceOf(ctxOf({ betterSidebar: withRegister({ openTab: () => {} }) }))).toBeUndefined()
    expect(betterSidebarServiceOf(ctxOf({ betterSidebar: withRegisterTab() }))).toBeUndefined()
    expect(betterSidebarServiceOf(ctxOf({}))).toBeUndefined()
  })
})

describe('tab identities', () => {
  it('keeps the shipped better-sidebar ids stable (they are persisted layout keys)', () => {
    expect(ASK_TAB.key).toBe('dsh-sidebar-qa:ask')
    expect(HISTORY_TAB.key).toBe('dsh-sidebar-qa:history')
  })

  it('orders the ask tab before the history tab', () => {
    expect(ASK_TAB.order).toBeLessThan(HISTORY_TAB.order)
  })
})
