/**
 * Offline smoke test: pure helpers only, no Host services.
 * Run with `node test/smoke.mjs`.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { internals } from '../index.js'
import { qrSvg } from '../src/qr.js'
import { authorityPort, classifyServe as classify2 } from '../src/tailscale.js'
import { serveExposes, expectedAuthorities } from '../src/serve.js'
import { primaryUrlOf } from '../src/url.js'
import { registerStateRoute, STATE_PATH } from '../src/api.js'

const { classifyServe, servePlan, dnsNameOf, backendStateOf, localTargetOf, normalizeConfig, writeStateFiles } = internals

// --- config -----------------------------------------------------------------
const defaults = normalizeConfig(undefined)
assert.equal(defaults.httpsPort, 7259)
assert.equal(defaults.manageServe, true)
assert.ok(defaults.statePath.endsWith('tailnet-url.json'))
assert.ok(defaults.textPath.endsWith('tailnet-url.txt'))

const coerced = normalizeConfig({ httpsPort: '8443', manageServe: false, timeoutMs: 100, enabled: false })
assert.equal(coerced.httpsPort, 8443)
assert.equal(coerced.manageServe, false)
assert.equal(coerced.timeoutMs, 8000, 'timeout below the floor falls back to the default')
assert.equal(coerced.enabled, false)

const badPort = normalizeConfig({ httpsPort: 70000 })
assert.equal(badPort.httpsPort, 7259)

// --- node identity ----------------------------------------------------------
assert.equal(dnsNameOf({ Self: { DNSName: 'pi5.taila85f8f.ts.net.' } }), 'pi5.taila85f8f.ts.net')
assert.equal(dnsNameOf({}), undefined)
assert.equal(backendStateOf({ BackendState: 'Running' }), 'Running')
assert.equal(backendStateOf(undefined), undefined)

// --- serve classification ---------------------------------------------------
const target = 'http://127.0.0.1:3080'
assert.equal(classifyServe(undefined, 7259, target).kind, 'absent')
assert.equal(classifyServe({}, 7259, target).kind, 'absent')

const exact = {
  Web: { 'pi5.taila85f8f.ts.net:7259': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } } },
}
assert.deepEqual(classifyServe(exact, 7259, target), { kind: 'exact', authority: 'pi5.taila85f8f.ts.net:7259' })

const stale = {
  Web: { 'old.taila85f8f.ts.net:7259': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999/' } } } },
}
assert.equal(classifyServe(stale, 7259, target).kind, 'stale')

const otherLoopbackPort = {
  Web: { 'node.ts.net:7259': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } } },
}
assert.equal(classifyServe(otherLoopbackPort, 7259, 'http://127.0.0.1:4000').kind, 'stale',
  'a loopback proxy to another port is replaceable')

const foreign = {
  Web: { 'node.ts.net:7259': { Handlers: { '/': { Proxy: 'https://example.com:8443' } } } },
}
assert.equal(classifyServe(foreign, 7259, target).kind, 'conflict')

const otherPaths = {
  Web: { 'node.ts.net:7259': { Handlers: { '/app': { Proxy: 'http://127.0.0.1:3080' } } } },
}
assert.equal(classifyServe(otherPaths, 7259, target).kind, 'conflict')

const otherPort = {
  Web: { 'node.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8888' } } } },
}
assert.equal(classifyServe(otherPort, 7259, target).kind, 'absent', 'another port is not our port')

// --- listener target --------------------------------------------------------
assert.equal(localTargetOf({ getOrigin: () => 'http://127.0.0.1:3080' }), 'http://127.0.0.1:3080')
assert.equal(localTargetOf({ getOrigin: () => 'http://0.0.0.0:3080' }), 'http://127.0.0.1:3080')
assert.equal(localTargetOf({ getOrigin: () => 'http://[::1]:3080' }), 'http://[::1]:3080')

// --- state files ------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'tailnet-link-'))
const statePath = join(dir, 'nested', 'url.json')
const textPath = join(dir, 'nested', 'url.txt')
const record = {
  url: 'https://node.ts.net:7259/',
  loginUrl: 'https://node.ts.net:7259/?token=abc',
  authority: 'node.ts.net:7259',
  httpsPort: 7259,
  target,
  tokenAvailable: true,
  serve: 'managed',
  updatedAt: new Date().toISOString(),
}
await writeStateFiles({ statePath, textPath }, record)

const json = JSON.parse(await readFile(statePath, 'utf8'))
assert.equal(json.loginUrl, record.loginUrl)
assert.equal((await readFile(textPath, 'utf8')).trim(), record.loginUrl)
for (const file of [statePath, textPath]) {
  const mode = (await stat(file)).mode & 0o777
  assert.equal(mode, 0o600, `${file} must be 0600, got ${mode.toString(8)}`)
}

// --- serve plan (rename handling) -------------------------------------------
assert.equal(servePlan({ kind: 'exact', authority: 'pi5.ts.net:7259' }, 'pi5.ts.net:7259'), 'reuse')
assert.equal(servePlan({ kind: 'exact', authority: 'old-name.ts.net:7259' }, 'pi5.ts.net:7259'), 'register',
  'a route that proxies us under an old hostname must be re-registered')
assert.equal(servePlan({ kind: 'stale', authority: 'x' }, 'pi5.ts.net:7259'), 'register')
assert.equal(servePlan({ kind: 'absent' }, 'pi5.ts.net:7259'), 'register')
assert.equal(servePlan({ kind: 'conflict', reason: 'busy' }, 'pi5.ts.net:7259'), 'conflict')

// --- port-less primary URL --------------------------------------------------
const alt = { statePath: join(dir, 'alt.json'), textPath: join(dir, 'alt.txt') }
await writeStateFiles(alt, { ...record, primaryUrl: 'https://node.ts.net/?token=def' })
assert.equal((await readFile(alt.textPath, 'utf8')).trim(), 'https://node.ts.net/?token=def',
  'the text file follows primaryUrl when the port-less URL is available')

// --- QR ---------------------------------------------------------------------
for (const text of [
  'https://pi5.example.ts.net/?token=abc',
  'https://node.tailnet.ts.net:7259/?token=' + 'x'.repeat(120),
]) {
  const svg = qrSvg(text)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /viewBox="0 0 \d+ \d+"/)
  assert.match(svg, /fill="#ffffff"/, 'white quiet zone is what scanners need')
  assert.match(svg, /<path d="M/, 'dark modules render as one path')
  assert.ok(!svg.includes('undefined'))
}
const small = qrSvg('https://a.ts.net/')
const big = qrSvg('https://a.ts.net/?token=' + 'y'.repeat(300))
assert.ok(big.length > small.length, 'more content means more modules')

// --- state route ------------------------------------------------------------
const captured = []
const fakeCtx = {
  get: (name) => (name === 'connection'
    ? { fetch: { register: (route) => { captured.push(route); return async () => {} } } }
    : undefined),
  effect: (fn) => { fn() },
  logger: { warn: () => {} },
}
registerStateRoute(fakeCtx, () => ({ ok: true, primaryUrl: 'https://a.ts.net/?token=abc' }))
assert.equal(captured.length, 1)
assert.equal(captured[0].path, STATE_PATH)
assert.deepEqual(captured[0].methods, ['GET'])
const response = await captured[0].fetch(new Request('http://127.0.0.1:3080' + STATE_PATH))
assert.equal(response.status, 200)
assert.match(response.headers.get('content-type'), /application\/json/)
const payload = await response.json()
assert.equal(payload.status, 'ready')
assert.equal(payload.ok, true)
assert.equal(payload.primaryUrl, 'https://a.ts.net/?token=abc')

const emptyCaptured = []
registerStateRoute({ ...fakeCtx, get: () => ({ fetch: { register: (route) => { emptyCaptured.push(route); return async () => {} } } }) }, () => null)
const emptyPayload = await (await emptyCaptured[0].fetch(new Request('http://127.0.0.1:3080' + STATE_PATH))).json()
assert.equal(emptyPayload.status, 'starting')

// --- lazy token repair ------------------------------------------------------
let refreshCalls = 0
const repairRoutes = []
registerStateRoute(
  { ...fakeCtx, get: () => ({ fetch: { register: (route) => { repairRoutes.push(route); return async () => {} } } }) },
  () => ({ ok: true, tokenAvailable: false, primaryUrl: 'https://a.ts.net/' }),
  async () => {
    refreshCalls += 1
    return { ok: true, tokenAvailable: true, primaryUrl: 'https://a.ts.net/?token=fixed' }
  },
)
const repaired = await (await repairRoutes[0].fetch(new Request('http://127.0.0.1:3080' + STATE_PATH))).json()
assert.equal(refreshCalls, 1, 'a token-less record triggers exactly one refresh')
assert.equal(repaired.tokenAvailable, true)
assert.match(repaired.primaryUrl, /token=fixed$/)

const freshRoutes = []
let secondRefresh = 0
registerStateRoute(
  { ...fakeCtx, get: () => ({ fetch: { register: (route) => { freshRoutes.push(route); return async () => {} } } }) },
  () => ({ ok: true, tokenAvailable: true, primaryUrl: 'https://a.ts.net/?token=ok' }),
  async () => { secondRefresh += 1; return null },
)
await (await freshRoutes[0].fetch(new Request('http://127.0.0.1:3080' + STATE_PATH))).json()
assert.equal(secondRefresh, 0, 'a healthy record is served without recomputing')

// --- client factory id ------------------------------------------------------
{
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const declared = /id:\s*'([^']+)'/.exec(client)?.[1]
  assert.equal(declared, pkg.name,
    'the client factory id must equal the package name; a mismatch drops the module from the client graph')
}

// --- 443 keys recorded without an explicit port -----------------------------
assert.equal(authorityPort('node.ts.net'), 443, 'a bare key means the default HTTPS port')
assert.equal(authorityPort('node.ts.net:443'), 443)
assert.equal(authorityPort('node.ts.net:7259'), 7259)
assert.deepEqual(expectedAuthorities(443, 'node.ts.net'), ['node.ts.net:443', 'node.ts.net'])
assert.deepEqual(expectedAuthorities(7259, 'node.ts.net'), ['node.ts.net:7259'])

const bareKeyServe = { Web: { 'node.ts.net': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } } } }
assert.equal(classify2(bareKeyServe, 443, target, 'node.ts.net').kind, 'exact',
  'a key without :443 must still match port 443')
assert.equal(serveExposes(bareKeyServe, 443, target, 'node.ts.net'), true)
assert.equal(serveExposes(bareKeyServe, 443, 'http://127.0.0.1:9999', 'node.ts.net'), false)
assert.equal(serveExposes({ Web: {} }, 443, target, 'node.ts.net'), false)
assert.equal(serveExposes(undefined, 443, target, 'node.ts.net'), false)

// --- several keys on one port: prefer the expected authority ---------------
const twoKeysSamePort = {
  Web: {
    'old-name.ts.net:7259': { Handlers: { '/app': { Proxy: 'http://127.0.0.1:1109' } } },
    'node.ts.net:7259': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } },
  },
}
assert.equal(classify2(twoKeysSamePort, 7259, target, 'node.ts.net:7259').kind, 'exact',
  'a stale key on the same port must not hide our own route')
assert.equal(classify2(twoKeysSamePort, 7259, target).authority, 'old-name.ts.net:7259',
  'without an expectation the first key still wins (documented behaviour)')

// --- advertised URL must match a served port --------------------------------
assert.equal(
  primaryUrlOf({ baseUrl: 'https://n.ts.net:7259/', loginUrl: 'https://n.ts.net:7259/?token=a', bareExposed: false, bareLoginUrl: 'https://n.ts.net/?token=a' }),
  'https://n.ts.net:7259/?token=a',
  'an unexposed 443 must never become the advertised URL')
assert.equal(
  primaryUrlOf({ baseUrl: 'https://n.ts.net:7259/', loginUrl: 'https://n.ts.net:7259/?token=a', bareExposed: true, bareLoginUrl: 'https://n.ts.net/?token=b' }),
  'https://n.ts.net/?token=b')
assert.equal(
  primaryUrlOf({ baseUrl: 'https://n.ts.net:7259/', loginUrl: undefined, bareExposed: true, bareLoginUrl: undefined }),
  'https://n.ts.net:7259/')

console.log('smoke: ok')
