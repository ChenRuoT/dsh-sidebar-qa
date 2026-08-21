/**
 * Test doubles for the DSH locale service. Not a `.spec.ts`, so vitest's
 * `tests/**\/*.spec.ts` include never collects it as a suite.
 *
 * `FakeLocale` mirrors the `SidebarqaLocaleService` face the plugin declares:
 * a live-switchable `active`, a real (counting) subscription so disposer
 * behavior is observable, and a `register` log so dictionary registration can
 * be asserted.
 */

/** One registered dictionary, as `register(ns, locale, dict)` received it. */
export interface RegisteredDict {
  ns: string
  locale: string
  dict: Record<string, string>
}

/** A controllable stand-in for `ctx.locale`. */
export class FakeLocale {
  active: string
  readonly registered: RegisteredDict[] = []
  private readonly listeners = new Set<() => void>()

  constructor(active = 'en') {
    this.active = active
  }

  /** How many subscribers are currently attached (disposer coverage). */
  get listenerCount(): number {
    return this.listeners.size
  }

  getSnapshot(): { active: string } {
    return { active: this.active }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  register(ns: string, locale: string, dict: Record<string, string>): () => void {
    const row: RegisteredDict = { ns, locale, dict }
    this.registered.push(row)
    return () => {
      const at = this.registered.indexOf(row)
      if (at >= 0) this.registered.splice(at, 1)
    }
  }

  /** Switch the active language and notify subscribers (as DSH does). */
  switchTo(active: string): void {
    this.active = active
    for (const listener of [...this.listeners]) listener()
  }
}

/** The `globalThis.navigator` descriptor as it was before any stubbing. */
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

/** Replace `navigator` with a stub reporting `language`. */
export function stubNavigatorLanguage(language: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language },
    configurable: true,
    writable: true,
  })
}

/** Remove `navigator` entirely (the "no browser at all" path). */
export function removeNavigator(): void {
  delete (globalThis as { navigator?: unknown }).navigator
}

/** Restore the real `navigator` (or its absence). */
export function restoreNavigator(): void {
  if (originalNavigator === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator
    return
  }
  Object.defineProperty(globalThis, 'navigator', originalNavigator)
}
