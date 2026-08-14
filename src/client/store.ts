/**
 * Client store for dsh-sidebar-qa: the parent→children mapping between
 * follow-up (side) sessions and the session they were asked from (localStorage
 * persisted) plus the transient per-session pending quote. One instance per
 * plugin activation (created in apply(), never a module-level singleton).
 *
 * The mapping is the plugin's self-maintained lineage, generalized to support
 * NESTED follow-ups: a side session can itself be the parent of another side
 * session (select text inside a 追问 and ask again). A session is a "side
 * session" when it appears as a child; its root (main) session is reached by
 * walking the parent chain to the top.
 */
const STORAGE_KEY = 'dsh-sidebar-qa:map'

/** A captured selection awaiting a question. */
export interface PendingQuote {
  text: string
  messageId?: string
  role?: string
  turn?: string
  selectionStart?: number
  selectionEnd?: number
}

/** The immutable store snapshot consumed through useSyncExternalStore. */
export interface SidebarqaStoreSnapshot {
  /** parent session id → child (follow-up) session ids (creation order). */
  parentToChildren: Record<string, string[]>
  /** child session id → parent session id (reverse index). */
  childToParent: Record<string, string>
  /** per-session transient pending quote. */
  pendingBySession: Record<string, PendingQuote>
}

export interface SidebarqaStore {
  getSnapshot(): SidebarqaStoreSnapshot
  subscribe(fn: () => void): () => void
  setPendingQuote(sessionId: string, quote: PendingQuote | null): void
  addChild(parentSessionId: string, childSessionId: string): void
  childrenOf(parentSessionId: string): readonly string[]
  parentOf(childSessionId: string): string | undefined
  /** Whether a session is a follow-up session (has a parent in the mapping). */
  isSideSession(sessionId: string): boolean
  /** The root (main) session of a session, walking the parent chain up. */
  rootOf(sessionId: string): string
}

/** Parse the persisted map, tolerating any corruption. */
function loadMap(): Record<string, string[]> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        out[key] = value.filter((item): item is string => typeof item === 'string')
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the map (best-effort; localStorage may be unavailable). */
function saveMap(map: Record<string, string[]>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore — the in-memory map remains authoritative for the session.
  }
}

/** Compute the reverse index from the forward map. */
function reverseIndex(map: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [parentId, childIds] of Object.entries(map)) {
    for (const childId of childIds) out[childId] = parentId
  }
  return out
}

/** Create one store instance (call once per plugin activation). */
export function createSidebarqaStore(): SidebarqaStore {
  let parentToChildren = loadMap()
  let pendingBySession: Record<string, PendingQuote> = {}
  const listeners = new Set<() => void>()
  // The snapshot is cached so getSnapshot() returns a STABLE reference until a
  // mutation invalidates it (useSyncExternalStore's no-tearing contract — a
  // fresh object per read would loop React infinitely).
  let cachedSnapshot: SidebarqaStoreSnapshot | null = null

  const notify = (): void => {
    cachedSnapshot = null
    for (const fn of [...listeners]) fn()
  }

  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  const getSnapshot = (): SidebarqaStoreSnapshot => {
    if (cachedSnapshot === null) {
      cachedSnapshot = {
        parentToChildren,
        childToParent: reverseIndex(parentToChildren),
        pendingBySession,
      }
    }
    return cachedSnapshot
  }

  return {
    getSnapshot,
    subscribe,
    setPendingQuote(sessionId: string, quote: PendingQuote | null): void {
      const next = { ...pendingBySession }
      if (quote === null) delete next[sessionId]
      else next[sessionId] = quote
      pendingBySession = next
      notify()
    },
    addChild(parentSessionId: string, childSessionId: string): void {
      if (parentSessionId === '' || childSessionId === '') return
      if (parentSessionId === childSessionId) return
      const existing = parentToChildren[parentSessionId] ?? []
      if (existing.includes(childSessionId)) return
      const next = { ...parentToChildren, [parentSessionId]: [...existing, childSessionId] }
      parentToChildren = next
      saveMap(next)
      notify()
    },
    childrenOf(parentSessionId: string): readonly string[] {
      return parentToChildren[parentSessionId] ?? []
    },
    parentOf(childSessionId: string): string | undefined {
      return reverseIndex(parentToChildren)[childSessionId]
    },
    isSideSession(sessionId: string): boolean {
      return reverseIndex(parentToChildren)[sessionId] !== undefined
    },
    rootOf(sessionId: string): string {
      let current = sessionId
      const reverse = reverseIndex(parentToChildren)
      const seen = new Set<string>()
      while (reverse[current] !== undefined && !seen.has(current)) {
        seen.add(current)
        current = reverse[current] as string
      }
      return current
    },
  }
}
