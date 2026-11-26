/**
 * Config normalization.
 *
 * The row may carry no `config` at all, so every field is optional and every
 * default is applied here; a missing `Config` export keeps this plugin free of
 * extra package dependencies.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Defaults, mirrored by `cordis.patch.yml`. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  httpsPort: 7259,
  manageServe: true,
  trustAuthority: true,
  alsoBareHost: false,
  serveBareHostPort: false,
  binaryPath: null,
  statePath: null,
  textPath: null,
  timeoutMs: 8000,
})

/**
 * Resolve the DSH home directory the same way the rest of DSH does.
 * @returns {string} `$DSH_HOME` when set and non-blank, otherwise `~/.dsh`.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : join(homedir(), '.dsh')
}

/**
 * @param {unknown} raw - The row's `config` object, possibly `null`.
 * @returns {{enabled: boolean, httpsPort: number, manageServe: boolean, trustAuthority: boolean,
 *   alsoBareHost: boolean, serveBareHostPort: boolean,
 *   binaryPath: string|null, statePath: string, textPath: string, timeoutMs: number}} Normalized config.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const merged = { ...DEFAULTS, ...source }
  const port = Number(merged.httpsPort)
  const timeout = Number(merged.timeoutMs)
  const home = dshHome()
  return {
    enabled: merged.enabled !== false,
    httpsPort: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.httpsPort,
    manageServe: merged.manageServe !== false,
    trustAuthority: merged.trustAuthority !== false,
    alsoBareHost: merged.alsoBareHost === true,
    serveBareHostPort: merged.serveBareHostPort === true,
    binaryPath: nonBlank(merged.binaryPath),
    statePath: nonBlank(merged.statePath) ?? join(home, 'tailnet-url.json'),
    textPath: nonBlank(merged.textPath) ?? join(home, 'tailnet-url.txt'),
    timeoutMs: Number.isFinite(timeout) && timeout >= 500 ? Math.floor(timeout) : DEFAULTS.timeoutMs,
  }
}

/** @param {unknown} value @returns {string|null} Trimmed non-empty string or null. */
function nonBlank(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
