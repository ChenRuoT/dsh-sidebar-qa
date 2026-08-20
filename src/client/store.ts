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
import { removeSubtree, subtreeIds } from './history-scope.ts'

const STORAGE_KEY = 'dsh-sidebar-qa:map'
const TITLED_STORAGE_KEY = 'dsh-sidebar-qa:titled'
const COLLAPSED_STORAGE_KEY = 'dsh-sidebar-qa:collapsed'

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
  /** Whether a side session's post-answer retitle has been attempted. */
  isTitled(sessionId: string): boolean
  /** Mark a side session's post-answer retitle as attempted (fires once). */
  markTitled(sessionId: string): void
  /** Whether a tree node's follow-up subtree is collapsed in 追问记录 (persisted). */
  isCollapsed(sessionId: string): boolean
  /** Flip a tree node's collapse state in 追问记录 (persisted). */
  toggleCollapsed(sessionId: string): void
  /**
   * Remove one session's whole subtree from the mapping (追问记录 "移除" entry
   * for archived / deleted sessions): the id is unlinked from its parent, its
   * descendants lose their rows (they must not resurface as roots), and any
   * derived state (titled / collapsed) for the subtree is cleared.
   */
  removeSession(sessionId: string): void
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

/** Parse the persisted titled-session set, tolerating any corruption. */
function loadTitled(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(TITLED_STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

/** Persist the titled-session set (best-effort; localStorage may be unavailable). */
function saveTitled(sessions: Set<string>): void {
  try {
    globalThis.localStorage?.setItem(TITLED_STORAGE_KEY, JSON.stringify([...sessions]))
  } catch {
    // ignore — the in-memory set remains authoritative for the session.
  }
}

/** Parse the persisted collapsed-session set (追问记录 fold state), tolerating corruption. */
function loadCollapsed(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

/** Persist the collapsed-session set (best-effort; localStorage may be unavailable). */
function saveCollapsed(sessions: Set<string>): void {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...sessions]))
  } catch {
    // ignore — the in-memory set remains authoritative for the session.
  }
}

/** Create one store instance (call once per plugin activation). */
export function createSidebarqaStore(): SidebarqaStore {
  let parentToChildren = loadMap()
  let titledSessions = loadTitled()
  let collapsedSessions = loadCollapsed()
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
    isTitled(sessionId: string): boolean {
      return titledSessions.has(sessionId)
    },
    markTitled(sessionId: string): void {
      if (titledSessions.has(sessionId)) return
      const next = new Set(titledSessions)
      next.add(sessionId)
      titledSessions = next
      saveTitled(titledSessions)
    },
    isCollapsed(sessionId: string): boolean {
      return collapsedSessions.has(sessionId)
    },
    toggleCollapsed(sessionId: string): void {
      const next = new Set(collapsedSessions)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      collapsedSessions = next
      saveCollapsed(collapsedSessions)
      notify()
    },
    removeSession(sessionId: string): void {
      if (sessionId === '') return
      const known = parentToChildren[sessionId] !== undefined
        || Object.values(parentToChildren).some(children => children.includes(sessionId))
      if (!known) return
      const subtree = subtreeIds(parentToChildren, sessionId)
      const next = removeSubtree(parentToChildren, sessionId)
      parentToChildren = next
      saveMap(next)
      if (subtree.some(id => titledSessions.has(id))) {
        const nextTitled = new Set(titledSessions)
        for (const id of subtree) nextTitled.delete(id)
        titledSessions = nextTitled
        saveTitled(nextTitled)
      }
      if (subtree.some(id => collapsedSessions.has(id))) {
        const nextCollapsed = new Set(collapsedSessions)
        for (const id of subtree) nextCollapsed.delete(id)
        collapsedSessions = nextCollapsed
        saveCollapsed(nextCollapsed)
      }
      notify()
    },
  }
}
