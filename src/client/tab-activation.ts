/**
 * A tiny module-level bridge between better-sidebar's `TabDescriptor.onActivate`
 * and this plugin's mounted tab components.
 *
 * Why it exists (dsh-sidebar-qa issue #6): better-sidebar only auto-expands a
 * collapsed panel for CONTENT opens, and its service exposes no panel-expansion
 * method — so a type-only `openTab` (the 提问 flow) lands the tab invisible.
 * The component-side heal (mount + on-activation) needs the store, which only
 * exists inside tab components (`TabComponentProps.store`); the `onActivate`
 * descriptor callback (the authoritative "this tab was just focused" signal,
 * fired even when openTab merely re-focuses an already-active tab) gets no
 * store. This bridge forwards that signal to whichever tab components are
 * currently mounted; they heal the panel through their store.
 *
 * The client bundle is a single instance per profile, and every registrant
 * unregisters on unmount (HMR-safe via effect cleanup), so the module-level
 * Set is safe. Notifying a healed panel is a no-op, so multiple registrants
 * (both tabs) are fine.
 */

type ActivationListener = () => void

const listeners = new Set<ActivationListener>()

/** Subscribe to a "a tab of this plugin was just activated" event. Returns the disposer. */
export function onTabActivated(listener: ActivationListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Fire every registered listener (called from the tab descriptor's onActivate). */
export function notifyTabActivated(): void {
  for (const fn of [...listeners]) fn()
}

/** The number of registered listeners (tests). */
export function listenerCount(): number {
  return listeners.size
}
