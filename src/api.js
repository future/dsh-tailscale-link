/**
 * Owner-only state route for the browser row.
 *
 * Registered on `connection.fetch` rather than `webServer.register`: the shared
 * `/api` channel already applies this Host's origin fence and cookie
 * authentication, and an exact `/api/...` route on the web server would shadow
 * the whole `/api` prefix. Only owner Peers reach an exact Fetch route, and the
 * route owns the full `/api/...` pathname that callers must request.
 */

/** Absolute route path below `/api`. */
export const STATE_PATH = '/api/dsh-tailscale-link/state'

/**
 * Publish the current record as JSON.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {() => (Record<string, unknown>|null)} readState - Returns the latest written record, or null.
 * @param {() => Promise<Record<string, unknown>|null>} refreshState - Recomputes the record (token URLs included) and rewrites the files.
 * @returns {{registered: boolean, reason?: string}} Registration outcome, for diagnostics.
 */
export function registerStateRoute(ctx, readState, refreshState) {
  // `connection.fetch` binds the calling plugin as the route owner when read
  // through the context property, so prefer that over a bare service lookup.
  const connection = ctx.connection ?? ctx.get('connection', false)
  const routes = connection?.fetch
  if (routes === undefined || typeof routes.register !== 'function') {
    ctx.logger?.warn?.('dsh-tailscale-link: 沒有 connection.fetch，設定列無法讀取狀態')
    return { registered: false, reason: 'no-fetch-service' }
  }
  try {
    ctx.effect(() => {
      const dispose = routes.register({
        path: STATE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => {
          let state = readState()
          // A record without a token is the early-activation case; retry lazily
          // so opening the row repairs the file instead of showing a dead URL.
          if (refreshState !== undefined && (state === null || state.tokenAvailable !== true)) {
            try {
              const refreshed = await refreshState()
              if (refreshed !== null) state = refreshed
            } catch {
              /* 保持既有狀態，讓面板顯示目前內容 */
            }
          }
          const body = state === null
            ? JSON.stringify({ status: 'starting' })
            : JSON.stringify({ status: 'ready', ...state })
          return new Response(body, {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          })
        },
      })
      return () => {
        void dispose()
      }
    }, 'dsh-tailscale-link: state route')
  } catch (error) {
    const reason = String(error?.message ?? error)
    ctx.logger?.warn?.(`dsh-tailscale-link: 註冊 state 路由失敗：${reason}`)
    return { registered: false, reason }
  }
  return { registered: true }
}
