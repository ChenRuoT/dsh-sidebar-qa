/**
 * Browser-trust fence for the sidebarqa route, behaviorally identical to the
 * /api gateway's fence (Host-header loopback, the listener's own bind address,
 * or a configured trusted authority passes; cross-site browser markers refuse).
 * This is a DNS-rebinding / cross-site defense, not authentication.
 *
 * Upstream moved this fence in DSH `0.2.1-alpha.1`:
 * - `webRuntime` was deleted; invocation authorities now live on
 *   `webStartup.trustedHosts` (`packages/bundle/web-app/src/startup.ts`), and
 * - the fence starts accepting the listener's own bind IP literal
 *   (`packages/client/connection/src/api-request-trust.ts:105-151`).
 *
 * The bind-address rule matters for the common deployment `dsh web --host
 * 10.0.0.7`: the browser dials `http://10.0.0.7:3080`, so the Host header names
 * the bind address. It is not in `trustedHosts`, and refusing it would 403 every
 * LAN browser even though the user explicitly bound that interface.
 */
import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads (structural subset of IncomingMessage). */
interface ApiTrustRequest {
  headers: IncomingHttpHeaders
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalized URL of a bare authority (hostname lowercased, default port
 * stripped, IPv6 bracketed), or undefined when unparsable.
 * @param authority - `host` or `host:port` text.
 * @param scheme - special scheme to parse under; its default port is stripped.
 */
function parseAuthority(authority: string, scheme: 'http:' | 'https:' = 'http:'): URL | undefined {
  try {
    // http: and https: are WHATWG "special schemes": parsing yields a non-empty
    // hostname or throws.
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical authority form: `hostname` when no port was written, else
 * `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== ''
    ? entryUrl.port
    : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a trustedHosts entry. An entry with an
 * explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port. Both sides compare through WHATWG normalization, so
 * case and a redundant scheme-default port never decide trust.
 */
function isTrustedAuthority(
  hostUrl: URL,
  trustedHosts: readonly string[],
  protocol: 'http:' | 'https:',
): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, protocol)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Whether a normalized URL hostname names the local loopback authority.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Whether the request authority names the deployment's own bind address. A
 * browser dialing that literal sends it as Host, and accepting it grants
 * nothing further: the literal is no rebinding target, the Origin and
 * cross-site checks still apply, and it stays outside `trustedHosts`. Matching
 * ignores the port, like a port-less entry, and any `%zone` id (an interface
 * selector, not address text).
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined || bindHost === '') return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Compare Host under the Origin's HTTP(S) scheme so default ports normalize
 * consistently. The transport may remain HTTP behind an HTTPS proxy.
 * @param origin - verbatim Origin header value.
 * @param host - verbatim Host header value already accepted by the Host fence.
 * @returns true only when the Origin is this listener's own `http(s)` authority.
 */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  // Only http(s) can name this listener: the opaque `null` already threw above,
  // and every other scheme (file:, ftp:) fails here rather than matching by
  // hostname alone.
  const scheme = originUrl.protocol === 'https:'
    ? 'https:'
    : originUrl.protocol === 'http:'
      ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * Decide whether one request may reach the plugin routes.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact
 *   `host:port`, or port-less `host` matching any port.
 * @param bindHost - the listener's own bind IP literal, accepted on any port
 *   independently of `trustedHosts` (absent on older hosts / when unreadable).
 * @param protocol - the listener's protocol, for default-port normalization.
 * @returns true when the Host is loopback, the bind address, or a trusted
 *   authority, and browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ApiTrustRequest,
  trustedHosts: readonly string[],
  bindHost?: string,
  protocol: 'http:' | 'https:' = 'http:',
): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host, protocol)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)
    && !isTrustedAuthority(hostUrl, trustedHosts, protocol)
    && !isBindAddressAuthority(hostUrl, bindHost)) return false
  // Cross-site fence: modern browsers label the initiator relationship on every
  // fetch; an explicit cross-site marker is refused regardless of Origin.
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be exactly this
  // authority (compared through the same normalization as the Host). Absent
  // Origin is fine — the Host fence above already bound the request. The
  // literal "null" (sandboxed iframes, file: pages) is an opaque origin, refused.
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  return isSameAuthorityOrigin(origin, host)
}
