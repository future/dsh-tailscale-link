# Changelog

## 0.3.0 — 2026-11-26

Fixed the 0.2.4 defect where a clean install advertised a port-less URL while
only the `httpsPort` route existed.

- Announce the port-less URL only when 443 really proxies this instance
  (`serveExposes`); otherwise the settings row, `~/.dsh/tailnet-url.txt` and the
  QR fall back to the `:httpsPort` URL.
- New `serveBareHostPort` (default `false`): let the plugin publish and withdraw
  the 443 route itself, refusing to overwrite a foreign handler.
- `authorityPort()` normalises Serve keys, so a `host` key (default HTTPS port
  recorded without `:443`) matches port 443.
- `classifyServe()` prefers the expected authority when several keys publish the
  same port, instead of whichever key happens to come first.
- Withdraw only the ports this run created; document that
  `tailscale serve --https=<port> off` closes the whole port.
- Name/README cleanup: `export const name` and the settings-row title match the
  published package.

## 0.2.4 — 2026-11-26

- Client factory `id` now equals the package name (a mismatch dropped the module
  from the client graph).
- The settings row is wrapped in an error boundary, so a render failure shows a
  red line instead of an empty section.

## 0.2.2 — 2026-11-26

- Retry the `webserver/entry-url` lookup during activation and repair a
  token-less record lazily when the settings row asks, so a race no longer
  writes a URL without a token.

## 0.2.0 — 2026-11-26

- Settings row: current URL, Copy, and an opt-in QR generated host-side.
- Owner-only `GET /api/dsh-tailscale-link/state` on the shared `/api` channel.

## 0.1.0 — 2026-11-26

- First release: Serve route, `connection.trustedHosts`, official token login URL
  written to `~/.dsh/tailnet-url.json` and `.txt` (both `0600`).
