import { describe, expect, it } from 'vitest'
import type { Context, SidebarqaSlotsService } from '../src/context-types.ts'
import {
  installSettingsSection,
  SETTINGS_SECTION_ID,
  SETTINGS_SECTION_ORDER,
} from '../src/client/settings-slot.ts'

/** A recording double for the slot registry. */
function fakeSlots() {
  const seats: Array<{ name: string; options: Record<string, unknown>; component: unknown }> = []
  const disposed: string[] = []
  const injected: string[] = []
  const slots = {
    inject(name: string, contribute: () => () => void): () => void {
      injected.push(name)
      return contribute()
    },
    register(options: { name: string } & Record<string, unknown>, component: unknown): () => void {
      seats.push({ name: options.name, options, component })
      return () => { disposed.push(options.name) }
    },
  } as unknown as SidebarqaSlotsService
  return { seats, disposed, injected, slots }
}

/** A cordis context double exposing exactly what the installer touches. */
function fakeCtx(services: Record<string, unknown> = {}) {
  const cleanups: Array<() => void> = []
  const serviceListeners: Array<() => void> = []
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
  } as unknown as Context
  return {
    ctx,
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

const label = (): string => 'NAV'
const component = (): unknown => null

describe('installSettingsSection', () => {
  it('contributes the page into the settings.section seat', () => {
    const native = fakeSlots()
    const h = fakeCtx({ slots: native.slots })
    installSettingsSection(h.ctx, { label, component })

    expect(native.injected).toEqual(['settings.section'])
    expect(native.seats).toHaveLength(1)
    const seat = native.seats[0]
    expect(seat?.name).toBe('settings.section')
    expect(seat?.options.id).toBe(SETTINGS_SECTION_ID)
    expect(seat?.options.order).toBe(SETTINGS_SECTION_ORDER)
    // The label stays a THUNK: DSH re-projects it on every locale change, so baking a
    // string here would freeze the nav entry in the language it was registered in.
    expect(seat?.options.label).toBe(label)
    expect(seat?.component).toBe(component)
  })

  it('waits for the renderer, then registers exactly once', () => {
    const native = fakeSlots()
    const h = fakeCtx({})
    installSettingsSection(h.ctx, { label, component })
    expect(native.seats).toHaveLength(0)

    h.provide({ slots: native.slots })
    h.serviceArrived()
    expect(native.seats).toHaveLength(1)

    // Every later publication re-runs the probe. A second registration under the same
    // id is a hard error in DSH's own registry, so this must stay at one.
    h.serviceArrived()
    h.serviceArrived()
    expect(native.seats).toHaveLength(1)
  })

  it('ignores a registry that is present but unusable', () => {
    const h = fakeCtx({ slots: {} })
    installSettingsSection(h.ctx, { label, component })
    expect(() => { h.serviceArrived() }).not.toThrow()
  })

  it('unregisters with the plugin', () => {
    const native = fakeSlots()
    const h = fakeCtx({ slots: native.slots })
    installSettingsSection(h.ctx, { label, component })

    h.dispose()

    expect(native.disposed).toEqual(['settings.section'])
    // The watch went with it, so a late publication cannot resurrect the section.
    h.serviceArrived()
    expect(native.seats).toHaveLength(1)
  })
})
