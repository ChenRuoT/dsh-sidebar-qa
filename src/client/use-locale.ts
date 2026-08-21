/**
 * The React adapter over the locale holder in `locales.ts`.
 *
 * Every panel root calls `useLocaleRevision()` once. The module-level `t()`
 * reads the active language at CALL time, so a single re-render of a root
 * re-localizes its whole subtree — which is why no component below a root may
 * be wrapped in `React.memo`, and why no `useMemo` may cache already-translated
 * text (cache the copy KEY instead; see `model-seat.ts`). The one exception is
 * `codeLabels` in `AskPanel`, which must be identity-stable per locale because
 * `MarkdownText` caches its component table on it.
 *
 * The hook deliberately takes no `ctx`: `ConfigPanel` (rendered by the DSH
 * settings shell) and `SelectionPopover` (its own body root) never receive one,
 * and reading the module holder is what lets one hook serve all four roots.
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
  return useSyncExternalStore(subscribeLocale, activeLocaleId)
}
