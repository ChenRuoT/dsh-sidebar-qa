/**
 * The ask panel's view mode.
 *
 * Pure and dependency-free, so it is testable under the project's `node`
 * environment: `AskPanel` is a `.tsx` module whose import chain ends at a
 * `.module.css` file the Node ESM loader refuses to parse.
 */

/**
 * Which of the panel's three faces the current state calls for.
 *
 * A pending quote only owns the view while no follow-up is selected: picking an
 * existing child in the switcher returns to that conversation (the quote stays
 * parked for the 新追问 button), and cancelling the quote without children falls
 * back to the empty hint.
 * @param hasQuote - whether a pending quote (the open's payload, or the store's) is present.
 * @param activeChildId - the selected follow-up session, or null.
 * @returns the view mode.
 */
export function resolveAskMode(hasQuote: boolean, activeChildId: string | null): 'start' | 'conversation' | 'empty' {
  if (activeChildId !== null) return 'conversation'
  return hasQuote ? 'start' : 'empty'
}
