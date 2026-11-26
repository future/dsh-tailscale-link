# Tailnet login link

Publishes this Host on the tailnet and leaves the URL that actually signs a new
browser in — token included — in two owner-only files.

## What it does

On activation, in this order:

1. Reads the node identity: `tailscale status --json` → `Self.DNSName`, and
   requires `BackendState: Running`.
2. Publishes the loopback target (`webServer.getOrigin()`) on
   `httpsPort` with `tailscale serve --bg --https=<port> <target>`. An existing
   route that already proxies this instance is reused untouched; a route that
   proxies another loopback port is replaced; a foreign handler is never
   overwritten.
3. Adds `<dnsName>:<httpsPort>` to the live `connection.trustedHosts` array, so
   the `/api` fence admits that authority. With `alsoBareHost` it also adds the
   bare `<dnsName>`, whose entry matches every port and therefore makes the
   port-less URL usable.
4. Asks the `webserver/entry-url` contributors for the login entry of
   `https://<authority>/` (and of `https://<dnsName>/` when `alsoBareHost`) and
   takes each published `?token=` URL.
5. Writes both files `0600`:

```json
{
  "url": "https://host.tailnet.ts.net:7259/",
  "loginUrl": "https://host.tailnet.ts.net:7259/?token=…",
  "authority": "host.tailnet.ts.net:7259",
  "httpsPort": 7259,
  "target": "http://127.0.0.1:3080",
  "tokenAvailable": true,
  "bareUrl": "https://host.tailnet.ts.net/",
  "bareLoginUrl": "https://host.tailnet.ts.net/?token=…",
  "primaryUrl": "https://host.tailnet.ts.net/?token=…",
  "serve": "managed",
  "updatedAt": "2026-11-26T12:00:00.000Z"
}
```

`~/.dsh/tailnet-url.txt` holds only `primaryUrl` — the port-less login URL when
`alsoBareHost` produced one, otherwise `loginUrl`.

## Settings row and state route

The Client half registers one row in `settings.general.item` (`id`:
`dsh-tailscale-link`, order 96). It renders its own label, the current URL, a
**Copy** action through `navigator.clipboard`, and an opt-in **Show QR** action;
nothing is shown until the row is expanded, because the QR encodes a credential.

The row reads `GET /api/dsh-tailscale-link/state`, registered with
`connection.fetch.register` (an exact route on the shared `/api` channel).
That channel already applies this Host's origin fence and cookie
authentication, and only owner Peers reach an exact Fetch route; registering an
exact `/api/...` route on `webServer` would instead shadow the whole `/api`
prefix. The response is `{ status, ok, url, loginUrl, primaryUrl, bareUrl,
bareLoginUrl, updatedAt, qrSvg }`, with `cache-control: no-store`.

`qrSvg` is produced host-side from `qrcode-generator` (byte mode, ECC level M)
as one SVG path per dark module with an explicit white background and a
four-module quiet zone. Verified by round trip: rasterizing the matrix and
decoding it with `jsQR` returns the identical URL.

## Advertised URL invariant

Every published URL must correspond to a route this instance serves. `build()`
reads the Serve config and asks `serveExposes(status, 443, target, dnsName)`
before it will put the port-less URL in `primaryUrl`; when 443 is not ours it
writes the `:httpsPort` URL instead and logs why. `primaryUrlOf()` encodes the
same rule for unit tests, so "announce what you serve" cannot regress silently.

Serve keys are normalised through `authorityPort()`: `tailscale serve` records
the default HTTPS port either as `host` or `host:443`, and comparing raw
`URL.port` values made every 443 entry look absent. When several keys share one
port (a renamed node, or another tool), `classifyServe(…, expectedAuthority)`
prefers the key this run would publish instead of the first one in the map.

## Renamed node

A Serve key is `<magic dns name>:<port>` at registration time. If the node is
renamed, the old key still proxies this instance, so a naive reader would call
it "already published" and leave a route whose certificate can no longer be
issued. This plugin compares the occupying authority with the current
`<dnsName>:<httpsPort>` and re-registers when they differ (logged as
`節點名稱已變更…`); the old key is left alone and only the new key is withdrawn
on exit. The files are rewritten from `tailscale status --json` on every
activation, so a rename shows up in `url`/`loginUrl` after the next start or
recomposition.

On unload it removes the trusted host it added and withdraws the Serve route
only when this plugin created it.

## Config

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Row switch. |
| `httpsPort` | `7259` | HTTPS port the Serve route publishes; also the port in the authority. |
| `manageServe` | `true` | Publish the Serve route. `false` when another tool owns it. |
| `trustAuthority` | `true` | Add the authority to `connection.trustedHosts`. |
| `alsoBareHost` | `false` | Also trust the bare `<dnsName>` and publish the port-less login URL — but only when 443 actually proxies this instance. |
| `serveBareHostPort` | `false` | Publish (and withdraw) a 443 route for this instance, so the port-less URL is available. Refuses to overwrite a foreign handler. |
| `binaryPath` | `null` | Explicit `tailscale` executable; otherwise `PATH`. |
| `statePath` | `~/.dsh/tailnet-url.json` | JSON record. |
| `textPath` | `~/.dsh/tailnet-url.txt` | Single-line URL. |
| `timeoutMs` | `8000` | Per-command timeout. |

## How it stays compatible

- The route goes through the `tailscale` CLI, not Tailscale's state files.
- The login URL comes from DSH's own token provider via `webserver/entry-url`
  (the same call `@deepseek-ai/dsh-client-remote-connection` makes), so the
  browser receives DSH's normal session cookie. No cookie is forged here.
- Nothing patches `ws`, `clientModules`, or the Web bundle's rows.

## Limits

- The token is process-scoped: the files are rewritten on every Host start, so
  a URL copied from an older process stops working. The session cookie it mints
  stays valid for the provider's configured lifetime (30 days by default), so a
  device signs in once and keeps working across restarts until then.
- Cookies are named per authority: signing in on `host:7259` does not sign you
  in on `host` (port 443). Pick one as the entry point; the text file already
  prefers the port-less one when `alsoBareHost` is on.
- The port-less URL only works while a Serve route exists on 443 (default HTTPS
  port). If that route is withdrawn, the bare URL dies with it while the
  `:httpsPort` URL keeps working.
- No lite page, no notification bell, no key rotation UI. Those are separate
  features; this plugin only publishes and reports the URL.
- If another plugin also drives `tailscale serve` for the same port or pushes
  the same trusted host, run one of them, not both.
- Withdrawing is per port, not per key: `tailscale serve --https=<port> off`
  closes that port for the whole node. The plugin only calls it for ports it
  created in this run, but a foreign route on the same port would go with it.
- Stale keys from a previous node name are left in place (there is no supported
  single-key removal); they keep the old hostname's port bound without a usable
  certificate.
