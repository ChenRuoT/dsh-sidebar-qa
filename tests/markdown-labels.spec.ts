/**
 * The pinned `ui-primitives` type stub must stay on the post-rename side of
 * MarkdownText's copy prop.
 *
 * MarkdownText took `codeLabels` up to the `0.1.0-rc.*` line and takes `labels`
 * (a `MarkdownLabels` = `{ code, footnotes }`) from `0.1.2-alpha.2` on — and the
 * host's renderer reads `labels.code.copyLabel` with NO guard, so a plugin that
 * passes the retired prop does not merely lose its copy-button text: EVERY
 * fenced code block throws a TypeError at render time, which retires the tab body
 * page-wide (the seat's per-entry boundary abandons the registration). That is
 * exactly the "panel went white and cannot be recovered" report.
 *
 * `tsc` cannot catch the drift on its own: it checks our call against whatever
 * stub is installed, so a devDependency that reaches back to a pre-rename version
 * (the `^0.1.0-rc.8` range can NEVER match a newer prerelease — semver only
 * admits a prerelease when a comparator carries the same major.minor.patch)
 * silently re-opens the hole. This suite pins the stub itself.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The installed stub's answer for MarkdownText's props. */
function markdownTextTypes(): string {
  return readFileSync(
    new URL(
      '../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/markdown/MarkdownText.d.ts',
      import.meta.url,
    ),
    'utf8',
  )
}

describe('the pinned ui-primitives type stub', () => {
  it('declares the `labels` vocabulary the plugin passes', () => {
    expect(markdownTextTypes()).toContain('labels: MarkdownLabels')
  })

  it('no longer accepts the retired `codeLabels` prop', () => {
    // Matched as a PROP (`codeLabels:`) so the still-exported
    // `MarkdownCodeLabels` type name does not trip this.
    expect(markdownTextTypes()).not.toMatch(/\bcodeLabels\??:/)
  })
})
