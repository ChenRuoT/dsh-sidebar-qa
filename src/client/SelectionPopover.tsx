/**
 * The floating "提问" button shown over a validated selection. Rendered into
 * the plugin's own body host root; `onMouseDown` is prevented so clicking the
 * button never collapses the selection before it is captured.
 */
import { useSyncExternalStore } from 'react'
import { t } from './locales.ts'
import { useLocaleRevision } from './use-locale.ts'
import type { SelectionController } from './selection.ts'
import { roleOfKind } from './selection.ts'
import type { PendingQuote } from './store.ts'
import css from './selection-popover.module.css'

interface SelectionPopoverProps {
  controller: SelectionController
  onAsk: (quote: PendingQuote, sessionId: string) => void
}

export function SelectionPopover({ controller, onAsk }: SelectionPopoverProps) {
  // Follow the DSH language (this root lives outside the sidebar tree).
  useLocaleRevision()
  const state = useSyncExternalStore(
    (cb: () => void) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  )
  const selection = state.selection
  if (selection === null) return null

  const { rect, text, kind, anchorKey, sessionId } = selection
  const left = rect.left + rect.width / 2
  const top = rect.top - 10

  const ask = (): void => {
    const quote: PendingQuote = {
      text,
      role: roleOfKind(kind),
      ...(anchorKey !== undefined ? { messageId: anchorKey } : {}),
    }
    controller.clear()
    onAsk(quote, sessionId)
  }

  return (
    <div className={css.popover} style={{ left, top }}>
      <button
        type="button"
        className={css.ask}
        onMouseDown={(event) => { event.preventDefault() }}
        onMouseUp={(event) => { event.preventDefault() }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          ask()
        }}
      >
        {t('askPopoverButton')}
      </button>
    </div>
  )
}
