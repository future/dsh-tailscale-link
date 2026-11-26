/**
 * `/api` fence cooperation.
 *
 * DSH accepts loopback, the listener's own bind addresses, and every authority
 * named by `connection.trustedHosts`. A tailnet authority is none of the first
 * two, so the route only works once its `host[:port]` is in that live array.
 */

/**
 * Read the live trusted-host list.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {boolean} [strict] - Whether a missing `connection` service is an error.
 * @returns {string[]|undefined} The mutable array, when available.
 */
export function trustedHostsOf(ctx, strict = false) {
  const connection = ctx.get('connection', strict)
  const trusted = connection?.trustedHosts
  return Array.isArray(trusted) ? trusted : undefined
}

/**
 * Add one authority when absent.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {string} authority - `host:port` as the browser sends it.
 * @returns {boolean} Whether this call added the entry.
 */
export function addTrustedHost(ctx, authority) {
  const trusted = trustedHostsOf(ctx, true)
  if (trusted === undefined) throw new Error('讀不到 connection.trustedHosts')
  if (trusted.includes(authority)) return false
  trusted.push(authority)
  return true
}

/**
 * Remove one authority when present.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {string} authority - `host:port`.
 * @returns {void}
 */
export function removeTrustedHost(ctx, authority) {
  const trusted = trustedHostsOf(ctx, false)
  if (trusted === undefined) return
  const index = trusted.indexOf(authority)
  if (index !== -1) trusted.splice(index, 1)
}
