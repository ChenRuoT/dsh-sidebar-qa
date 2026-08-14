/**
 * Selection capture layer: listen for pointer/keyboard selections inside the
 * conversation, validate them (single message node, not streaming, bounded),
 * and expose the latest valid selection through a small external-store
 * controller the floating popover renders from. Pure DOM — no React here.
 */

/** Maximum selected-text length admitted (task-book bound). */
export const MAX_SELECTION_CHARS = 2000

/** One validated selection, ready for the popover. */
export interface SelectionSnapshot {
  text: string
  kind: string
  anchorKey: string | undefined
  rect: { left: number; top: number; width: number; bottom: number }
  sessionId: string
}

/** The popover-ready controller state. */
export interface SelectionState {
  selection: SelectionSnapshot | null
}

/** Resolve the chat-anchor element owning a DOM node (text nodes → parent). */
function chatAnchorOf(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  if (element === null || typeof element.closest !== 'function') return null
  return element.closest<HTMLElement>('[data-chat-anchor-key]')
}

/** Whether the owning message is still streaming (unfinished). */
function isStreaming(anchor: HTMLElement): boolean {
  return anchor.hasAttribute('data-streaming') || anchor.querySelector('[data-streaming]') !== null
}

/** Derive the quoted_context role from the chat-flow kind. */
export function roleOfKind(kind: string): 'user' | 'assistant' {
  return kind.toLowerCase().includes('user') ? 'user' : 'assistant'
}

/** Capture and validate the current window selection, or null when invalid. */
export function captureSelection(currentSessionId: string): SelectionSnapshot | null {
  const sel = window.getSelection()
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = sel.toString()
  if (text.trim() === '' || text.length > MAX_SELECTION_CHARS) return null
  const range = sel.getRangeAt(0)
  const startAnchor = chatAnchorOf(range.startContainer)
  const endAnchor = chatAnchorOf(range.endContainer)
  if (startAnchor === null || startAnchor !== endAnchor) return null
  if (isStreaming(startAnchor)) return null
  const kind = startAnchor.dataset.chatFlowKind ?? ''
  const anchorKey = startAnchor.dataset.chatAnchorKey
  const rect = range.getBoundingClientRect()
  return {
    text,
    kind,
    anchorKey,
    rect: { left: rect.left, top: rect.top, width: rect.width, bottom: rect.bottom },
    sessionId: currentSessionId,
  }
}

export interface SelectionController {
  getSnapshot(): SelectionState
  subscribe(fn: () => void): () => void
  clear(): void
  dispose(): void
}

/** Debounce for selectionchange (ms). */
const DEBOUNCE_MS = 200

/** Create one selection controller (call once per plugin activation). */
export function createSelectionController(getSessionId: () => string): SelectionController {
  let selection: SelectionSnapshot | null = null
  const listeners = new Set<() => void>()
  let debounceTimer: number | undefined

  // useSyncExternalStore requires a STABLE snapshot reference between
  // notifications — a fresh object each call would loop React (#185).
  let state: SelectionState = { selection: null }

  const notify = (): void => {
    state = { selection }
    for (const fn of [...listeners]) fn()
  }

  const recompute = (): void => {
    const next = captureSelection(getSessionId())
    const changed = (selection === null) !== (next === null)
      || (selection !== null && next !== null && (
        selection.text !== next.text
        || selection.anchorKey !== next.anchorKey
        || selection.sessionId !== next.sessionId
        || selection.kind !== next.kind
      ))
    if (!changed) return
    selection = next
    notify()
  }

  const onSelectionChange = (): void => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(recompute, DEBOUNCE_MS)
  }

  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('mouseup', recompute)
  document.addEventListener('keyup', onSelectionChange)

  return {
    getSnapshot: () => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    clear(): void {
      selection = null
      notify()
    },
    dispose(): void {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', recompute)
      document.removeEventListener('keyup', onSelectionChange)
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    },
  }
}
