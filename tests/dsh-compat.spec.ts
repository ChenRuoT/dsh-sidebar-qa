/**
 * The plugin must load on a DSH 0.2.x host — the peer gate says so, twice.
 *
 * DSH 0.2.0 added a boot-time compatibility gate
 * (`packages/boot/app-boot/src/plugin-compatibility.ts`,
 * `evaluatePluginCompatibility`): for one profile bundle, EVERY
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` entry in its `peerDependencies` is
 * checked with `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`.
 * A bundle with even one unsatisfied peer has its WHOLE patch layer skipped
 * (`profile.ts` `loadProfileDirectory` pushes it onto `skippedBundles` and the
 * boot prints `dsh: skipping profile bundle "…"` to stderr) — the host half
 * never loads and the client bundle is never composed, so the plugin is simply
 * absent. Not degraded: absent, with the only trace on stderr.
 *
 * This plugin lived exactly that failure: the peer was written
 * `@deepseek-ai/dsh-client-locale: ^0.1.0-rc.8`, and a caret on a prerelease
 * normalizes to `>=0.1.0-rc.8 <0.2.0-0` — a CEILING, not a floor. DSH
 * `0.2.0-rc.1` is past `0.2.0-0`, so on every 0.2.x host the bundle was
 * skipped, which is what the 0.2.0 upgrade report looked like from the user
 * side. The remedy is structural: every gated peer range is a pure lower bound
 * (no `<` comparator), which admits 0.2.x and every later generation instead of
 * predicting one.
 *
 * This suite mirrors the gate in node so the failure is a red test here rather
 * than a silently missing plugin on someone's machine. The `stub pinning`
 * block closes the other half of the same lesson (hard constraint 8): a
 * devDependency range like `^0.1.0-rc.8` can never match a newer prerelease,
 * so the type stub silently freezes on an old API generation while `tsc`
 * reports green.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { describe, expect, it } from 'vitest'

/** This package's manifest — the very object the DSH gate reads. */
const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}

/** The peer moniker the 0.2.0 gate evaluates; everything else is unread. */
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const GATED_NAMES = ['@deepseek-ai/dsh', DSH_PEER_PREFIX]

/**
 * DSH runtimes this plugin must load on, in the order they matter: the floor it
 * declares, the previous release line, the runtime that broke it, the first
 * final 0.2, and a future prerelease that a pure lower bound must still admit.
 */
const RUNTIMES = [
  '0.1.7-alpha.1',
  '0.1.7-rc.2',
  '0.2.0-rc.1',
  '0.2.0',
  '0.3.0-rc.1',
]

/** The DSH checkout on this machine, when there is one (read-only reference). */
const DSH_SOURCE_ROOT = process.env.DSH_SOURCE_ROOT ?? 'D:/dsh/deepseek-harness'
const DSH_APP_BOOT_MANIFEST = join(DSH_SOURCE_ROOT, 'packages/boot/app-boot/package.json')

/**
 * One run of the 0.2.0 boot gate over this manifest, mirrored line for line.
 * @param runtimeVersion - the DSH version to check against.
 * @returns the peers the gate would skip the bundle over, or undefined when the plugin loads.
 */
function gatedPeersOf(runtimeVersion: string): Record<string, string> | undefined {
  const peers: Record<string, string> = {}
  for (const [name, range] of Object.entries(MANIFEST.peerDependencies)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith(DSH_PEER_PREFIX)) continue
    if (!semver.satisfies(runtimeVersion, range, { includePrerelease: true })) peers[name] = range
  }
  return Object.keys(peers).length === 0 ? undefined : peers
}

/** Every `@deepseek-ai/dsh*` peer range the manifest declares. */
function dshPeers(): Array<{ name: string; range: string }> {
  return Object.entries(MANIFEST.peerDependencies)
    .filter(([name]) => GATED_NAMES.some(prefix => name === prefix || name.startsWith(prefix)))
    .map(([name, range]) => ({ name, range }))
}

describe('the DSH 0.2 peer-compatibility gate', () => {
  it('reads at least one gated peer, so the checks below cannot go vacuous', () => {
    expect(dshPeers().length).toBeGreaterThanOrEqual(1)
  })

  it('admits every DSH runtime this plugin supports', () => {
    for (const runtime of RUNTIMES) {
      expect(gatedPeersOf(runtime), `${MANIFEST.name}@${MANIFEST.version} would be skipped on dsh ${runtime}`).toBeUndefined()
    }
  })

  it('would still catch the ceiling that broke the 0.2.0 upgrade', () => {
    // The historical bug, kept as the detector: a caret over a prerelease is a
    // floor PLUS a ceiling, and 0.2.0-rc.1 sits past `<0.2.0-0`.
    expect(semver.satisfies('0.2.0-rc.1', '^0.1.0-rc.8', { includePrerelease: true })).toBe(false)
    const ceiling = semver.validRange('^0.1.0-rc.8')
    expect(ceiling).not.toBeNull()
    expect(ceiling).toContain('<0.2.0-0')
    // The same manifest with the retired range fails the gate on the runtime
    // that motivated this suite.
    const historical = { ...MANIFEST.peerDependencies, '@deepseek-ai/dsh-client-locale': '^0.1.0-rc.8' }
    expect(Object.entries(historical).some(([name]) => name === '@deepseek-ai/dsh-client-locale')).toBe(true)
    expect(semver.satisfies('0.2.0-rc.1', historical['@deepseek-ai/dsh-client-locale']!, { includePrerelease: true })).toBe(false)
  })

  it('writes every gated peer as a pure lower bound — no ceiling can re-block a future generation', () => {
    for (const { name, range } of dshPeers()) {
      const normalized = semver.validRange(range)
      expect(normalized, `${name}: "${range}" is not a range at all`).not.toBeNull()
      expect(normalized, `${name}: "${range}" carries a ceiling; a DSH upgrade would skip the whole bundle again`).not.toContain('<')
      expect(semver.satisfies('0.2.0', range, { includePrerelease: true }), `${name}: "${range}" must admit the final 0.2.0`).toBe(true)
      expect(semver.satisfies('0.2.0-rc.1', range, { includePrerelease: true }), `${name}: "${range}" must admit the running prerelease`).toBe(true)
    }
  })

  it.skipIf(!existsSync(DSH_APP_BOOT_MANIFEST))(
    'loads on the DSH checkout this machine runs, read from its own boot manifest',
    () => {
      const boot = JSON.parse(readFileSync(DSH_APP_BOOT_MANIFEST, 'utf8')) as { version: string }
      expect(gatedPeersOf(boot.version), `the checkout at ${DSH_SOURCE_ROOT} runs dsh ${boot.version}`).toBeUndefined()
    },
  )
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
