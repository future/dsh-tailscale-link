/**
 * State files.
 *
 * The login URL bypasses authentication, so both files are written owner-only
 * (`0600`) and the JSON carries no extra diagnostics beyond what the plugin
 * itself decided.
 */

import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Write the JSON record and the one-line text file.
 * @param {{statePath: string, textPath: string}} paths - Absolute file paths.
 * @param {{url: string, loginUrl: string, primaryUrl?: string, authority: string, httpsPort: number,
 *   target: string, tokenAvailable: boolean, serve: string, updatedAt: string}} record - State payload.
 * @returns {Promise<void>} After both files exist with restrictive modes.
 */
export async function writeStateFiles(paths, record) {
  const primary = typeof record.primaryUrl === 'string' && record.primaryUrl !== '' ? record.primaryUrl : record.loginUrl
  await mkdir(dirname(paths.statePath), { recursive: true, mode: 0o700 })
  await mkdir(dirname(paths.textPath), { recursive: true, mode: 0o700 })
  await writeFile(paths.statePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await writeFile(paths.textPath, `${primary}\n`, { encoding: 'utf8', mode: 0o600 })
  // `mode` only applies on creation; tighten files a previous run left looser.
  await chmod(paths.statePath, 0o600)
  await chmod(paths.textPath, 0o600)
}
