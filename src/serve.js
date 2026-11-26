/**
 * Serve route lifecycle: publish our own loopback target on the HTTPS ports the
 * caller names, and withdraw only the ports we created.
 *
 * Two invariants this module exists to keep:
 *  - a Serve key is the node's MagicDNS name at registration time, so a renamed
 *    node leaves a working-but-unreachable route behind (`servePlan` re-registers
 *    under the current name instead of reusing the stale key);
 *  - an advertised URL must correspond to a route that really proxies this
 *    instance (`serveExposes`), which is what stops the plugin from handing out
 *    a port-less URL while only port 7259 is served.
 */

import { classifyServe, readServeStatus, run } from './tailscale.js'

/**
 * Decide what to do with the route currently occupying one port.
 * @param {{kind: string, authority?: string, reason?: string}} state - `classifyServe` output.
 * @param {string} expectedAuthority - Key this run would publish.
 * @returns {'reuse'|'register'|'conflict'} Action.
 */
export function servePlan(state, expectedAuthority) {
  if (state.kind === 'conflict') return 'conflict'
  if (state.kind === 'exact' && state.authority === expectedAuthority) return 'reuse'
  return 'register'
}

/**
 * Keys that legitimately name this instance on `port`.
 * @param {number} port - Published port.
 * @param {string} dnsName - Current MagicDNS name.
 * @returns {string[]} Acceptable Serve keys, most specific first.
 */
export function expectedAuthorities(port, dnsName) {
  return port === 443 ? [`${dnsName}:443`, dnsName] : [`${dnsName}:${String(port)}`]
}

/**
 * Whether one port really proxies `target` for this node.
 * @param {Record<string, unknown>|undefined} status - Parsed Serve config.
 * @param {number} port - Port to inspect.
 * @param {string} target - Our loopback target.
 * @param {string} dnsName - Current MagicDNS name.
 * @returns {boolean} True only for an exact route under an acceptable key.
 */
export function serveExposes(status, port, target, dnsName) {
  const acceptable = expectedAuthorities(port, dnsName)
  for (const expected of acceptable) {
    const state = classifyServe(status, port, target, expected)
    if (state.kind === 'exact' && state.authority !== undefined && acceptable.includes(state.authority)) return true
  }
  return false
}

/**
 * Ensure a Serve route publishes `target` on `port`, under the current node name.
 * @param {object} options - Dependencies and inputs.
 * @param {string} options.binary - `tailscale` executable.
 * @param {{timeoutMs: number}} options.config - Normalized config.
 * @param {string} options.target - Loopback target such as `http://127.0.0.1:3080`.
 * @param {number} options.port - Port to publish.
 * @param {string} options.dnsName - Current MagicDNS name.
 * @returns {Promise<{created: boolean, kind: string, authority?: string, reason?: string}>} Outcome; `created` drives teardown.
 */
export async function ensureServe({ binary, config, target, port, dnsName }) {
  const expected = expectedAuthorities(port, dnsName)[0]
  const status = await readServeStatus(binary, config.timeoutMs)
  const state = classifyServe(status, port, target, expected)
  const plan = servePlan(state, expected)
  if (plan === 'reuse') return { created: false, kind: 'exact', authority: state.authority }
  if (plan === 'conflict') return { created: false, kind: 'conflict', reason: state.reason }
  const result = await run(binary, ['serve', '--bg', `--https=${String(port)}`, target], config.timeoutMs)
  if (!result.ok) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 300)
    throw new Error(detail === '' ? `tailscale serve --https=${String(port)} 失敗` : detail)
  }
  const kind = state.kind === 'exact' ? 'renamed' : state.kind
  return { created: true, kind }
}

/**
 * Withdraw one port's Serve route. Idempotent and never throws.
 *
 * `tailscale serve --https=<port> off` closes that port for the whole node, not
 * one key, so callers must only pass ports this plugin created.
 * @param {object} options - Dependencies and inputs.
 * @param {string|undefined} options.binary - `tailscale` executable.
 * @param {{timeoutMs: number}} options.config - Normalized config.
 * @param {number} options.port - Port to withdraw.
 * @returns {Promise<boolean>} Whether the CLI reported success.
 */
export async function releaseServe({ binary, config, port }) {
  if (binary === undefined) return false
  const result = await run(binary, ['serve', `--https=${String(port)}`, 'off'], config.timeoutMs)
  return result.ok
}

/**
 * Read the Serve config once and report whether `port` really proxies us.
 * @param {object} options - Dependencies and inputs.
 * @param {string} options.binary - `tailscale` executable.
 * @param {{timeoutMs: number}} options.config - Normalized config.
 * @param {number} options.port - Port to inspect.
 * @param {string} options.target - Our loopback target.
 * @param {string} options.dnsName - Current MagicDNS name.
 * @returns {Promise<boolean>} Whether the port is served by this instance.
 */
export async function readExposes({ binary, config, port, target, dnsName }) {
  const status = await readServeStatus(binary, config.timeoutMs)
  return serveExposes(status, port, target, dnsName)
}
