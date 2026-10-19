/**
 * Keep `dsh.plugin.json` (the plugin-registry channel manifest) on the same
 * version and `engines.dsh` as `package.json`.
 *
 * Wired to npm's `version` lifecycle script, so `pnpm version patch|minor|major`
 * updates both manifests while the release is being prepared. Note that the
 * version commit pnpm/npm creates contains ONLY `package.json`: the release flow
 * then stages this file, amends that commit, and re-points the tag
 * (`git add dsh.plugin.json && git commit --amend --no-edit && git tag -f v<version>`).
 * `tests/dsh-compat.spec.ts` enforces the two manifests agree, so a tag that
 * skipped the amend fails CI before publishing.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const packageManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const pluginPath = new URL('../dsh.plugin.json', import.meta.url)
const original = readFileSync(pluginPath, 'utf8')
const pluginManifest = JSON.parse(original)

pluginManifest.version = packageManifest.version
const enginesDsh = packageManifest.engines?.dsh
if (typeof enginesDsh === 'string' && enginesDsh !== '') {
  pluginManifest.engines = { ...pluginManifest.engines, dsh: enginesDsh }
}

// Preserve the checked-out line endings so a version bump does not leave a
// spurious worktree-only diff on Windows (core.autocrlf) or Linux.
const eol = original.includes('\r\n') ? '\r\n' : '\n'
const body = JSON.stringify(pluginManifest, null, 2).replace(/\n/g, eol)
writeFileSync(pluginPath, `${body}${eol}`)
console.info(
  `dsh.plugin.json: version ${pluginManifest.version}, engines.dsh ${pluginManifest.engines?.dsh ?? '(none)'}`,
)
