/**
 * The React adapter over the locale holder in `locales.ts`.
 *
 * Every panel root calls `useLocaleRevision()` once. The module-level `t()`
 * reads the active language at CALL time, so a single re-render of a root
 * re-localizes its whole subtree — which is why no component below a root may
 * be wrapped in `React.memo`, and why no `useMemo` may cache already-translated
 * text (cache the copy KEY instead; see `model-seat.ts`). The one exception is
 * `markdownLabels` in `AskPanel` — MarkdownText's `labels` prop, renamed from the
 * retired `codeLabels` before DSH 0.1.2-alpha.2 — which must be identity-stable
 * per locale because `MarkdownText` caches its streaming render on it.
 *
 * The hook deliberately takes no `ctx`: `ConfigPanel` (rendered by the DSH
 * settings shell) and `SelectionPopover` (its own body root) never receive one,
 * and reading the module holder is what lets one hook serve every root —
 * including the right column's title seat, which renders outside all of them.
 */
import { useSyncExternalStore } from 'react'
import { activeLocaleId, subscribeLocale } from './locales.ts'

/**
 * Re-render this component when the DSH locale switches.
 * @returns the active locale id — a stable primitive, as `useSyncExternalStore`
 *          requires (a fresh object per call would loop forever).
 */
export function useLocaleRevision(): string {
  // `subscribeLocale` / `activeLocaleId` are module-level function identities,
  // so they never need a useMemo/useCallback wrapper to stay stable.
  //
  // The third argument is the SERVER snapshot, and it is not optional in
  // practice: without it React throws on any server render of a subtree that
  // calls this hook ("Missing getServerSnapshot"), which would take out whole
  // panels rendered outside a browser — and it makes the title seat untestable in
  // the node environment. The active id is a stable primitive, so it is exactly
  // the value a server render may read.
  return useSyncExternalStore(subscribeLocale, activeLocaleId, activeLocaleId)
}
