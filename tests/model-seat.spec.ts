import { describe, expect, it } from 'vitest'
import {
  resolveModelSeat,
  type ModelSeatConfig,
  type ModelSeatInput,
} from '../src/client/model-seat.ts'

const CONFIG: ModelSeatConfig = {
  answerProvider: 'deepseek-official',
  answerModel: 'deepseek-v4-flash',
  answerReasoningEffort: 'off',
}

const PENDING = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' }

/** A new-ask panel state (no follow-up selected) with the compressed default. */
function input(overrides: Partial<ModelSeatInput> = {}): ModelSeatInput {
  return {
    activeChildId: null,
    parentSessionId: 'parent-1',
    strategy: 'compressed',
    pendingModel: null,
    config: CONFIG,
    ...overrides,
  }
}

describe('resolveModelSeat: continuing a follow-up', () => {
  it('commits to the active child and shows that child', () => {
    expect(resolveModelSeat(input({ activeChildId: 'child-1' })))
      .toEqual({ sessionId: 'child-1', mode: 'commit', value: null })
  })
  it('carries no hint', () => {
    expect(Object.hasOwn(resolveModelSeat(input({ activeChildId: 'child-1' })), 'hint')).toBe(false)
  })
  it('ignores the strategy state, whose chip is hidden in this mode', () => {
    expect(resolveModelSeat(input({ activeChildId: 'child-1', strategy: 'inherit' })).mode).toBe('commit')
  })
  it('never leaks the pending draft into a child seat', () => {
    expect(resolveModelSeat(input({ activeChildId: 'child-1', pendingModel: PENDING })).value).toBeNull()
  })
})

describe('resolveModelSeat: a new ask under inherit', () => {
  const seat = resolveModelSeat(input({ strategy: 'inherit' }))

  it('reads the parent and refuses picks', () => {
    expect(seat.sessionId).toBe('parent-1')
    expect(seat.mode).toBe('readonly')
  })
  it('displays the parent model — what a fork child keeps', () => {
    expect(seat.value).toBeNull()
  })
  it('explains itself through a copy key, not resolved text', () => {
    // A KEY, not resolved text: AskPanel memoizes this binding, so caching
    // the translated hint would freeze it at the memo's locale.
    expect(seat.hintKey).toBe('modelInheritSeatHint')
  })
  it('ignores both the config and a pending draft', () => {
    expect(resolveModelSeat(input({ strategy: 'inherit', pendingModel: PENDING })).value).toBeNull()
  })
})

describe('resolveModelSeat: a new ask under compressed/trim', () => {
  it('drafts against the parent without writing it', () => {
    const seat = resolveModelSeat(input())
    expect(seat.sessionId).toBe('parent-1')
    expect(seat.mode).toBe('draft')
  })
  it('shows the configured answer model — what the child will actually use', () => {
    expect(resolveModelSeat(input()).value).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'off',
    })
  })
  it('treats trim the same as compressed', () => {
    expect(resolveModelSeat(input({ strategy: 'trim' }))).toEqual(resolveModelSeat(input()))
  })
  it('lets a pinned draft win over the config', () => {
    expect(resolveModelSeat(input({ pendingModel: PENDING })).value).toEqual(PENDING)
  })
  it('falls back to the parent current model while the config loads', () => {
    expect(resolveModelSeat(input({ config: null })).value).toBeNull()
  })
  it('falls back when the configured channel or model is empty', () => {
    expect(resolveModelSeat(input({ config: { ...CONFIG, answerProvider: '' } })).value).toBeNull()
    expect(resolveModelSeat(input({ config: { ...CONFIG, answerModel: '' } })).value).toBeNull()
  })
  it('omits the effort key entirely when the config names none', () => {
    const value = resolveModelSeat(input({ config: { ...CONFIG, answerReasoningEffort: '' } })).value
    expect(value).not.toBeNull()
    expect(Object.hasOwn(value ?? {}, 'reasoningEffort')).toBe(false)
  })
  it('keeps the draft across an inherit detour', () => {
    const pinned = input({ pendingModel: PENDING })
    expect(resolveModelSeat({ ...pinned, strategy: 'inherit' }).value).toBeNull()
    expect(resolveModelSeat(pinned).value).toEqual(PENDING)
  })
})
