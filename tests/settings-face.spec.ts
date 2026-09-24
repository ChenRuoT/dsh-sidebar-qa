/**
 * The settings-seam capability probe (`src/settings-face.ts`).
 *
 * This module exists because of issue #19: `dsh-settings@0.1.7-alpha.1` renamed
 * nothing but removed the runtime namespace registration API (`SettingsProvider`
 * with `register` → `SettingsForms` without it), so an unguarded
 * `settingsService.register(...)` threw `TypeError: settingsService.register is
 * not a function` on every launch of a 0.1.7 host. The caller caught it (the
 * plugin degraded instead of dying) but logged a failure line.
 *
 * The fake services below are therefore built from the two REAL upstream shapes —
 * the npm `latest` provider and the 0.1.7 forms holder — plus the degenerate
 * shapes a future host might produce. Nothing here may throw: a refusal is a
 * typed value, because the probe runs inside a cordis `inject` callback whose
 * throw would be a launch-time failure.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { openSettingsSeam, type SidebarqaConfigFace } from '../src/settings-face.ts'

const NS = 'sidebarqa'
const SCHEMA = { marker: 'schema' }

/** The `dsh-settings@0.1.7-alpha.1+` shape: a forms holder with NO register. */
function formsLike(): Record<string, unknown> {
  return {
    configure: () => undefined,
    describe: () => [],
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
    expect(openSettingsSeam(undefined, NS, SCHEMA)).toEqual({ ok: false, reason: 'service-missing' })
    expect(openSettingsSeam(null, NS, SCHEMA)).toEqual({ ok: false, reason: 'service-missing' })
  })

  it('refuses a 0.1.7 host by STRUCTURE (no register) without calling anything', () => {
    let describeCalls = 0
    const service = { ...formsLike(), describe: () => { describeCalls += 1; return [] } }

    expect(openSettingsSeam(service, NS, SCHEMA)).toEqual({ ok: false, reason: 'no-register' })
    // The refusal must be decided by the missing method alone: probing must not
    // call describe/update on a service it cannot register a namespace with.
    expect(describeCalls).toBe(0)
  })

  it('treats a non-object service as "no register" rather than crashing on property access', () => {
    for (const value of ['settings', 42, true]) {
      expect(openSettingsSeam(value, NS, SCHEMA)).toEqual({ ok: false, reason: 'no-register' })
    }
  })

  it('keeps a registration failure as a typed refusal that carries the original error', () => {
    const boom = new Error('settings namespace "sidebarqa" is already registered')
    const service = { register: () => { throw boom }, describe: () => [], update: async () => undefined }

    const seam = openSettingsSeam(service, NS, SCHEMA)
    expect(seam.ok).toBe(false)
    if (seam.ok) throw new Error('unreachable')
    expect(seam.reason).toBe('register-failed')
    expect(seam.error).toBe(boom)
  })
})

describe('openSettingsSeam — the provider path', () => {
  it('forwards the namespace and schema to register and exposes the scope', () => {
    const { service, register } = providerLike({ value: { answerModel: 'm' } })

    const seam = openSettingsSeam(service, NS, SCHEMA)
    if (!seam.ok) throw new Error(`expected an opened seam, got ${seam.reason}`)
    expect(register).toHaveBeenCalledWith(NS, SCHEMA)
    expect(seam.scope.get()).toEqual({ answerModel: 'm' })
  })

  it('reads the namespace descriptor for the value AND the revision', () => {
    const { service } = providerLike({ value: { answerModel: 'm' }, revision: 12 })

    const seam = openSettingsSeam(service, NS, SCHEMA)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: { answerModel: 'm' }, revision: 12 })
  })

  it('returns an empty view (never undefined, never a throw) when the namespace is not described', () => {
    const other = providerLike({ descriptions: [{ ns: 'someone-else', value: {}, revision: 1 }] })

    const seam = openSettingsSeam(other.service, NS, SCHEMA)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: undefined, revision: undefined })
  })

  it('returns an empty view when describe answers a non-array', () => {
    const service = { register: () => ({ get: () => null }), describe: () => undefined, update: async () => undefined }

    const seam = openSettingsSeam(service, NS, SCHEMA)
    if (!seam.ok) throw new Error('expected an opened seam')
    expect(seam.face.get()).toEqual({ value: undefined, revision: undefined })
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

    const seam = openSettingsSeam(service, NS, SCHEMA)
    if (!seam.ok) throw new Error('expected an opened seam')
    const view = await seam.face.update({ answerModel: 'new' }, 3)

    // The revision guard is the whole point of the face: dropping it would let a
    // stale panel overwrite a concurrent change without a conflict.
    expect(update).toHaveBeenCalledWith(NS, { answerModel: 'new' }, 3)
    expect(view).toEqual({ value: { answerModel: 'new' }, revision: 4 })
  })

  it('refuses to write (with a named error) when the host exposes no update', async () => {
    const service = { register: () => ({ get: () => null }), describe: () => [] }

    const seam = openSettingsSeam(service, NS, SCHEMA)
    if (!seam.ok) throw new Error('expected an opened seam')
    await expect((seam.face as SidebarqaConfigFace).update({}, 1)).rejects.toThrow(/no settings\.update/)
  })
})

describe('the host half uses the probe (issue #19 wiring guard)', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  it('opens the seam through openSettingsSeam', () => {
    expect(source).toContain('openSettingsSeam<SidebarqaConfig>(')
  })

  it('never calls settingsService.register directly', () => {
    // A bare call is exactly the bug: on a 0.1.7 host it is a TypeError on every
    // launch. Keeping the raw call unreachable is the regression this pins.
    expect(source).not.toMatch(/settingsService\.register/)
  })
})
