import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { SIDEBARQA_DEFAULTS, type SidebarqaLiveConfig } from '../src/config.ts'
import type { Context } from '../src/context-types.ts'

/**
 * Wiring test for the /sidebarqa/api trust fence: `apply` must read the
 * authorities from the CURRENT host face (`webStartup`), fall back to the legacy
 * `webRuntime` / loader literal, and accept the listener's bind address.
 *
 * The fence itself is covered by `trust-fence.spec.ts`; this file proves the
 * route is actually wired to those sources. It reproduced the 0.2.1 regression
 * where the fence read only `webRuntime` (removed) and silently degraded to
 * loopback-only.
 */

interface FakeResponse {
  statusCode: number
  body: string
  writeHead(status: number): void
  end(body: string): void
}

function fakeRequest(headers: Record<string, string>, method = 'config', payload: object = {}): unknown {
  return {
    method: 'POST',
    url: `/sidebarqa/api/${method}`,
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload))
    },
  }
}

function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    body: '',
    writeHead(status: number): void { this.statusCode = status },
    end(body: string): void { this.body = body },
  }
}

interface HostFaces {
  webStartup?: { trustedHosts?: unknown }
  webRuntime?: { trustedHosts?: unknown }
  loaderEntries?: { options: { id: string; name: string; config?: { trustedHosts?: unknown } } }[]
  host?: string
  protocol?: 'http:' | 'https:'
  settings?: unknown
  config?: SidebarqaLiveConfig
  llm?: unknown
  sessionQuery?: unknown
}

describe('issue #23 config read/write and effective model', () => {
  const headers = { host: '127.0.0.1' }

  it('uses entry config with a hybrid service, saves live values and refuses stale writes', async () => {
    let value = { ...SIDEBARQA_DEFAULTS, answerModel: 'custom', trimWindowMessages: 7 }
    let revision = 0
    const config = Object.fromEntries(Object.keys(value).map(key => [key, {
      get: () => value[key as keyof typeof value],
    }])) as SidebarqaLiveConfig
    const register = vi.fn(() => { throw new Error('legacy namespace must not be opened') })
    const call = mount({ config, settings: {
      register,
      configure: () => () => {},
      describe: () => [{ ns: 'sidebar-qa', value, revision }],
      update: async (id: string, patch: object, expected: number) => {
        expect(id).toBe('sidebar-qa')
        if (expected !== revision) throw Object.assign(new Error('stale'), { code: 'SETTINGS_CONFLICT' })
        value = { ...value, ...patch }
        revision++
      },
    } })
    const read = async (method = 'config') => JSON.parse((await call(headers, method)).body).value
    expect(await read()).toMatchObject({ answerModel: 'custom', trimWindowMessages: 7 })
    expect(await read('config.get')).toMatchObject({ value, revision: 0 })
    const saved = await call(headers, 'config.update', { patch: { trimWindowMessages: 19 }, expectedRevision: 0 })
    expect(saved.statusCode).toBe(200)
    expect(JSON.parse(saved.body).value).toMatchObject({ value: { trimWindowMessages: 19 }, revision: 1 })
    expect(await read()).toMatchObject({ trimWindowMessages: 19 })
    expect((await call(headers, 'config.update', { patch: { trimWindowMessages: 99 }, expectedRevision: 0 })).statusCode).toBe(409)
    expect(await read()).toMatchObject({ trimWindowMessages: 19 })
    expect(register).not.toHaveBeenCalled()
  })

  it.each(['deepseek-v4-flash', 'deepseek-flash'])('uses the served %s id for answer, compression and title', async (id) => {
    const stream = vi.fn(async function* (_options: { model: string }) { yield { type: 'text-delta', index: 0, text: 'topic' } })
    const call = mount({
      llm: { listModels: async () => [{ id }], stream },
      sessionQuery: { readSurface: async () => ({ capturedThroughSeq: 4, events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: 'one' }] } },
        { type: 'user/message', data: { content: [{ type: 'text', text: 'two' }] } },
        { type: 'user/message', data: { content: [{ type: 'text', text: 'three' }] } },
      ] }) },
    })
    expect(JSON.parse((await call(headers)).body).value.answerModel).toBe(id)
    // Stored settings remain exactly as configured; alias resolution is runtime-only.
    expect(JSON.parse((await call(headers, 'config.get')).body).value.value.answerModel).toBe('deepseek-v4-flash')
    await call(headers, 'title', { provider: 'deepseek-official', text: 'question and answer' })
    expect(stream.mock.calls.at(-1)?.[0]).toMatchObject({ model: id })
    stream.mockClear()
    await call(headers, 'context', { mainSessionId: 'parent', provider: 'deepseek-official' })
    expect(stream.mock.calls.at(-1)?.[0]).toMatchObject({ model: id })
  })
})

/** Build the minimal host context `apply` needs, and capture its one route. */
function mount(faces: HostFaces): (headers: Record<string, string>, method?: string, payload?: object) => Promise<FakeResponse> {
  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
  const ctx = {
    get: (name: string) => {
      if (name === 'webStartup') return faces.webStartup
      if (name === 'webRuntime') return faces.webRuntime
      return undefined
    },
    loader: { entries: () => faces.loaderEntries ?? [] },
    webServer: {
      register: (route: { handler: (req: never, res: never) => Promise<void> }) => {
        handler = route.handler as unknown as (req: unknown, res: unknown) => Promise<void>
        return () => {}
      },
      host: faces.host,
      protocol: faces.protocol,
    },
    inject: (_names: string[], callback: (ctx: unknown) => void) => {
      if (faces.settings !== undefined) callback(ctx)
    },
    settings: faces.settings,
    effect: (fn: () => () => void) => fn(),
    llm: faces.llm ?? {},
    sessionQuery: faces.sessionQuery ?? {},
    fiber: { entry: { options: { id: 'sidebar-qa' } } },
  } as unknown as Context

  apply(ctx, faces.config)
  return async (headers, method, payload) => {
    if (handler === undefined) throw new Error('the plugin mounted no /sidebarqa/api route')
    const response = fakeResponse()
    await handler(fakeRequest(headers, method, payload), response)
    return response
  }
}

describe('/sidebarqa/api trust fence wiring (DSH >= 0.2.1)', () => {
  it('accepts a trusted authority read from webStartup', async () => {
    const call = mount({ webStartup: { trustedHosts: ['app.example'] }, host: '127.0.0.1' })
    const response = await call({ host: 'app.example:3080' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ ok: true })
  })

  it('accepts the listener bind address without any trusted authority', async () => {
    // `dsh web --host 10.0.0.7`: the LAN browser's Host is that literal.
    const call = mount({ webStartup: { trustedHosts: [] }, host: '10.0.0.7' })
    expect((await call({ host: '10.0.0.7:3080' })).statusCode).toBe(200)
  })

  it('refuses an untrusted authority', async () => {
    const call = mount({ webStartup: { trustedHosts: ['app.example'] }, host: '127.0.0.1' })
    const response = await call({ host: 'evil.example:3080' })
    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('refuses a cross-site request even from a loopback Host', async () => {
    const call = mount({ webStartup: { trustedHosts: [] } })
    expect((await call({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403)
  })

  it('accepts a loopback Host as before', async () => {
    const call = mount({ webStartup: { trustedHosts: [] } })
    expect((await call({ host: '127.0.0.1:64396' })).statusCode).toBe(200)
  })
})

describe('/sidebarqa/api trust fence wiring (fallbacks)', () => {
  it('prefers webStartup over a legacy webRuntime face', async () => {
    // Presence decides: an authoritative empty list means loopback-only, and a
    // stale webRuntime must not widen it.
    const call = mount({
      webStartup: { trustedHosts: [] },
      webRuntime: { trustedHosts: ['legacy.example'] },
    })
    expect((await call({ host: 'legacy.example:3080' })).statusCode).toBe(403)
  })

  it('falls back to the legacy webRuntime face', async () => {
    const call = mount({ webRuntime: { trustedHosts: ['legacy.example'] } })
    expect((await call({ host: 'legacy.example:3080' })).statusCode).toBe(200)
  })

  it('falls back to the loader connection row literal', async () => {
    const call = mount({
      loaderEntries: [
        { options: { id: 'other', name: 'x' } },
        { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { trustedHosts: ['row.example'] } } },
      ],
    })
    expect((await call({ host: 'row.example:3080' })).statusCode).toBe(200)
  })

  it('does not throw on a malformed startup value (refuses instead)', async () => {
    const call = mount({ webStartup: { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } } })
    expect((await call({ host: 'app.example:3080' })).statusCode).toBe(403)
    // A loopback request still passes: an unreadable list degrades to empty.
    expect((await call({ host: '127.0.0.1:3080' })).statusCode).toBe(200)
  })
})
