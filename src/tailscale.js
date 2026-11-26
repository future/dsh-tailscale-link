/**
 * `tailscale` CLI adapter: process execution, node identity, and Serve status.
 *
 * Only the documented CLI surface is used (`tailscale status --json`,
 * `tailscale serve status --json`, `tailscale serve --bg --https=<port>`,
 * `tailscale serve --https=<port> off`). Nothing here reads Tailscale state
 * files directly.
 */

import { execFile } from 'node:child_process'

/**
 * Run one command and never throw.
 * @param {string} binary - Executable path or name.
 * @param {string[]} args - Argument vector.
 * @param {number} timeoutMs - Hard timeout.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>} Captured result.
 */
export function run(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

/**
 * Find a usable `tailscale` executable.
 * @param {{binaryPath: string|null, timeoutMs: number}} config - Normalized config.
 * @returns {Promise<string|undefined>} The executable to use, when it answers `version`.
 */
export async function resolveBinary(config) {
  const candidates = config.binaryPath !== null ? [config.binaryPath, 'tailscale'] : ['tailscale']
  for (const candidate of candidates) {
    const result = await run(candidate, ['version'], config.timeoutMs)
    if (result.ok) return candidate
  }
  return undefined
}

/**
 * @param {string} binary - Executable.
 * @param {number} timeoutMs - Hard timeout.
 * @returns {Promise<Record<string, unknown>|undefined>} Parsed `tailscale status --json`.
 */
export async function readStatus(binary, timeoutMs) {
  const result = await run(binary, ['status', '--json'], timeoutMs)
  if (!result.ok) return undefined
  return parseJson(result.stdout)
}

/**
 * @param {string} binary - Executable.
 * @param {number} timeoutMs - Hard timeout.
 * @returns {Promise<Record<string, unknown>|undefined>} Parsed Serve config; absent config parses as `{}`.
 */
export async function readServeStatus(binary, timeoutMs) {
  const result = await run(binary, ['serve', 'status', '--json'], timeoutMs)
  // Without any Serve config the command may exit non-zero and print nothing.
  if (!result.ok && result.stdout.trim() === '') return {}
  return parseJson(result.stdout) ?? {}
}

/**
 * @param {string} text - Raw JSON.
 * @returns {Record<string, unknown>|undefined} Parsed object or undefined.
 */
function parseJson(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the node's MagicDNS name without the trailing root dot.
 * @param {Record<string, unknown>|undefined} status - `tailscale status --json` output.
 * @returns {string|undefined} Lower-case DNS name.
 */
export function dnsNameOf(status) {
  const self = status?.Self
  const raw = self !== null && typeof self === 'object' ? /** @type {Record<string, unknown>} */ (self).DNSName : undefined
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.replace(/\.$/, '').trim().toLowerCase()
  return trimmed === '' ? undefined : trimmed
}

/**
 * @param {Record<string, unknown>|undefined} status - `tailscale status --json` output.
 * @returns {string|undefined} `BackendState`, such as `Running`.
 */
export function backendStateOf(status) {
  const value = status?.BackendState
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalise the effective HTTPS port of a Serve host key.
 *
 * `tailscale serve` may record the default HTTPS port with no explicit suffix
 * (`host` rather than `host:443`), so a raw `new URL(...).port` comparison can
 * never match 443: `new URL('https://host').port` is `''`.
 * @param {string} key - Serve host key such as `node.ts.net` or `node.ts.net:7259`.
 * @returns {number} The port the key publishes, or `NaN` when unparsable.
 */
export function authorityPort(key) {
  try {
    const url = new URL(`https://${key}`)
    if (url.port !== '') return Number(url.port)
    return url.protocol === 'https:' ? 443 : 80
  } catch {
    return Number.NaN
  }
}

/**
 * @param {string} a - One Serve host key.
 * @param {string} b - Another Serve host key.
 * @returns {boolean} Whether two keys name the same authority (443 suffix optional).
 */
export function sameAuthority(a, b) {
  return a === b || (authorityPort(a) === authorityPort(b) && a.split(':')[0] === b.split(':')[0])
}

/**
 * Pick the Serve key a caller means on one port.
 *
 * Several keys can publish the same port — a renamed node leaves the old name
 * behind, and another tool may share the port. Preferring the expected
 * authority keeps our own route from being hidden behind a stale one.
 * @param {Record<string, unknown>} hosts - `Web` map from the Serve config.
 * @param {number} port - Port to filter by.
 * @param {string|undefined} expectedAuthority - Preferred key for this run.
 * @returns {string|undefined} The chosen key.
 */
function pickAuthority(hosts, port, expectedAuthority) {
  const keys = Object.keys(hosts).filter((key) => authorityPort(key) === port)
  if (keys.length === 0) return undefined
  if (expectedAuthority !== undefined && keys.includes(expectedAuthority)) return expectedAuthority
  if (expectedAuthority !== undefined) {
    const equivalent = keys.find((key) => sameAuthority(key, expectedAuthority))
    if (equivalent !== undefined) return equivalent
  }
  return keys[0]
}

/**
 * Classify the Serve handler currently published on one HTTPS port.
 *
 * `exact` means a route already proxies this instance (nothing to do);
 * `stale` means a loopback proxy to some other port (safe to replace with our
 * own registration); `conflict` means somebody else's handler.
 * @param {Record<string, unknown>|undefined} status - Parsed Serve config.
 * @param {number} port - HTTPS port the route publishes.
 * @param {string} target - Our own loopback target, e.g. `http://127.0.0.1:3080`.
 * @param {string} [expectedAuthority] - Key this run would publish; preferred when several share the port.
 * @returns {{kind: 'absent'|'exact'|'stale'|'conflict', authority?: string, reason?: string}} Classification.
 */
export function classifyServe(status, port, target, expectedAuthority) {
  const web = status?.Web
  const hosts = web !== null && typeof web === 'object' ? /** @type {Record<string, unknown>} */ (web) : {}
  const authority = pickAuthority(hosts, port, expectedAuthority)
  if (authority === undefined) return { kind: 'absent' }
  const routes = hosts[authority]
  const handlers = routes !== null && typeof routes === 'object'
    ? /** @type {Record<string, unknown>} */ (routes).Handlers
    : undefined
  if (handlers === null || typeof handlers !== 'object') {
    return { kind: 'conflict', authority, reason: `${authority} 的處理程序無法識別` }
  }
  const paths = Object.keys(/** @type {Record<string, unknown>} */ (handlers))
  if (paths.length !== 1 || paths[0] !== '/') {
    return { kind: 'conflict', authority, reason: `${authority} 上還有其它路徑（${paths.join(', ')}）` }
  }
  const root = /** @type {Record<string, unknown>} */ (handlers)['/']
  const proxy = root !== null && typeof root === 'object' ? /** @type {Record<string, unknown>} */ (root).Proxy : undefined
  if (typeof proxy !== 'string') return { kind: 'conflict', authority, reason: `${authority} 的根處理程序不是反向代理` }
  const normalized = proxy.replace(/\/+$/, '')
  if (normalized === target) return { kind: 'exact', authority }
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(normalized)) {
    return { kind: 'stale', authority }
  }
  return { kind: 'conflict', authority, reason: `${authority} 已代理到 ${proxy}` }
}
