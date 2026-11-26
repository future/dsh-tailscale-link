/**
 * dsh-tailnet-link — publish the DSH Web GUI on the tailnet and leave the
 * ready-to-open login URL in a local file.
 *
 * Everything here rides documented seams:
 *  - `tailscale serve` CLI for the route,
 *  - `connection.trustedHosts` for the `/api` fence,
 *  - `webserver/entry-url` for the official `?token=` login entry.
 *
 * It never forges session cookies, never patches `ws` or `clientModules`, and
 * never edits the Web bundle's rows.
 */

import { normalizeConfig } from './src/config.js'
import { backendStateOf, classifyServe, dnsNameOf, readStatus, resolveBinary } from './src/tailscale.js'
import { ensureServe, readExposes, releaseServe, servePlan, serveExposes } from './src/serve.js'
import { addTrustedHost, removeTrustedHost } from './src/trust.js'
import { localTargetOf, primaryUrlOf, tokenEntryUrl, tokenEntryUrlWithRetry } from './src/url.js'
import { writeStateFiles } from './src/state.js'
import { registerStateRoute } from './src/api.js'
import { qrSvg } from './src/qr.js'

/** Stable plugin name. */
export const name = 'dsh-tailscale-link'

/** Host services this row needs before it activates. */
export const inject = ['webServer', 'webApp', 'connection']

/**
 * Start the publish attempt and register its teardown.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {unknown} config - The row's `config`.
 * @returns {void}
 */
export function apply(ctx, config) {
  const normalized = normalizeConfig(config)
  if (!normalized.enabled) return
  const log = ctx.logger ?? console
  const undo = { trustedHosts: [], createdPorts: [], binary: undefined, disposed: false }
  /** Latest record the settings row reads through the owner-only JSON route. */
  const box = { current: null, refresh: null }
  box.api = registerStateRoute(
    ctx,
    () => box.current,
    async () => (box.refresh === null ? null : await box.refresh()),
  )
  void setup(ctx, normalized, undo, log, (value) => { box.current = value }, box)
  ctx.effect(() => () => {
    undo.disposed = true
    void teardown(ctx, normalized, undo, log)
  }, 'dsh-tailnet-link: teardown')
}

/**
 * Resolve the node, publish the route, allow the authority, and write the files.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {ReturnType<typeof normalizeConfig>} config - Normalized config.
 * @param {{trustedHosts: string[], createdPorts: number[], binary: string|undefined, disposed: boolean}} undo - Rollback record.
 * @param {{info: Function, warn: Function}} log - Logger.
 * @returns {Promise<void>}
 */
async function setup(ctx, config, undo, log, publish, box) {
  try {
    const binary = await resolveBinary(config)
    if (binary === undefined) {
      publish({ ok: false, error: 'tailscale-missing' })
      log.warn('tailscale-link: 找不到 tailscale 可執行檔，跳過')
      return
    }
    undo.binary = binary

    const status = await readStatus(binary, config.timeoutMs)
    const backend = backendStateOf(status)
    if (backend !== 'Running') {
      publish({ ok: false, error: 'tailscale-down', detail: backend ?? 'unknown' })
      log.warn(`tailscale-link: tailscale 未在 Running（${backend ?? 'unknown'}），跳過`)
      return
    }
    const dnsName = dnsNameOf(status)
    if (dnsName === undefined) {
      publish({ ok: false, error: 'no-dns-name' })
      log.warn('tailscale-link: 讀不到 tailnet DNS 名稱，跳過')
      return
    }

    const authority = `${dnsName}:${String(config.httpsPort)}`
    const target = localTargetOf(ctx.webServer)
    if (config.manageServe) {
      // 443 is only touched when the short URL is explicitly wanted; announcing a
      // port-less URL without serving it is the bug this guard exists to prevent.
      const ports = [config.httpsPort]
      if (config.serveBareHostPort && !ports.includes(443)) ports.push(443)
      for (const port of ports) {
        const route = await ensureServe({ binary, config, target, port, dnsName })
        if (route.kind === 'conflict') {
          log.warn(`dsh-tailscale-link: ${String(port)} 埠有別人的 Serve 路由（${route.reason ?? '未知原因'}），不覆蓋`)
          if (port === config.httpsPort) return
          continue
        }
        if (route.created) undo.createdPorts.push(port)
        if (route.kind === 'renamed') log.info(`dsh-tailscale-link: 節點名稱已變更，改用 ${String(port)} 的現名重掛 Serve 路由`)
      }
    }

    const addedHosts = []
    if (config.trustAuthority) {
      if (addTrustedHost(ctx, authority)) addedHosts.push(authority)
      // A bare entry matches any port; it is only useful once 443 serves this host.
      if (config.alsoBareHost && addTrustedHost(ctx, dnsName)) addedHosts.push(dnsName)
      undo.trustedHosts = addedHosts
    }

    const baseUrl = `https://${authority}/`
    const bareUrl = config.alsoBareHost ? `https://${dnsName}/` : null

    /**
     * Recompute the token URLs from the current authorities and rewrite both files.
     * Also the on-demand path: a plugin that activates before the token provider
     * listens can still republish the URL the first time the settings row asks.
     */
    const build = async () => {
      // Announce the port-less URL only when 443 really proxies this instance.
      const bareExposed = bareUrl !== null
        && await readExposes({ binary, config, port: 443, target, dnsName })
      const loginUrl = await tokenEntryUrlWithRetry(ctx, baseUrl)
      const bareLoginUrl = bareExposed ? await tokenEntryUrlWithRetry(ctx, bareUrl) : undefined
      if (bareUrl !== null && !bareExposed) {
        log.warn('dsh-tailscale-link: 443 沒有指向本機，不公告免 port 網址（要的話把 serveBareHostPort 設為 true）')
      }
      const record = {
        url: baseUrl,
        loginUrl: loginUrl ?? baseUrl,
        primaryUrl: primaryUrlOf({ baseUrl, loginUrl, bareExposed, bareLoginUrl }),
        authority,
        httpsPort: config.httpsPort,
        target,
        tokenAvailable: loginUrl !== undefined,
        bareUrl,
        bareLoginUrl: bareLoginUrl ?? null,
        bareExposed,
        serve: config.manageServe ? 'managed' : 'external',
        apiRoute: box.api ?? { registered: false, reason: 'not-attempted' },
        updatedAt: new Date().toISOString(),
      }
      await writeStateFiles(config, record)
      let qr = null
      try {
        qr = qrSvg(record.primaryUrl)
      } catch (error) {
        log.warn(`tailscale-link: QR 產生失敗：${String(error?.message ?? error)}`)
      }
      publish({ ...record, ok: true, qrSvg: qr })
      return record
    }
    box.refresh = build
    if (undo.disposed) return

    const record = await build()
    if (record.tokenAvailable) {
      log.info(`tailscale-link: 已寫入 ${config.statePath} 與 ${config.textPath}`)
    } else {
      log.warn('tailscale-link: 這次拿不到 token 入口；設定列或下一次請求會自動重試')
    }
  } catch (error) {
    publish({ ok: false, error: 'setup-failed', detail: String(error?.message ?? error) })
    log.warn(`tailscale-link: 設定失敗：${String(error?.message ?? error)}`)
  }
}

/**
 * Undo what this plugin created. Idempotent and never throws.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {ReturnType<typeof normalizeConfig>} config - Normalized config.
 * @param {{trustedHosts: string[], createdPorts: number[], binary: string|undefined, disposed: boolean}} undo - Rollback record.
 * @param {{info: Function, warn: Function}} log - Logger.
 * @returns {Promise<void>}
 */
async function teardown(ctx, config, undo, log) {
  try {
    while (undo.trustedHosts.length > 0) {
      const authority = undo.trustedHosts.pop()
      if (authority !== undefined) removeTrustedHost(ctx, authority)
    }
  } catch {
    /* 拆除期間 context 可能已失效 */
  }
  while (undo.createdPorts.length > 0) {
    const port = undo.createdPorts.pop()
    if (port === undefined) continue
    try {
      const released = await releaseServe({ binary: undo.binary, config, port })
      if (!released) log.warn(`dsh-tailscale-link: 撤銷 ${String(port)} 的 Serve 路由失敗`)
    } catch {
      /* 關停期間不再拋錯 */
    }
  }
}

/** Pure helpers re-exported for tests. */
export const internals = {
  normalizeConfig,
  classifyServe,
  servePlan,
  serveExposes,
  dnsNameOf,
  backendStateOf,
  localTargetOf,
  tokenEntryUrl,
  tokenEntryUrlWithRetry,
  primaryUrlOf,
  writeStateFiles,
}
