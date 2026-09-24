/**
 * The panel renders on a host whose icon set was RENAMED — the shape that crashed.
 *
 * `0.1.7-alpha.1` renamed the whole icon set (size suffix → weight suffix, no
 * aliases), so every glyph this plugin used to import by name became `undefined`
 * on that host, and React answers `undefined` with "Element type is invalid ...
 * but got: undefined" (production error #130). In the ask panel that meant the
 * composer row threw and the containment boundary replaced the panel with its
 * crash strip.
 *
 * The mock below is that host: the weight-suffixed names ONLY, plus the three
 * components the panel legitimately imports by name. A component that still
 * imports a glyph by name cannot render here — which is the assertion.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: h } = await import('react')
  /** A glyph of the renamed set, drawing its own name so it is assertable. */
  const glyph = (name: string) => ({ className }: { className?: string }) =>
    h('svg', className === undefined ? { 'data-icon': name } : { 'data-icon': name, className })
  return {
    // The 0.1.7 generation: NO `…14` / `…16` names exist at all.
    IconChevronDownOutlineRegular: glyph('chevron-down'),
    IconChevronRightOutlineRegular: glyph('chevron-right'),
    IconCheckOutlineRegular: glyph('check'),
    IconWarningOutlineRegular: glyph('warning'),
    IconTriangleRightFillRegular: glyph('fold'),
    IconQuestionOutlineRegular: glyph('question'),
    IconQueueOutlineRegular: glyph('queue'),
    // The named imports the panel keeps on purpose (API surfaces, not artwork).
    Menu: ({ anchor }: { anchor: ReturnType<typeof h> }) => anchor,
    Tooltip: ({ children }: { children: ReturnType<typeof h> }) => children,
    MarkdownText: ({ text }: { text: string }) => h('span', null, text),
  }
})

const { StrategySelect } = await import('../src/client/StrategySelect.tsx')

describe('a panel control on a host that renamed its icons', () => {
  it('draws the glyph it RESOLVED instead of the retired name', () => {
    const markup = renderToStaticMarkup(createElement(StrategySelect, {
      value: 'compressed',
      onChange: () => { /* the assertion is the render itself */ },
    }))

    expect(markup).toContain('data-icon="chevron-down"')
    // The strategy chip's own artwork is the plugin's inline SVG, not a host
    // glyph — the assertion is that the control rendered at all.
    expect(markup).toContain('_chipLabel_')
  })
})
