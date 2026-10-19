/**
 * The plugin must load on every DSH this package claims — under BOTH gate
 * generations, because the gate changed shape mid-0.2:
 *
 * - **DSH 0.2.0** (`packages/boot/app-boot/src/plugin-compatibility.ts`):
 *   EVERY `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` entry in `peerDependencies`
 *   is checked with `semver.satisfies(runtime, range, { includePrerelease: true })`.
 *   A bundle with one unsatisfied peer has its WHOLE patch layer skipped
 *   (`loadProfileDirectory` → `skippedBundles`, one stderr line) — the plugin is
 *   ABSENT, not degraded. This is why every gated peer range is a pure lower
 *   bound: `^0.1.0-rc.8` is a floor PLUS a ceiling (`<0.2.0-0`), and it skipped
 *   the entire bundle on 0.2.x (the 1.1.0 fix).
 * - **DSH 0.2.1-alpha.3+**: the gate reads an own `engines.dsh` FIRST and, when
 *   present, **ignores peerDependencies entirely** (`unmetRequirements`:
 *   `if (Object.hasOwn(engines, 'dsh')) return …`). So `engines.dsh` is now the
 *   real loading switch — it must also be a pure lower bound, and it must stay
 *   in sync between `package.json` and `dsh.plugin.json`.
 *
 * The peer ranges still matter: a 0.2.0 host has no `engines.dsh` branch, so it
 * keeps evaluating them. Both kinds of range are therefore asserted to admit
 * the whole supported runtime line and every later prerelease.
 *
 * The `stub pinning` block closes the other half of the same lesson (hard
 * constraint 8): a devDependency range like `^0.1.0-rc.8` can never match a
 * newer prerelease, so the type stub silently freezes on an old API generation
 * while `tsc` reports green.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

/** One plugin manifest as the boot gate reads it. */
interface GatedManifest {
  readonly engines?: { readonly dsh?: string }
  readonly peerDependencies: Record<string, string>
}

/** This package's manifest — the very object the DSH gate reads. */
const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as GatedManifest & {
  name: string
  version: string
  devDependencies: Record<string, string>
}

/** The plugin-registry channel manifest; it carries its own version/engines copy. */
const PLUGIN_MANIFEST = JSON.parse(readFileSync(new URL('../dsh.plugin.json', import.meta.url), 'utf8')) as {
  version?: string
  engines?: { dsh?: string }
}

/** The peer moniker the 0.2.0 gate evaluates; everything else is unread. */
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const GATED_NAMES = ['@deepseek-ai/dsh', DSH_PEER_PREFIX]

/**
 * DSH runtimes this plugin must load on: the declared floor, the release that
 * broke the peers, the first final 0.2, the current 0.2.1 line, and a future
 * prerelease that a pure lower bound must still admit.
 */
const RUNTIMES = [
  '0.1.7-alpha.1',
  '0.1.7-rc.2',
  '0.2.0-rc.1',
  '0.2.0',
  '0.2.1-rc.2',
  '0.2.1',
  '0.3.0-rc.1',
]

/** The DSH checkout on this machine, when there is one (read-only reference). */
const DSH_SOURCE_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:/dsh/deepseek-harness'
const DSH_APP_BOOT_MANIFEST = join(DSH_SOURCE_ROOT, 'packages/boot/app-boot/package.json')

/** Whether one range accepts a runtime (the gate's own flags). */
function admits(range: string, runtime: string): boolean {
  return semver.satisfies(runtime, range, { includePrerelease: true })
}

/**
 * One run of the 0.2.0 gate over a manifest, mirrored line for line.
 * @param runtimeVersion - the DSH version to check against.
 * @returns the peers the gate would skip the bundle over, or undefined when the plugin loads.
 */
function gatedPeersOf(manifest: GatedManifest, runtimeVersion: string): Record<string, string> | undefined {
  const peers: Record<string, string> = {}
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith(DSH_PEER_PREFIX)) continue
    if (!admits(range, runtimeVersion)) peers[name] = range
  }
  return Object.keys(peers).length === 0 ? undefined : peers
}

/**
 * One run of the 0.2.1+ gate over a manifest: an own `engines.dsh` decides
 * ALONE; peers are read only when it is absent.
 * @param manifest - plugin manifest.
 * @param runtimeVersion - the DSH version to check against.
 */
function unmetRequirementsOf(manifest: GatedManifest, runtimeVersion: string): Record<string, string> | undefined {
  const engines = manifest.engines ?? {}
  if (Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh
    if (typeof range !== 'string') throw new Error('Plugin manifest engines.dsh must be a string')
    return admits(range, runtimeVersion) ? undefined : { 'engines.dsh': range }
  }
  return gatedPeersOf(manifest, runtimeVersion)
}

/** Every `@deepseek-ai/dsh*` peer range the manifest declares. */
function dshPeers(): Array<{ name: string; range: string }> {
  return Object.entries(MANIFEST.peerDependencies)
    .filter(([name]) => GATED_NAMES.some(prefix => name === prefix || name.startsWith(prefix)))
    .map(([name, range]) => ({ name, range }))
}

describe('the DSH boot gate — 0.2.0 peer generation', () => {
  it('reads at least one gated peer, so the checks below cannot go vacuous', () => {
    expect(dshPeers().length).toBeGreaterThanOrEqual(1)
  })

  it('admits every DSH runtime this plugin supports', () => {
    for (const runtime of RUNTIMES) {
      expect(gatedPeersOf(MANIFEST, runtime), `${MANIFEST.name}@${MANIFEST.version} would be skipped on dsh ${runtime}`).toBeUndefined()
    }
  })

  it('would still catch the ceiling that broke the 0.2.0 upgrade', () => {
    // The historical bug, kept as the detector: a caret over a prerelease is a
    // floor PLUS a ceiling, and 0.2.0-rc.1 sits past `<0.2.0-0`.
    expect(semver.satisfies('0.2.0-rc.1', '^0.1.0-rc.8', { includePrerelease: true })).toBe(false)
    const ceiling = semver.validRange('^0.1.0-rc.8')
    expect(ceiling).not.toBeNull()
    expect(ceiling).toContain('<0.2.0-0')
    const historical: GatedManifest = {
      peerDependencies: { ...MANIFEST.peerDependencies, '@deepseek-ai/dsh-client-locale': '^0.1.0-rc.8' },
    }
    expect(Object.entries(historical.peerDependencies).some(([name]) => name === '@deepseek-ai/dsh-client-locale')).toBe(true)
    expect(admits(historical.peerDependencies['@deepseek-ai/dsh-client-locale']!, '0.2.0-rc.1')).toBe(false)
  })

  it('writes every gated peer as a pure lower bound — no ceiling can re-block a future generation', () => {
    for (const { name, range } of dshPeers()) {
      const normalized = semver.validRange(range)
      expect(normalized, `${name}: "${range}" is not a range at all`).not.toBeNull()
      expect(normalized, `${name}: "${range}" carries a ceiling; a DSH upgrade would skip the whole bundle again`).not.toContain('<')
      expect(admits(range, '0.2.0'), `${name}: "${range}" must admit the final 0.2.0`).toBe(true)
      expect(admits(range, '0.2.0-rc.1'), `${name}: "${range}" must admit the running prerelease`).toBe(true)
    }
  })
})

describe('the DSH boot gate — 0.2.1+ engines generation', () => {
  it('declares engines.dsh as a string, so the gate can decide on it', () => {
    expect(typeof MANIFEST.engines?.dsh).toBe('string')
    expect(MANIFEST.engines?.dsh).not.toBe('')
  })

  it('admits every runtime through engines.dsh', () => {
    for (const runtime of RUNTIMES) {
      expect(unmetRequirementsOf(MANIFEST, runtime), `engines.dsh would skip the bundle on dsh ${runtime}`).toBeUndefined()
    }
  })

  it('ignores peer ranges once engines.dsh is present (the 0.2.1 semantics)', () => {
    // The exact trap the new gate introduces: a manifest that carries a perfect
    // engines.dsh floor plus a leftover ceiling peer still loads, because peers
    // are not read at all. That is why engines.dsh itself must stay a floor.
    const manifest: GatedManifest = {
      engines: { dsh: '>=0.1.7-alpha.1' },
      peerDependencies: { '@deepseek-ai/dsh-client-locale': '>=0.1.0-rc.8 <0.2.0-0' },
    }
    expect(unmetRequirementsOf(manifest, '0.2.1-rc.2')).toBeUndefined()
  })

  it('would catch an engines.dsh ceiling, which now blocks loading by itself', () => {
    const ceiling: GatedManifest = {
      engines: { dsh: '>=0.1.7-alpha.1 <0.3.0-0' },
      peerDependencies: MANIFEST.peerDependencies,
    }
    expect(unmetRequirementsOf(ceiling, '0.3.0-rc.1')).toEqual({ 'engines.dsh': '>=0.1.7-alpha.1 <0.3.0-0' })
  })

  it('writes engines.dsh as a pure lower bound', () => {
    const range = MANIFEST.engines?.dsh ?? ''
    const normalized = semver.validRange(range)
    expect(normalized).not.toBeNull()
    expect(normalized).not.toContain('<')
    expect(admits(range, '0.2.1-rc.2')).toBe(true)
    expect(admits(range, '0.3.0-rc.1')).toBe(true)
  })

  it.skipIf(!existsSync(DSH_APP_BOOT_MANIFEST))(
    'loads on the DSH checkout this machine runs, read from its own boot manifest',
    () => {
      const boot = JSON.parse(readFileSync(DSH_APP_BOOT_MANIFEST, 'utf8')) as { version: string }
      expect(unmetRequirementsOf(MANIFEST, boot.version), `the checkout at ${DSH_SOURCE_ROOT} runs dsh ${boot.version}`).toBeUndefined()
    },
  )
})

describe('manifest consistency across both channels', () => {
  it('keeps the plugin-registry manifest on the package version', () => {
    expect(PLUGIN_MANIFEST.version).toBe(MANIFEST.version)
  })

  it('keeps the plugin-registry engines.dsh identical to package.json', () => {
    expect(PLUGIN_MANIFEST.engines?.dsh).toBe(MANIFEST.engines?.dsh)
  })
})

describe('the @deepseek-ai type stubs', () => {
  it('are pinned exactly, never by a range (hard constraint 8)', () => {
    const stubs = Object.entries(MANIFEST.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/'))
    // At least the two the client half is written against.
    expect(stubs.length).toBeGreaterThanOrEqual(2)
    for (const [name, range] of stubs) {
      // `semver.valid` accepts exactly one version: any range operator (`^`,
      // `>=`, a space-separated pair) returns null. A range whose floor is a
      // prerelease can never match a later prerelease of the suite, which is
      // how the MarkdownText `codeLabels` crash survived a green typecheck.
      expect(semver.valid(range), `${name}: devDependency "${range}" must be an exact pin`).not.toBeNull()
    }
  })

  it('match the copies actually installed under node_modules', () => {
    const stubs = Object.entries(MANIFEST.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/'))
    for (const [name, pinned] of stubs) {
      const installed = new URL(`../node_modules/${name}/package.json`, import.meta.url)
      expect(existsSync(installed), `${name}@${pinned} is not installed; run pnpm install`).toBe(true)
      const copy = JSON.parse(readFileSync(installed, 'utf8')) as { version: string }
      expect(copy.version, `${name} is installed at ${copy.version}, pinned at ${pinned}`).toBe(pinned)
    }
  })
})
