import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, isTrustedApiRequest } from '../src/trust-fence.ts'

function request(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts localhost, IPv6 loopback, and every 127/8 address', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.10.20.30')).toBe(true)
  })

  it('rejects non-loopback and malformed IPv4 spellings', () => {
    expect(isLoopbackHostname('127.0.0.256')).toBe(false)
    expect(isLoopbackHostname('127.0.0')).toBe(false)
    expect(isLoopbackHostname('10.0.0.7')).toBe(false)
    expect(isLoopbackHostname('[::2]')).toBe(false)
  })
})

describe('isTrustedApiRequest — loopback', () => {
  it('admits a loopback Host without any trusted authorities', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:64396' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'localhost:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '[::1]:3080' }), [])).toBe(true)
  })

  it('refuses a request without a Host header', () => {
    expect(isTrustedApiRequest(request({}), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'not a host :::' }), [])).toBe(false)
  })
})

describe('isTrustedApiRequest — listener bind address', () => {
  it('admits the bind IP literal independently of trustedHosts', () => {
    // `dsh web --host 10.0.0.7`: the LAN browser dials that literal.
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [], '10.0.0.7')).toBe(true)
  })

  it('ignores the port when matching the bind address', () => {
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:9999' }), [], '10.0.0.7')).toBe(true)
  })

  it('accepts an IPv6 bind address with a zone id', () => {
    expect(isTrustedApiRequest(request({ host: '[fe80::1]:3080' }), [], 'fe80::1%eth0')).toBe(true)
  })

  it('does not admit a look-alike host', () => {
    expect(isTrustedApiRequest(request({ host: '10.0.0.8:3080' }), [], '10.0.0.7')).toBe(false)
  })

  it('keeps the old behaviour when no bind host is known', () => {
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [])).toBe(false)
  })
})

describe('isTrustedApiRequest — trusted authorities', () => {
  it('admits an exact host:port entry', () => {
    expect(isTrustedApiRequest(request({ host: 'app.example:8443' }), ['app.example:8443'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'app.example:8444' }), ['app.example:8443'])).toBe(false)
  })

  it('admits a port-less entry on any port, through WHATWG normalization', () => {
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), ['app.example'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'APP.example:3080' }), ['app.example'])).toBe(true)
  })

  it('normalizes a scheme-default port on an explicit entry', () => {
    // An explicit :443 entry parsed under https is redundant, so it matches.
    expect(isTrustedApiRequest(request({ host: 'app.example:443' }), ['app.example:443'], undefined, 'https:'))
      .toBe(true)
    // Under http the same entry stays explicit and does not match Host :3080.
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), ['app.example:443'])).toBe(false)
  })

  it('refuses an untrusted authority', () => {
    expect(isTrustedApiRequest(request({ host: 'evil.example:3080' }), ['app.example'])).toBe(false)
  })
})

describe('isTrustedApiRequest — browser markers', () => {
  it('refuses any cross-site request, even a loopback one', () => {
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }),
      [],
    )).toBe(false)
  })

  it('admits a same-origin Origin', () => {
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }),
      [],
    )).toBe(true)
  })

  it('normalizes a default port between Origin and Host', () => {
    expect(isTrustedApiRequest(
      request({ host: 'app.example', origin: 'https://app.example:443' }),
      ['app.example'],
      undefined,
      'https:',
    )).toBe(true)
  })

  it('refuses a mismatched, opaque, or non-http(s) Origin', () => {
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }),
      [],
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'null' }),
      [],
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'file:///tmp/x' }),
      [],
    )).toBe(false)
  })
})
