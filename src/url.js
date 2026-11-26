/**
 * URL derivation.
 *
 * Two pieces: the loopback target this instance actually listens on, and the
 * official token login URL that DSH publishes through `webserver/entry-url`.
 * The token provider builds that URL from whatever base we pass in, so the
 * tailnet authority gets a link this host can serve — no cookie forging and no
 * private field access.
 */

/**
 * Read the listener target this instance serves, as a loopback URL.
 * @param {{getOrigin: () => string}} webServer - Host web server service.
 * @returns {string} Target such as `http://127.0.0.1:3080`.
 */
export function localTargetOf(webServer) {
  const origin = new URL(webServer.getOrigin())
  const port = origin.port !== '' ? origin.port : (origin.protocol === 'https:' ? '443' : '80')
  const host = origin.hostname === '0.0.0.0' || origin.hostname === '::' ? '127.0.0.1' : origin.hostname
  const formatted = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${formatted}:${port}`
}

/**
 * Retry {@link tokenEntryUrl} a few times.
 *
 * The token provider answers through an event listener, so a plugin that
 * activates very early can ask before anyone is listening; a short retry keeps
 * the first write from storing a token-less URL.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context with `webServer`.
 * @param {string} baseUrl - Absolute base URL, ending in `/`.
 * @param {{attempts?: number, delayMs?: number}} [options] - Retry budget.
 * @returns {Promise<string|undefined>} The published token login URL, when any attempt found one.
 */
export async function tokenEntryUrlWithRetry(ctx, baseUrl, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 3
  const delayMs = Number.isInteger(options.delayMs) && options.delayMs >= 0 ? options.delayMs : 400
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url = tokenEntryUrl(ctx, baseUrl)
    if (url !== undefined) return url
    if (attempt < attempts - 1) await new Promise((resolve) => { setTimeout(resolve, delayMs) })
  }
  return undefined
}

/**
 * Ask every `webserver/entry-url` contributor for the login entry of one base URL.
 *
 * The token provider answers with `<base>/?token=<launch token>`; other
 * contributors (for example a pairing UI) may answer with unrelated entries,
 * so the single-entry filter below is what identifies the token login.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context with `webServer`.
 * @param {string} baseUrl - Absolute base URL, ending in `/`.
 * @returns {string|undefined} The published token login URL.
 */
export function tokenEntryUrl(ctx, baseUrl) {
  const webServer = ctx.get('webServer', false)
  if (webServer === undefined) return undefined
  const entries = []
  try {
    ctx.emit(webServer, 'webserver/entry-url', baseUrl, entries)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || typeof entry.url !== 'string') continue
    try {
      const url = new URL(entry.url)
      if (url.searchParams.getAll('token').length === 1 && url.searchParams.get('token') !== null) return entry.url
    } catch {
      /* 壞條目直接跳過 */
    }
  }
  return undefined
}

/**
 * Choose the URL to advertise, and never advertise a port that is not served.
 * @param {{baseUrl: string, loginUrl: string|undefined, bareExposed: boolean, bareLoginUrl: string|undefined}} input - Candidates.
 * @returns {string} The primary URL.
 */
export function primaryUrlOf(input) {
  if (input.bareExposed && input.bareLoginUrl !== undefined) return input.bareLoginUrl
  return input.loginUrl ?? input.baseUrl
}
