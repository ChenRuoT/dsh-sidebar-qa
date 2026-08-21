/**
 * Pure resolution of the AskPanel's model seat: which session's model directory
 * the seat reads, whether a pick is committed / drafted / refused, and what the
 * seat displays. Dependency-free so the whole binding rule is unit-testable
 * without React or the wire layer.
 *
 * The seat used to bind the PARENT session whenever no follow-up was selected,
 * and `ModelSelect` writes what it binds — so picking a model for a follow-up
 * that did not exist yet rewrote the main conversation's model (issue #10).
 * The binding is now explicit about the three cases:
 *
 * - `commit`   — continuing a follow-up: the seat owns that child session and
 *                writes to it (the original, correct behavior).
 * - `draft`    — a new ask under `compressed` / `trim`: the pick is held locally
 *                and applied to the child AFTER it is created (`modelOverride`);
 *                nothing is ever written to the parent. What it shows is what
 *                the child will actually use — the configured answer model.
 * - `readonly` — a new ask under `inherit`: a fork child keeps the parent's
 *                model (that is what preserves the prefix-cache hit), so the
 *                seat displays the parent's model and refuses picks.
 *
 * In `draft` / `readonly` the parent session id is still handed to the seat, but
 * only as a READ address: `sessions.models` is a pure read (no log append, no
 * global write) and its catalog is provider-global, so a drafted model's
 * reasoning vocabulary comes back in the same response.
 */
import type { SidebarqaHistoryStrategy } from '../config.ts'
import type { SidebarqaModelSelection } from '../context-types.ts'
import type { SidebarqaConfigView } from './api.ts'
import type { CopyKey } from './locales.ts'

/** How the seat applies a pick. */
export type ModelSeatMode = 'commit' | 'draft' | 'readonly'

/** What the seat binds to for one panel state. */
export interface ModelSeatBinding {
  /** The session whose directory the seat reads (and writes in `commit`). */
  sessionId: string
  mode: ModelSeatMode
  /** What the seat displays; null = fall back to the read session's current. */
  value: SidebarqaModelSelection | null
  /** Copy KEY of the hover hint, present only for the read-only seat.
   *  A key, not the resolved text: the binding is memoized in AskPanel, and
   *  caching already-translated copy would freeze it at the memo's locale. */
  hintKey?: CopyKey
}

/** The answer-model half of the resolved config (all the seat needs). */
export type ModelSeatConfig = Pick<
  SidebarqaConfigView,
  'answerProvider' | 'answerModel' | 'answerReasoningEffort'
>

/** The panel facts the binding is derived from. */
export interface ModelSeatInput {
  /** The follow-up being continued, or null while starting a new one. */
  activeChildId: string | null
  /** The session being asked about (may itself be a follow-up: nesting). */
  parentSessionId: string
  /** The per-ask history strategy (only meaningful while starting a new ask). */
  strategy: SidebarqaHistoryStrategy
  /** The model the user pinned for the NEXT ask, or null. */
  pendingModel: SidebarqaModelSelection | null
  /** Resolved config; null while it is still loading or after a failed load. */
  config: ModelSeatConfig | null
}

/**
 * The configured answer model as a selection, or null when it cannot be used.
 * An unusable config (still loading, or an empty provider/model) falls back to
 * showing the read session's own current model rather than a half-empty chip.
 */
function configSelection(config: ModelSeatConfig | null): SidebarqaModelSelection | null {
  if (config === null) return null
  if (config.answerProvider === '' || config.answerModel === '') return null
  return {
    provider: config.answerProvider,
    model: config.answerModel,
    ...config.answerReasoningEffort === '' ? {} : { reasoningEffort: config.answerReasoningEffort },
  }
}

/**
 * Resolve the seat binding for one panel state.
 * @param input - the panel facts (active follow-up, parent, strategy, draft, config).
 * @returns which session to read, how a pick lands, what to display, and the hint.
 */
export function resolveModelSeat(input: ModelSeatInput): ModelSeatBinding {
  // Continuing a follow-up: the seat owns that session — and the strategy state
  // (whose chip is hidden in this mode) must not leak into the binding.
  if (input.activeChildId !== null) {
    return { sessionId: input.activeChildId, mode: 'commit', value: null }
  }

  // A fork child keeps the parent's model; `value: null` makes the seat display
  // the parent's reported current, which is exactly what the child will use.
  if (input.strategy === 'inherit') {
    return {
      sessionId: input.parentSessionId,
      mode: 'readonly',
      value: null,
      hintKey: 'modelInheritSeatHint',
    }
  }

  return {
    sessionId: input.parentSessionId,
    mode: 'draft',
    value: input.pendingModel ?? configSelection(input.config),
  }
}
