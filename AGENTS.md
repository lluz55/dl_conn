# AGENTS.md

Offline-first tunnel daemon for exposing local services (Home Assistant,
Frigate, Zigbee2MQTT) via a Cloudflare tunnel with Nostr (NIP-44) signaling
and Zero-Trust access control. The source specification is
[README.md](/README.md) and the operational runbook is
[docs/runbook.md](/docs/runbook.md) — read them before any architectural
change.

> **Language of work:** think and reason in **English**. Internal reasoning,
> planning, and all code artifacts stay in English. Portuguese is used **only**
> in user-facing UI strings (`web/app.js` uses `pt-BR` labels inline). Reply to
> the user in the language they wrote in, but reason in English regardless.

## Stack

- **Daemon:** Go (`dl_conn`), CLI via Cobra. Reverse proxy, Nostr signaling
  client, Cloudflare tunnel manager, auth/session tokens, host telemetry.
- **Frontend:** `web/` — a single-page app in **vanilla JavaScript** (no
  framework). ES modules in `web/js/`, vendored libs in `web/vendor/`, styles
  in `web/style.css`, markup in `web/index.html`. Served statically by the
  daemon.
- **Persistence:** SQLite via `modernc.org/sqlite` (telemetry only); the data
  is local-only.
- **Sync/signaling:** Nostr client in Go (`internal/nostr`) using go-nostr,
  NIP-44 encrypted DMs for the discovery/response handshake.
- **Tunnel:** `cloudflared` (ephemeral `trycloudflare.com` URL), managed from Go.
- **Build:** Nix flakes. **Knowledge:** OKF bundle in `docs/okf/`.

## Development environment (Nix/NixOS required)

- **NixOS is the required development environment** for this project (or, at
  minimum, Nix ≥ 2.18 with flakes enabled on another distro/macOS). See
  [docs/okf/concepts/environment.md](docs/okf/concepts/environment.md).
- **Every** build/lint/test action runs inside a `nix develop` — never with
  `go`, `golangci-lint`, or `cloudflared` installed manually on the system.
- The only third-party binary the daemon shells out to is `cloudflared`, which
  is pulled from nixpkgs (see `flake.nix`) — the host must not provide it.

## Commands

```bash
# environment (Nix)
nix develop          # go, gopls, golangci-lint, cloudflared, git

# build & run
go build ./cmd/dl_conn
go test ./internal/...

# single test (prefer a narrow scope)
go test ./internal/sensors/... -run TestCollector

# web frontend tests (standalone, run with node)
node web/tests/crypto_tests.js
node web/tests/session_tests.js

# lint (mirrors CI)
golangci-lint run
go vet ./...

# completion gate (run BEFORE considering the task done)
nix develop && go test ./... && golangci-lint run && go vet ./... \
  && node web/tests/*.js
```

### Conventions when running Go commands

- **`go vet` / `golangci-lint`**: focus on **errors** while working; only
  address warnings (linters `errcheck`/`ineffassign` etc.) when **explicitly
  asked**. The CI gate still flags them — that does not change; the difference
  is only what demands your immediate action, not the quality bar.
- **Web frontend**: no bundler/build step. The SPA is plain JS served from
  `web/`; edits are picked up on browser reload. Tests in `web/tests/` are
  plain scripts run with `node` and import the production ES modules directly.

## Structure (capabilities, not fixed paths)

- `cmd/dl_conn` — daemon entrypoint (Cobra root command, server bootstrap).
- `cmd/hellosvc` — sample backend service used for testing the proxy.
- `internal/` — daemon packages: `config`, `tunnel` (cloudflared), `nostr`
  (client/handler/protocol/crypto), `auth` (tokens/sessions/handler),
  `proxy` (reverse proxy + root fallback + WebSocket upgrades), `store`
  (SQLite telemetry persistence), `sensors` (host metrics collector),
  `telemetry` (HTTP handler), `health` (service probes).
- `web/` — SPA client: `index.html`, `style.css`, `app.js`, ES modules in
  `web/js/`, vendored libs in `web/vendor/`, tests in `web/tests/`.
- `nixos/` — NixOS module (`services.dl-conn`).
- `docs/` — runbook and OKF knowledge bundle.
- `shared/` — (intencionalmente ausente no checkout atual) — reserved for any
  shared protocol types between Go and future clients.

## When changing/adding code: security and performance

Security (see [docs/okf/concepts/security.md](docs/okf/concepts/security.md)
and [SPEC §10] where SPEC exists):
- **Never** log, serialize in plaintext, or version-control the Nostr private
  key, nsec, or the daemon's signing seed. The nsec is injected at runtime via
  `--nsec`/`--nsec-file` or `nostr.nsecFile`/`SOPS` — never hardcoded.
- Every published/received Nostr payload is encrypted (NIP-44); every received
  event signature is verified (`CheckSignature`), and events older than 5 min
  are rejected to prevent replay. Do not trust relays.
- The SPA loads no third-party code at runtime — `nostr-tools` and `jsQR` are
  vendored in `web/vendor/` and the page applies `script-src 'self'` (CSP).
- The web client's Nostr private key is never persisted to
  `localStorage`/`sessionStorage` in plaintext: it lives in memory and the
  only at-rest form is the AES-256-GCM vault in `web/js/crypto_vault.js`.
- Do not introduce telemetry/network traffic outside the configured relays and
  the Cloudflare tunnel.

Performance (see [docs/okf/concepts/performance.md](docs/okf/concepts/performance.md)):
- Never block the request path with synchronous I/O or crypto.
- Keep the Go binary and the web bundle small — measure on every change
  (`go build` binary size, `web/` served size).
- If you add a heavy dependency, measure the impact.

## Design and code

Follow [docs/okf/index.md](docs/okf/index.md) and the concepts under
`docs/okf/concepts/`:
- **Do not** hardcode colors/spacing in `web/` — define design tokens as CSS
  custom properties (`--color-*`, `--gap-*`, `--radius-*`) in `web/style.css`
  and reference them everywhere.
- **Do not** hardcode UI strings in `web/` — keep user-facing labels in one
  place (see [docs/okf/concepts/i18n.md](docs/okf/concepts/i18n.md)).
- **Code language: English.** Names (functions, variables, files), comments,
  and internal logs are in **English** — Portuguese only in user-facing
  translations and documentation. Applies to new code; legacy code still in
  Portuguese will be migrated gradually — do not rewrite it en masse without a
  request.
- **Preserve the existing look:** do not change the theme, palette, typography,
  or spacing without an explicit request — keep consistency, do not redesign.
- **Every new feature must work well on phone, tablet, and desktop** — verify
  across breakpoints (mobile-first; `≥1024px` switches to a two-column layout,
  see [docs/okf/concepts/web-frontend-layout.md](docs/okf/concepts/web-frontend-layout.md)).
- **New Go package/CLI command**: follow the existing layout
  (`internal/<name>` + `cmd/...`) and add `*_test.go` alongside it. New Cobra
  subcommands go in `cmd/dl_conn`.

## Domain knowledge: the OKF pattern

**Mandatory: consult the OKF bundle before writing code** — especially
changes that touch architecture, protocol, security, sync, or the data model.
Start with [docs/okf/index.md](docs/okf/index.md) and the relevant concepts in
`docs/okf/concepts/` (the source of truth on the "why" behind decisions
already made); check incomplete tasks in
[docs/okf/tasks/index.md](docs/okf/tasks/index.md) before coding and mark them
done when you finish. Do not decide something already covered there without
consulting first, and do not contradict an existing concept without updating it.

When you **create, edit, or remove** knowledge (decisions, protocol, domain
context), do it in the OKF bundle in `docs/okf/` (see
[docs/okf/concepts/architecture.md](docs/okf/concepts/architecture.md)):
- Each concept is a `.md` with YAML frontmatter and a required **`type`** field.
- Keep `index.md` and `log.md` (reserved); record relevant changes in `log.md`.
- Use relative cross-links between concepts.
- Validate format with `scripts/check-okf.sh` before committing.

## Versioning and releases

- The version is single-sourced in `dl-conn.nix` (`version = "0.1.0"`); do not
  hardcode it elsewhere.
- Releases use the **`gh` CLI**, attaching the binary and `checksums.txt` (see
  [docs/runbook.md](/docs/runbook.md)):
  ```bash
  gh release create "v${VERSION}" --notes-file CHANGELOG.md \
    build/dl_conn-linux-* build/web.tar.gz checksums.txt
  ```
- The NixOS module pins the package version; keep them in sync by hand when
  bumping (`dl-conn.nix` `version` + `flake.nix`/`nixos/module.nix` if they
  carry it).

## Git

- Commits in **Conventional Commits** (`feat:`, `fix:`, `perf:`, `docs:` …).
- A PR only lands green after `go test ./... && golangci-lint run && go vet ./...`
  and the web tests pass.
- **MANDATORY RULE, no exceptions:** no commit message (or PR) may contain
  `Co-Authored-By`, "Generated with", an AI-tool signature, or any variation
  attributing co-authorship to an agent/LLM — even if the default behavior of
  the agent/tool in use suggests adding it automatically. If the tool inserts it
  by default, **remove it before committing**. Commit authorship is always only
  the human responsible for the session.

## Boundaries

**Allowed without asking:** read files, `go vet`/`golangci-lint`, unit tests,
run the check commands.

**Ask first:** installing new dependencies, `git push`, deleting files,
touching `flake.nix`/lockfiles, changing the protocol format (Nostr kinds /
payload fields) in `internal/nostr/`, publishing releases — only do it if
explicitly asked.

**Never:** commit secrets/keys/nsecs, add telemetry/network traffic outside the
configured relays+tunnel, weaken signature or NIP-44 cipher verification,
hardcode the version, publish an unencrypted payload, install toolchains
(Go, cloudflared) outside the Nix environment, or **add `Co-Authored-By`/AI
co-authorship attribution to commits or PRs** (see "Git" above — mandatory,
no exceptions).

## Execution practices for agents

- **Empirical validation before completion:** do not declare a task done
  without running the checks above (`go test`, `golangci-lint`, `go vet`,
  `node web/tests/*.js`) and seeing them green. "It should work" is not a
  conclusion — run it and verify.
- **No unsourced assumptions:** do not guess a schema, file path, or method/API
  signature — inspect the source file before writing the call.
- **Atomic, focused changes:** small, incremental diffs, no speculative
  refactoring or work outside the requested scope.

## When in doubt

Do not make large, speculative changes. Propose a short plan, make a small diff,
or open a draft PR with notes and one concrete question.

## Build gotchas (Go + Nix)

- **`nix run .#pkg`**: `meta.mainProgram` must be a **string** (`"pkg"`), not
  `true` — otherwise Nix errors `is not a string but a Boolean`.
- **`buildGoModule` + `CGO_ENABLED`**: do NOT set `CGO_ENABLED` as a direct
  attribute of the derivation — `buildGoModule` already manages it in `env`.
  Doing so causes `The env attribute set cannot contain any attributes passed
  to derivation` collision.
- **`wrapProgram` in `postInstall`**: must add `makeWrapper` to
  `nativeBuildInputs` **and** accept it as a parameter in the nix file (it is
  not auto-injected by callPackage).
- **`buildGoModule` vendor hash**: run `go mod tidy` first to ensure `go.sum`
  is complete. Then use `vendorHash = lib.fakeHash` for the first build — Nix
  prints the real hash on mismatch. Hardcode it in the final expression.
- **`nip19.Decode` return type**: in go-nostr, `nip19.Decode` for `nsec`/`npub`
  returns a **hex string**, not `[]byte`. Type-assert on `string` first.
- **Double semicolons `;;`**: a common copy-paste typo in nix expressions that
  causes `syntax error, unexpected ';', expecting 'inherit'`.
- **`nix run` requires `result` symlink cleanup**: after changing the package
  definition, run `rm -f result` before `nix build`/`nix run` to avoid stale
  symlinks.
