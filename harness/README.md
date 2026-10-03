# Local UI harness (`dev.html`)

Boots the **real** SPA against fake data, so the interface can be built and
reviewed without a real nsec, a real relay, or a reachable tunnel.

```bash
# from the repo root, inside the Nix environment
nix develop
go run ./cmd/dl_conn --dev-mock-auth
# then open http://127.0.0.1:9099/dev/
```

Without `--dev-mock-auth` the daemon answers **404** for `/dev/`, and it
also logs a warning on startup when the flag is on.

The harness lives in `harness/`, **outside** `web/`, and that placement is
the actual safety property — not the flag. With the files inside `web/`,
`proxy.RootFallback` served them to anyone, because `isSPAPath()` whitelists
only `/`, `/index.html`, `/app.js`, `/style.css` and `/_static/`, so
every *other* file present in the web dir falls through to the static handler.
An explicit 404 route does not fix that on its own: a binary built before the
route existed has no such route and serves the harness happily. Moving the
directory out of `web/` means there is nothing there to serve, so the
property holds for any binary — and keeps dev-only code out of
`build/web.tar.gz`, which is built from `web/`.

## What is faked

| Piece | Real thing | Harness |
|---|---|---|
| `SessionManager` | vault, PIN, WebAuthn, auto-lock | `hasVault` is true, any PIN unlocks, a placeholder identity is used. `lock()`, `wipe()` and `setBackendActive()` are the real ones. |
| `NostrClient` | WebSockets to relays, NIP-44 sign/decrypt, signature checks | answers a fixture discovery payload. No signature is verified and nothing is decrypted — there is no event to verify. |
| `/api/host/telemetry` | live poll + `?from=&to=` range | synthetic snapshots and a deterministic 7-day history |
| Daemon session | cookie-gated routes | **not faked** — every real route still needs a real cookie |

That last row is the important one. The harness fakes browser-local state only,
so it can show you a dashboard but cannot reach a real service, read a real
config, or authenticate against the daemon. The placeholder identity is
secp256k1 `k = 1` — the curve's generator point, a well-known "null" key that
cannot be confused with someone's real one. It is never persisted to storage.

## How it works

Three pieces, no build step, and **no production file is modified**:

- `index.html` — the same CSP as `web/index.html` and nothing inlined. The
  body is pulled from `/index.html` at runtime, so there is exactly one copy of
  the markup and the harness cannot drift from what it is testing. Its own
  `<script src="./app.js">` is stripped on injection: from `/dev/` it would
  resolve to `/dev/app.js`, and this module already imports `app.js` itself
  after the patches.
- `dev_boot.js` — installs the fetch fixture, fills the body, patches the two
  classes, imports `app.js`, then fills in the PIN and clicks Desbloquear.
- `mock_*.js` — the fixtures and the prototype patches.
- `harness.css` — the banner and the error box, kept out of `web/style.css`
  for the same reason the directory is out of `web/`.

The SPA fetches its config as `"./config.json"`, resolved against the
document, so from `/dev/` that lands on `/dev/config.json` — served from
`harness/config.json` by the same file server, not aliased to the real one.
That matters: `startNostr()` refuses to run until `state.config.hostNpub` is
set, so aliasing `web/config.json` would have made the harness depend on a
real npub merely to boot — precisely what it exists to avoid.

**No real nsec or npub is needed anywhere.** `harness/config.json` and
`mock_data.js` use the secp256k1 generator points for k=1 (the session
identity) and k=2 (the host), which are valid bech32 — every client-side
parser accepts them — and are not derived from anything of yours. Verified by
booting the harness against a web directory with no `config.json` at all and
grepping the rendered DOM for both the bech32 and the hex form of the real
host npub: neither appears.

### Why patches and not an import map

An import map is the obvious way to swap the two modules, and it does not work:
an import map must live in an inline `<script type="importmap">`, and the CSP
here is `script-src 'self'` with no `'unsafe-inline'` — the one inline script
the SPA may not have. Adding it for the harness would mean the harness stops
running under the real policy, so anything verified there is not verified.

Patching the prototypes keeps the genuine classes, constructors and private
state, and replaces only the methods the SPA actually calls. The real client is
untouched and still verifies every signature and every NIP-44 payload it
receives.

## The unlock step

There is no login to perform. The harness takes the *unlock* path
(`hasVault` is patched to `true`, as a returning user would), waits for the
real unlock panel to appear, fills the PIN with `0000` and clicks
**Desbloquear**. Any PIN works — `unlockWithPin()` is patched — and the form
being the real one is deliberate: it exercises the path the app actually takes
rather than skipping it.

The wait is gated on `#unlock-ui` being *visible*, not on `#pin-input`
existing. Both the input and the button are in the static markup, so an
existence check is true before `bindEvents()` has run, and the click lands on
a dead button. That version was intermittent: it worked when init finished
first and otherwise left the page sitting on the PIN screen. `showUnlockScreen()`
runs after `bindEvents()` and is what un-hides the panel, so visibility is
the first moment the click is real.

If the panel still does not appear within 15s the harness logs an explicit
error naming `bindEvents`, instead of failing silently.

## Editing the fixtures

`mock_data.js` holds the services and the telemetry. The values are chosen
to make the interface *show* its states rather than to be realistic:

- `/var/lib/docker` at 95% and `/mnt/backups` at 98% sit above the storage
  warn (90%) and critical (97%) lines, so the amber and red rows are visible
  without waiting for a real disk to misbehave.
- `mosquitto` is `down` and `portainer` is `unknown`, so the service dots show
  all three states at once.
- The history series carries a daily cycle, so a 7-day window shows seven humps.

Telemetry is a smooth random walk, not white noise — real load and memory move
slowly, and a jittering meter hides real bugs behind visual noise.

## What is not covered

- The real login, vault encryption, WebAuthn and brute-force paths.
- Nostr signing, relay handshake, and every signature check.
- Anything behind a real daemon session, including opening a service.
- The NixOS module, the proxy and the dynamic `/local/<porta>/` proxy.

For those, use a real host: the harness is for the pixels, not the protocol.
