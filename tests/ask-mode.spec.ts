import { describe, expect, it } from 'vitest'
import { resolveAskMode } from '../src/client/ask-mode.ts'

describe('resolveAskMode', () => {
  it('opens the start view when a quote is pending and nothing is selected', () => {
    expect(resolveAskMode(true, null)).toBe('start')
  })

  it('shows the empty hint when there is neither a quote nor a selection', () => {
    expect(resolveAskMode(false, null)).toBe('empty')
  })

  it('returns to a selected follow-up even while a quote is parked', () => {
    // The quote stays parked for the 新追问 button instead of owning the view.
    expect(resolveAskMode(true, 'child-1')).toBe('conversation')
  })

  it('keeps the selected follow-up when no quote is pending', () => {
    expect(resolveAskMode(false, 'child-1')).toBe('conversation')
  })
})
