# @sparkfuture/dsh-tailscale-link

Publishes the DSH Web GUI on your tailnet and writes the URL that actually signs
a browser in — token included — to two owner-only files:

```sh
cat ~/.dsh/tailnet-url.txt      # one line: https://<node>.<tailnet>.ts.net:7259/?token=…
jq -r .loginUrl ~/.dsh/tailnet-url.json
```

The text file prefers the port-less URL (`https://<node>.<tailnet>.ts.net/?token=…`)
when the port-less host is trusted; the JSON keeps both forms (`loginUrl` and
`bareLoginUrl`).

Open that URL on the phone once. The Host mints its normal 30-day session
cookie, so the token only matters for the first sign-in of a device (or after
the cookie expires).

## Ports and the short URL

The plugin publishes one route on `httpsPort` (default 7259) and advertises that
URL. The port-less form — `https://<node>.<tailnet>.ts.net/?token=…`, which uses
443 — is advertised **only when 443 really proxies this instance**; otherwise the
settings row, `~/.dsh/tailnet-url.txt` and the QR fall back to the `:7259` URL.

Two ways to get the short URL:

- create the 443 route yourself (`tailscale serve --bg <dsh port>`), or
- set `serveBareHostPort: true` and let the plugin publish and withdraw 443 for
  you (it refuses to overwrite somebody else's handler there).

Clean installs therefore never see a link to a port nothing serves — that was
the 0.2.4 defect this release fixes.

## Settings row

**Settings → General** gains one row, *Tailscale 遠端網址 / Tailscale URL*: the
current login URL, a **Copy** button, and a **Show QR** button. The QR is
generated host-side and carries the same URL, so scanning it signs a phone in.

The row reads `GET /api/dsh-tailscale-link/state` — an owner-only exact route on
the shared `/api` channel. The token is process-scoped, so **Refresh** after a
restart; the device's 30-day cookie keeps working meanwhile.

## Install

`plugin_manager install_bundle` with this directory as the target, or
**Plugins → Add plugin** and pick the local directory. The row appears as
**Tailnet 登入網址 / Tailnet login link**.

Defaults in the shipped patch: publish on HTTPS port `7259`, manage the Serve
route, allow the authority through the `/api` fence, and also trust the bare
host name so the port-less URL works (`alsoBareHost: true`; it needs a Serve
route on 443). Edit the row's config to change the port,
point at a non-`PATH` `tailscale` binary, or hand the route over to another tool
(`manageServe: false`).

## What it changes on this machine

- `tailscale serve --bg --https=<port> http://127.0.0.1:<dsh port>` — one route,
  withdrawn on unload when this plugin created it.
- One or two entries in the live `connection.trustedHosts` array (`host:port`,
  plus the bare `host` for the port-less URL) — removed on unload.
- `~/.dsh/tailnet-url.json` and `~/.dsh/tailnet-url.txt`, both `0600`.

It never forges cookies and never patches third-party code.

## Verify

```sh
stat -c '%A %n' ~/.dsh/tailnet-url.json ~/.dsh/tailnet-url.txt   # -rw-------
URL=$(cat ~/.dsh/tailnet-url.txt)
curl -sS -D - -o /dev/null "$URL"        # HTTP 303 + set-cookie
curl -sS -o /dev/null -w '%{http_code}\n' "$URL" --cookie-jar /tmp/jar   # 303, cookie stored
```

## Not included

Lite page, notification bell, key rotation, QR pairing — this bundle only
publishes the route and reports the official login URL. See
[docs/DETAIL.md](docs/DETAIL.md) for the full behaviour, limits, and the
authority-scoped cookie caveat.
