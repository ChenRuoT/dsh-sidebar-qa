/**
 * Cross-plugin seam: a pending quote carried on a tab's open seed
 * (`openTab({ type: 'dsh-sidebar-qa:ask', meta: { quote } })`). External
 * plugins (e.g. dsh-sidebar-preview-select) open the ask tab with a quote
 * they captured themselves — a preview selection, a file excerpt — instead of
 * going through this plugin's own selection popover. The tab meta is the only
 * channel that reaches the panel component across plugin boundaries, because
 * the store instance (and its pendingBySession) is apply-private state.
 */
import type { PendingQuote } from './store.ts'

/**
 * Read a quote off a tab's `meta` slot, validating the wire shape.
 * `meta` is JSON-serializable unknown data set by any caller, so the shape is
 * checked field by field; anything unexpected yields null and the panel falls
 * back to the store's pending quote (or no quote).
 * @param meta - the tab's `meta` value (may be absent or anything).
 * @returns the quote, or null when absent or not a valid quote.
 */
export function resolveMetaQuote(meta: unknown): PendingQuote | null {
  if (meta === null || meta === undefined || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  const text = record.quote
  if (typeof text !== 'string' || text.trim() === '') return null
  const quote: PendingQuote = { text }
  if (typeof record.messageId === 'string') quote.messageId = record.messageId
  if (typeof record.role === 'string') quote.role = record.role
  return quote
}

/**
 * Strip a consumed quote off a tab's `meta` value, keeping any other keys.
 * The panel calls this after the quote was sent, so a later focus of the same
 * tab (or a page reload, where the meta persists) does not resurface the
 * stale quote.
 * @param meta - the tab's current `meta` value.
 * @returns a new meta object without `quote`, or undefined when meta was absent.
 */
export function consumeMetaQuote(meta: unknown): unknown {
  if (meta === null || meta === undefined || typeof meta !== 'object') return meta
  const record = meta as Record<string, unknown>
  if (!Object.hasOwn(record, 'quote')) return meta
  const { quote: _quote, ...rest } = record
  return rest
}

/**
 * The panel's view mode. A pending quote only owns the view while no
 * follow-up is selected: picking an existing child in the switcher returns to
 * that conversation (the quote stays parked for the 新追问 button), and
 * cancelling the quote without children falls back to the empty hint.
 * @param hasQuote - whether a pending quote (store or meta) is present.
 * @param activeChildId - the selected follow-up session, or null.
 * @returns the view mode.
 */
export function resolveAskMode(hasQuote: boolean, activeChildId: string | null): 'start' | 'conversation' | 'empty' {
  if (activeChildId !== null) return 'conversation'
  return hasQuote ? 'start' : 'empty'
}
