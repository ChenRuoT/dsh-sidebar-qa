/**
 * The floating action bar shown over a validated selection. Two buttons:
 * 「添加到对话」 appends the selection to the CURRENT session's main composer,
 * and 「提问」 parks the quote and opens the sidebar ask tab. Rendered into the
 * plugin's own body host root; `onMouseDown` is prevented so clicking a button
 * never collapses the selection before it is captured.
 */
import { useSyncExternalStore, type MouseEvent } from 'react'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import type { SelectionController } from './selection.ts'
import { roleOfKind } from './selection.ts'
import type { PendingQuote } from './store.ts'
import css from './selection-popover.module.css'

interface SelectionPopoverProps {
  controller: SelectionController
  /** Park the quote and open the sidebar ask tab. */
  onAsk: (quote: PendingQuote, sessionId: string) => void
  /**
   * Append the quote to the current session's main composer and focus it.
   * Returns FALSE when the composer is unreachable — the popover then keeps the
   * selection (and itself) alive so the user can fall back to 提问. This is the
   * only failure signal; the popover has no toast surface of its own.
   */
  onAddToConversation: (quote: PendingQuote, sessionId: string) => boolean
}

export function SelectionPopover({ controller, onAsk, onAddToConversation }: SelectionPopoverProps) {
  // Follow the DSH language (this root lives outside the sidebar tree).
  useLocaleRevision()
  const state = useSyncExternalStore(
    (cb: () => void) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  )
  const selection = state.selection
  if (selection === null) return null

  // NO HOOKS BELOW THIS POINT: the early return above would make any hook a
  // conditional call. Both handlers are plain closures on purpose — wrapping
  // them in useCallback would sit after the return and break the hook order.
  const { rect, text, kind, anchorKey, sessionId } = selection
  const left = rect.left + rect.width / 2
  const top = rect.top - 10

  const quoteOf = (): PendingQuote => ({
    text,
    role: roleOfKind(kind),
    ...(anchorKey !== undefined ? { messageId: anchorKey } : {}),
  })

  const ask = (): void => {
    const quote = quoteOf()
    controller.clear()
    onAsk(quote, sessionId)
  }

  // Clear only on success. On failure nothing took focus, so the DOM selection
  // survives: the popover stays put and 提问 is still one click away.
  const add = (): void => {
    if (onAddToConversation(quoteOf(), sessionId)) controller.clear()
  }

  // Both buttons must keep the DOM selection alive until the click lands.
  const keepSelection = (event: MouseEvent<HTMLButtonElement>): void => { event.preventDefault() }
  const fire = (run: () => void) => (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    run()
  }

  return (
    <div className={css.popover} style={{ left, top }}>
      <button
        type="button"
        className={`${css.action} ${css.secondary}`}
        onMouseDown={keepSelection}
        onMouseUp={keepSelection}
        onClick={fire(add)}
      >
        {t('askAddToConversation')}
      </button>
      <button
        type="button"
        className={`${css.action} ${css.primary}`}
        onMouseDown={keepSelection}
        onMouseUp={keepSelection}
        onClick={fire(ask)}
      >
        {t('askPopoverButton')}
      </button>
    </div>
  )
}
