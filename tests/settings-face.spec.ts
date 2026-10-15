/**
 * The settings-seam capability probe (`src/settings-face.ts`).
 *
 * This module exists because of TWO issue reports against the same seam, and
 * both are pinned here:
 *
 * - issue #19: `dsh-settings@0.1.7-alpha.1` renamed nothing but removed runtime
 *   namespace registration (`SettingsProvider` with `register` → `SettingsForms`
 *   without it), so an unguarded `settingsService.register(...)` threw
 *   `TypeError: settingsService.register is not a function` on every launch.
 * - issue #21: the plugin then had NO writable seam at all on such a host — the
 *   panel answered 503 "no sidebarqa settings namespace" for every save, because
 *   the probe only knew the namespace shape while 0.1.7+ addresses a plugin's
 *   form by PROFILE ENTRY ID.
 *
 * The fake services below are built from the two REAL upstream shapes — the npm
 * `latest` provider (0.1.6 and older) and the 0.1.7+ forms holder — plus the
 * degenerate shapes a future host might produce. Nothing here may throw: a
 * refusal is a typed value, because the probe runs inside a cordis `inject`
 * callback whose throw would be a launch-time failure.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  openSettingsSeam,
  settingsRefusalMessage,
  type SidebarqaConfigFace,
  type SidebarqaSettingsSeamReason,
} from '../src/settings-face.ts'

const NS = 'sidebarqa'
/** The profile row id the 0.1.7+ shape addresses (NOT the namespace). */
const ENTRY = 'sidebar-qa'
const SCHEMA = { marker: 'schema' }

/** The `dsh-settings@0.1.7-alpha.1+` shape: a forms holder with NO register. */
function formsLike(descriptions: unknown[] = []): Record<string, unknown> {
  return {
    configure: () => undefined,
    describe: () => descriptions,
    update: async () => undefined,
    replace: async () => undefined,
    mutate: async () => undefined,
    schema: () => undefined,
  }
}

/** The `dsh-settings@0.1.5-rc.2` (npm `latest`) shape: provider with register. */
function providerLike(options: {
  value?: unknown
  revision?: number
  descriptions?: unknown
  update?: (ns: string, patch: object, expectedRevision?: number) => Promise<void>
} = {}): { service: Record<string, unknown>; register: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const scope = { get: () => options.value ?? null, watch: () => () => undefined, update: async () => undefined }
  const register = vi.fn(() => scope)
  const described = options.descriptions ?? [{ ns: NS, value: options.value, revision: options.revision ?? 7 }]
  const update = vi.fn(options.update ?? (async () => undefined))
  return {
    service: { register, describe: () => described, update, get: () => options.value },
    register,
    update,
  }
}

describe('openSettingsSeam — refusals', () => {
  it('reports a missing service instead of throwing', () => {
    expect(openSettingsSeam(undefined, NS, SCHEMA, ENTRY)).toEqual({ ok: false, reason: 'service-missing' })
    expect(openSettingsSeam(null, NS, SCHEMA, ENTRY)).toEqual({ ok: false, reason: 'service-missing' })
  })

  it('refuses a 0.1.7 host that has no entry id to address, without calling anything', () => {
    let describeCalls = 0
    const service = { ...formsLike(), describe: () => { describeCalls += 1; return [] } }

    expect(openSettingsSeam(service, NS, SCHEMA)).toEqual({ ok: false, reason: 'no-entry' })
    // Refusing on the missing key alone: probing must not call describe/update on
    // an address it cannot name (issue #21's host throws for an unknown entry).
    expect(describeCalls).toBe(0)
  })

  it('refuses a service with neither registration nor a form API (no-form)', () => {
    for (const value of ['settings', 42, true]) {
      expect(openSettingsSeam(value, NS, SCHEMA, ENTRY)).toEqual({ ok: false, reason: 'no-form' })
    }
    // A service that names namespaces but never exposes a form API cannot be
    // written through either shape.
    expect(openSettingsSeam({ register: undefined }, NS, SCHEMA, ENTRY)).toEqual({ ok: false, reason: 'no-form' })
    expect(openSettingsSeam({ describe: () => [] }, NS, SCHEMA, ENTRY)).toEqual({ ok: false, reason: 'no-form' })
  })

  it('keeps a registration failure as a typed refusal that carries the original error', () => {
    const boom = new Error('settings namespace "sidebarqa" is already registered')
    const service = { register: () => { throw boom }, describe: () => [], update: async () => undefined }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    expect(seam.ok).toBe(false)
    if (seam.ok) throw new Error('unreachable')
    expect(seam.reason).toBe('register-failed')
    expect(seam.error).toBe(boom)
  })

  it('never throws for a refusal shape a future host might produce', () => {
    const hostile = {
      register: 7,
      describe: 'nope',
      update: null,
      get configure() { throw new Error('getter exploded') },
    }
    expect(() => openSettingsSeam(hostile, NS, SCHEMA, ENTRY)).not.toThrow()
  })
})

describe('openSettingsSeam — the legacy namespace path (<= 0.1.6)', () => {
  it('forwards the namespace and schema to register and exposes the scope', () => {
    const { service, register } = providerLike({ value: { answerModel: 'm' } })

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error(`expected an opened seam, got ${seam.reason}`)
    expect(seam.kind).toBe('namespace')
    if (seam.kind !== 'namespace') throw new Error('unreachable')
    expect(register).toHaveBeenCalledWith(NS, SCHEMA)
    expect(seam.scope.get()).toEqual({ answerModel: 'm' })
  })

  it('reads the namespace descriptor for the value AND the revision', () => {
    const { service } = providerLike({ value: { answerModel: 'm' }, revision: 12 })

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: { answerModel: 'm' }, revision: 12 })
  })

  it('writes through update with the namespace and the expected revision, then re-reads', async () => {
    let value: Record<string, unknown> = { answerModel: 'old' }
    let revision = 3
    const { service, update } = providerLike({
      update: async (ns, patch) => {
        expect(ns).toBe(NS)
        value = { ...value, ...patch }
        revision += 1
      },
    })
    ;(service as { describe: () => unknown }).describe = () => [{ ns: NS, value, revision }]

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    const view = await seam.face.update({ answerModel: 'new' }, 3)

    // The revision guard is the whole point of the face: dropping it would let a
    // stale panel overwrite a concurrent change without a conflict.
    expect(update).toHaveBeenCalledWith(NS, { answerModel: 'new' }, 3)
    expect(view).toEqual({ value: { answerModel: 'new' }, revision: 4 })
  })

  it('refuses to write (with a named error) when the host exposes no update', async () => {
    const service = { register: () => ({ get: () => null }), describe: () => [] }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    await expect((seam.face as SidebarqaConfigFace).update({}, 1)).rejects.toThrow(/no settings\.update/)
  })
})

describe('openSettingsSeam — the profile-entry path (>= 0.1.7, issue #21)', () => {
  it('opens the form addressed by the plugin ENTRY ID, not by the namespace', async () => {
    let value: Record<string, unknown> = { summarizeModel: 'flash' }
    let revision = 0
    const update = vi.fn(async (ns: string, patch: object) => {
      // The id is the whole fix: sending `sidebarqa` here is issue #21 exactly
      // (the host answers `No configurable plugin entry "sidebarqa"`).
      expect(ns).toBe(ENTRY)
      value = { ...value, ...patch }
      revision += 1
    })
    const service = {
      ...formsLike([]),
      describe: () => [{ ns: ENTRY, value, revision }],
      update,
    }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error(`expected an opened seam, got ${seam.reason}`)
    expect(seam.kind).toBe('entry')
    // No scope: the read source in this mode is the plugin's own volatile
    // Config, not a namespace.
    expect('scope' in seam).toBe(false)
    expect(seam.face.get()).toEqual({ value: { summarizeModel: 'flash' }, revision: 0 })

    const view = await seam.face.update({ summarizeModel: 'v4' }, 0)
    expect(update).toHaveBeenCalledWith(ENTRY, { summarizeModel: 'v4' }, 0)
    expect(view).toEqual({ value: { summarizeModel: 'v4' }, revision: 1 })
  })

  it('ignores another row and answers an empty view rather than someone else’s config', () => {
    const service = { ...formsLike([]), describe: () => [{ ns: 'someone-else', value: { a: 1 }, revision: 9 }] }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: undefined, revision: undefined })
  })

  it('returns an empty view when describe answers a non-array', () => {
    const service = { ...formsLike([]), describe: () => undefined }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: undefined, revision: undefined })
  })

  it('unwraps live refs in a descriptor value, so a resolved form never serializes as {}', () => {
    // A host that resolves volatile fields hands back `{ get() }` refs; shipping
    // those over the wire would render an empty panel (JSON.stringify(ref) ===
    // '{}'), which is precisely the failure class this seam guards.
    const ref = { get: () => ({ historyStrategy: 'trim', nested: { get: () => 3 } }) }
    const service = { ...formsLike([]), describe: () => [{ ns: ENTRY, value: ref, revision: 2 }] }

    const seam = openSettingsSeam(service, NS, SCHEMA, ENTRY)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: { historyStrategy: 'trim', nested: 3 }, revision: 2 })
  })
})

describe('settingsRefusalMessage', () => {
  const reasons: SidebarqaSettingsSeamReason[] = ['service-missing', 'no-form', 'no-entry', 'register-failed']

  it('has distinct, non-empty copy for every reason', () => {
    const messages = reasons.map(settingsRefusalMessage)
    for (const message of messages) expect(message.length).toBeGreaterThan(20)
    expect(new Set(messages).size).toBe(reasons.length)
  })

  it('names the actual problem, so a 503 is diagnosable from the panel', () => {
    expect(settingsRefusalMessage('no-entry')).toMatch(/profile row/)
    expect(settingsRefusalMessage('no-form')).toMatch(/no namespace registration/)
    expect(settingsRefusalMessage('register-failed')).toMatch(/refused the sidebarqa settings namespace/)
  })
})

describe('the host half uses the probe (issue #19 / #21 wiring guards)', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  it('opens the seam through openSettingsSeam, with this plugin’s own row id', () => {
    expect(source).toContain('openSettingsSeam<SidebarqaConfig>(')
    // Without the id the 0.1.7+ path can never open — the #21 regression.
    expect(source).toContain('profileEntryIdOf(ctx)')
    expect(source).toContain("ctx.fiber?.entry?.options?.id")
  })

  it('never calls settingsService.register directly', () => {
    // A bare call is exactly issue #19: on a 0.1.7 host it is a TypeError on
    // every launch. Keeping the raw call unreachable is the regression this pins.
    expect(source).not.toMatch(/settingsService\.register/)
  })

  it('keeps the refusal vocabulary in the seam module only', () => {
    // The retired `no-register` reason described a host we can now write to;
    // a leftover reference would mean a second, divergent decision path.
    expect(source).not.toMatch(/no-register/)
    expect(source).toContain('settingsRefusalMessage(')
  })

  it('declares the plugin Config so the host can derive our form', () => {
    expect(source).toContain('export const Config = SidebarqaPrefsSchema')
  })
})
