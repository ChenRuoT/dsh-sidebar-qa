/**
 * The 「添加到对话」 formatting contract: how a captured selection becomes a
 * Markdown blockquote, and how that block merges into the composer's existing
 * draft. This is the whole testable surface of the feature — `draft-insert.ts`
 * is plumbing and `SelectionPopover.tsx` is unreachable in the `node` env.
 */
import { describe, expect, it } from 'vitest'
import {
  blockquote,
  normalizeQuote,
  planQuoteInsert,
  QUOTE_DRAFT_MAX_LEN,
} from '../src/client/quote-draft.ts'

/**
 * The codepoints the composer itself strips on the way in
 * (`REFERENCE_PLACEHOLDER_RE` in ui-conversation's `input/facade.ts`) plus one
 * ordinary control char. Built with fromCharCode rather than written literally
 * so the fixtures stay visible in a diff and cannot be mangled by an editor.
 */
const OBJECT_REPLACEMENT = String.fromCharCode(0xfffc)
const PUA_FIRST = String.fromCharCode(0xe100)
const PUA_LAST = String.fromCharCode(0xe11d)
const NUL = String.fromCharCode(0)

describe('normalizeQuote', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeQuote('a\r\nb')).toBe('a\nb')
    expect(normalizeQuote('a\rb')).toBe('a\nb')
  })

  it('strips the composer placeholder codepoints', () => {
    // Stripping here keeps our `changed` flag honest instead of planning a
    // write that setDraft silently early-returns from.
    expect(normalizeQuote(`a${OBJECT_REPLACEMENT}b`)).toBe('ab')
    expect(normalizeQuote(`a${PUA_FIRST}b`)).toBe('ab')
    expect(normalizeQuote(`a${PUA_LAST}b`)).toBe('ab')
  })

  it('strips control characters but keeps tab and newline', () => {
    expect(normalizeQuote(`a${NUL}b`)).toBe('ab')
    expect(normalizeQuote('a\tb\nc')).toBe('a\tb\nc')
  })

  it('bounds an over-long selection', () => {
    const out = normalizeQuote('x'.repeat(QUOTE_DRAFT_MAX_LEN + 1))
    expect(out.length).toBeLessThanOrEqual(QUOTE_DRAFT_MAX_LEN + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never emits a carriage return', () => {
    expect(normalizeQuote('a\r\nb\rc')).not.toContain('\r')
  })
})

describe('blockquote', () => {
  it('prefixes a single line', () => {
    expect(blockquote('hello')).toBe('> hello')
  })

  it('prefixes every line of a multi-line selection', () => {
    expect(blockquote('a\nb')).toBe('> a\n> b')
  })

  it('renders an interior blank line as a bare `>`', () => {
    // A truly empty line would TERMINATE the block and split one quote in two.
    expect(blockquote('a\n\nb')).toBe('> a\n>\n> b')
  })

  it('drops leading and trailing blank lines', () => {
    expect(blockquote('\n\na\n\n')).toBe('> a')
  })

  it('trims per-line trailing whitespace', () => {
    expect(blockquote('a   \nb\t')).toBe('> a\n> b')
  })

  it('returns empty string for blank or whitespace-only input', () => {
    expect(blockquote('')).toBe('')
    expect(blockquote('   \n\t\n  ')).toBe('')
  })

  it('nests a selection that is already a quote', () => {
    // Intentional: quoting a quote should stay visibly quoted, not flatten.
    expect(blockquote('> q')).toBe('> > q')
  })

  it('normalizes CRLF before prefixing', () => {
    expect(blockquote('a\r\nb')).toBe('> a\n> b')
  })
})

describe('planQuoteInsert', () => {
  it('inserts into an empty draft', () => {
    expect(planQuoteInsert('', 'x')).toEqual({ next: '> x\n\n', changed: true })
  })

  it('treats a whitespace-only draft as empty', () => {
    // No stray leading blank paragraphs above the quote.
    expect(planQuoteInsert('  \n\n', 'x').next).toBe('> x\n\n')
  })

  it('appends below existing text, preserving it verbatim', () => {
    expect(planQuoteInsert('why?', 'x').next).toBe('why?\n\n> x\n\n')
  })

  it('collapses however many newlines the draft ended with to one blank line', () => {
    expect(planQuoteInsert('why?\n\n\n', 'x').next).toBe('why?\n\n> x\n\n')
  })

  it('plans nothing for a blank selection', () => {
    expect(planQuoteInsert('why?', '   ')).toEqual({ next: 'why?', changed: false })
  })

  it('reports changed:false when the text is only placeholders', () => {
    // The honesty invariant: `changed: true` here would ask setDraft to perform
    // a write it silently early-returns from, leaving the caret where it was.
    expect(planQuoteInsert('why?', OBJECT_REPLACEMENT)).toEqual({ next: 'why?', changed: false })
  })

  it('is deliberately not idempotent — a second click appends a second quote', () => {
    const once = planQuoteInsert('', 'x').next
    expect(planQuoteInsert(once, 'x').next).toBe('> x\n\n> x\n\n')
  })

  it('always ends a changed draft with a blank line so the caret lands outside the quote', () => {
    // A line written directly under `> x` would be a Markdown lazy
    // continuation and stay inside the blockquote.
    for (const draft of ['', 'why?', 'a\n\n']) {
      const plan = planQuoteInsert(draft, 'x')
      expect(plan.changed).toBe(true)
      expect(plan.next.endsWith('\n\n')).toBe(true)
    }
  })
})
