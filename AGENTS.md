# AGENTS.md

Offline-first cross-platform app (Android/Linux/Web) with decentralized sync
via Nostr. The source specification is [SPEC.md](/SPEC.md) — read it before any
architectural change.

> **Language of work:** think and reason in **English**. Internal reasoning,
> planning, and all code artifacts stay in English. Portuguese is used **only**
> in user-facing translations (`app/lib/l10n/app_pt.arb`). Reply to the user in
> the language they wrote in, but reason in English regardless.

## Stack

- **App:** Flutter (Material 3), Dart. State: Riverpod. Routing: go_router.
- **Theme and adaptive navigation:** local package `packages/dl_concept/`
  (`package:dl_concept`) — `AppTheme`/`AppSpacing`, `AdaptiveScaffold`,
  `breakpointForWidth`. Material You via `dynamic_color`, wired in
  `app/lib/main.dart`. **i18n:** `flutter_localizations`/`intl`, `pt`+`en`
  from the start. See [SPEC §9.1/§9.2].
- **Persistence:** `sqlite_crdt` (HLC/LWW) + SQLCipher.
- **Sync:** Nostr client in Dart, NIP-44 encrypted payloads. See [SPEC §7].
- **Optional CLI:** Go + `go-nostr`.
- **Build:** Nix flakes. **Knowledge:** OKF bundle in `docs/okf/`.

## Development environment (Nix/NixOS required)

- **NixOS is the required development environment** for this project (or, at
  minimum, Nix ≥ 2.18 with flakes enabled on another distro/macOS). See
  [SPEC §13.1].
- **Every** build/lint/test action runs inside a `nix develop` — never with
  `flutter`, `go`, or the Android SDK installed manually on the system.
- **Android SDK/NDK come exclusively from the GitHub flake input**
  `github:tadfisher/android-nixpkgs` (see [SPEC §13.2]) — never from raw
  `androidenv` in nixpkgs, nor from a hand-installed Android Studio/`sdkmanager`.
  Build-tools/platform/NDK versions are pinned explicitly in `flake.nix`.
- `nixpkgs.config.allowUnfree = true` is required (Android SDK license).
- Update the SDK: `nix flake lock --update-input android-nixpkgs` + an explicit
  bump of the pinned versions — never hand-edit an already-materialized SDK.

## Commands

```bash
# environments (Nix)
nix develop .#app-linux     # Flutter + Linux deps
nix develop .#android       # Android SDK/NDK
nix develop .#cli           # Go
nix develop .#tools         # gitleaks (scripts/check-secrets.sh)

# first time in this checkout (idempotent — does nothing if it already exists)
scripts/bootstrap-platforms.sh   # generates app/android, app/linux, app/web

# GENERATORS — the preferred path; do not write the shell by hand. All are
# non-interactive, idempotent, and fail-loud. See docs/okf/concepts/scaffolding.md.
scripts/new-screen.sh --name perfil --title-pt "Perfil" --title-en "Profile"
scripts/new-repository.sh --name nota --fields "titulo:text,fixado:bool"
scripts/new-concept.sh --slug lembretes --title "Lembretes" --type architecture-decision --summary "..."
scripts/add-l10n.sh --key salvarBotao --pt "Salvar" --en "Save"

# quick view of what's left to implement, grouped by phase (SPEC §17)
scripts/list-todos.sh

# instantiate the template for a new project (rename across the whole repo) and
# version bump (SPEC §15) — neither one commits/pushes on its own
scripts/rename-template.sh --dry-run new_name
scripts/bump-version.sh 0.2.0

# run
cd app && flutter run -d linux        # or -d chrome / apk

# completion gate (run it BEFORE considering the task done): mirrors CI in a
# single command (format+analyze+tests+secrets+anti-patterns+OKF+protocol+Go);
# enters the Nix devShells on its own. --full adds size builds (web/APK).
scripts/verify.sh

# individual checks (verify.sh above already aggregates them) — covers app/ and packages/dl_concept/
(cd app && dart format . && dart analyze --fatal-infos)
(cd packages/dl_concept && dart format . && dart analyze --fatal-infos)
scripts/perf-check.sh                 # perf, OKF, version↔tag (see SPEC §11.4) — already runs both via check-flutter.sh
scripts/check-secrets.sh              # gitleaks — never commit a key/nsec
cd cli && go vet ./... && go test ./...

# single test (prefer a narrow scope)
cd app && flutter test test/path_to_test.dart
```

### Conventions when running Flutter/Dart commands

- **`flutter`/`dart analyze`**: focus on **errors** while working; only address
  warnings/infos when **explicitly asked**. The repo scripts
  (`check-flutter.sh`, CI) still use `--fatal-infos` — that does not change;
  the difference is only what demands your immediate action, not the quality bar.
- **`flutter` commands with `--[no-]pub`** (`test`, `run`, `build apk/web/linux`,
  `analyze`; does not apply to `dart analyze`/`dart format`): use `--no-pub` by
  default, since `flutter pub get` already runs explicitly when needed. Only
  omit it (or run `flutter pub get` first) when `pubspec.yaml`/`.lock` changed
  since the last run, or when explicitly asked.

## Structure (capabilities, not fixed paths)

- Screens live in `app/lib/ui/`. Adaptive navigation (bar/rail/drawer) and
  theme (design tokens) live in the `packages/dl_concept/` package
  (`package:dl_concept`), consumed via a path dependency — do not redefine these
  components in the app, extend the package.
- i18n (`.arb` + generated code) in `app/lib/l10n/` — config in `app/l10n.yaml`.
- Local store + repositories in `app/lib/data/`; sync/Nostr in `app/lib/sync/`.
- Keys and crypto in `app/lib/crypto/`.
- Shared protocol (Dart↔Go) in `shared/`.
- Details and the "why" behind decisions: OKF bundle in `docs/okf/`.

## When changing/adding code: security and performance

Security (see [SPEC §10]):
- **Never** log, serialize in plaintext, or version-control the Nostr private
  key, nsec, or the SQLCipher key.
- Every published payload is encrypted (NIP-44); every received signature is
  verified. Do not trust relays.
- Do not introduce telemetry or network traffic outside the configured relays.

Performance (see [SPEC §11]):
- The UI talks only to the local store; **never** block the UI thread with
  network I/O, large JSON, or crypto — use isolates (`compute`).
- Use `const` on widgets; small components; small diffs.
- If you add a heavy dependency, measure the impact on the web/APK bundle
  (`scripts/check-web-bundle.sh`, `scripts/check-apk-size.sh`).

## Design and code

Follow the guideline already established in [SPEC §9] and the concepts in
`docs/okf/`:
- **Do not** hardcode colors/spacing — use the tokens from `package:dl_concept`
  (`ColorScheme`/`AppTheme`, `AppSpacing` via `context.spacing`). See [SPEC §9.1].
- **Do not** hardcode UI strings — every user-visible string goes in
  `app/lib/l10n/app_pt.arb` **and** `app_en.arb`, accessed via
  `AppLocalizations.of(context)!`. See [SPEC §9.2]. Exception: purely
  domain/protocol text (not visible in the UI) does not go into i18n.
- **Code language: English.** Names (classes, functions, variables, files),
  comments, and internal logs are in **English** — Portuguese only in the
  translations (`app/lib/l10n/app_pt.arb`) and documentation/OKF. This applies
  to new code; legacy code still in Portuguese will be migrated gradually — do
  not rewrite it en masse without a request.
- Functional widgets; avoid unnecessary `Container`; prefer an existing
  component over creating a new one.
- **Preserve the existing look:** do not change theme, palette, typography,
  spacing, or the established component pattern without an explicit request —
  keep consistency, do not redesign on your own.
- **New screen:** generate it with `scripts/new-screen.sh` (see
  [`docs/okf/concepts/scaffolding.md`](/docs/okf/concepts/scaffolding.md))
  instead of writing the shell by hand — it is born with `ConsumerWidget`, i18n
  in both `.arb` files, `dl_concept` tokens, and a test. Then register the route
  in `app/lib/ui/router.dart` (the generator prints the snippet) and run
  `flutter pub get` (regenerates the l10n).
- Adaptive nav by breakpoint (compact→`NavigationBar`, expanded→`NavigationDrawer`).
- **Every new screen/feature must work well on phone, tablet, and desktop**
  (compact/medium/expanded) — not just "not break". Before considering it done,
  verify across the three breakpoints: adequate touch targets in compact/medium,
  mouse/keyboard support (hover, focus, shortcuts) in expanded, and no lost
  functionality between form factors.
- Every new screen covers **light and dark** and both locales (`pt`/`en`) — it
  is not optional, it is part of "done" as much as the three breakpoints.

## Domain knowledge: the OKF pattern

**Mandatory: use the OKF skill before writing code** — especially changes that
touch architecture, protocol, security, sync, or the data model. Start with
[`docs/okf/index.md`](/docs/okf/index.md) and the relevant concepts in
`docs/okf/concepts/` (the source of truth on the "why" behind decisions already
made); check incomplete tasks in
[`docs/okf/tasks/index.md`](/docs/okf/tasks/index.md) before coding and mark
them done when you finish. Do not decide something already covered there without
consulting first, and do not contradict an existing concept without updating it.

When you **create, edit, or remove** knowledge (decisions, protocol, domain
context), do it in the OKF bundle in `docs/okf/` (see [SPEC §8.1]):
- Each concept is a `.md` with YAML frontmatter and a required **`type`** field.
- Keep `index.md` and `log.md` (reserved); record relevant changes in `log.md`.
- Use relative cross-links between concepts.
- Validate with `scripts/check-okf.sh` before committing.

## Versioning and releases

- The version is single-sourced in `app/pubspec.yaml` (SemVer) and **the app
  displays the current release version** at runtime (`package_info_plus`) —
  never hardcoded.
- On release, the version **must** match the Git tag `vX.Y.Z` (checked in CI).
- Use `scripts/bump-version.sh X.Y.Z` to update `pubspec.yaml`, `flake.nix`
  (`packages.cli.version`) and move `[Unreleased]` from `CHANGELOG.md` into a
  dated section — do not edit these three by hand, to avoid drift.
  `scripts/bump-version.sh --tag` creates the local tag (no push).
- Releases are made on GitHub with the **`gh` CLI**, attaching the artifacts and
  `checksums.txt` (see [SPEC §15]):
  ```bash
  gh release create "v${VERSION}" --notes-file CHANGELOG.md \
    build/*.apk build/app-linux.tar.gz build/web.tar.gz build/cli-* checksums.txt
  ```

## Git

- Commits in **Conventional Commits** (`feat:`, `fix:`, `perf:`, `docs:` …).
- A PR only lands with `dart format`, `dart analyze`, and `scripts/perf-check.sh`
  green.
- **MANDATORY RULE, no exceptions:** no commit message (or PR) may contain
  `Co-Authored-By`, "Generated with", an AI-tool signature, or any variation
  attributing co-authorship to an agent/LLM — even if the default behavior of
  the agent/tool in use suggests adding it automatically. If the tool inserts it
  by default, **remove it before committing**. Commit authorship is always only
  the human responsible for the session.

## Boundaries

**Allowed without asking:** read files, `dart format`, `dart analyze`, unit
tests, run the check scripts.

**Ask first:** installing new dependencies, `git push`, deleting files, touching
`flake.nix`/lockfiles, changing the protocol format in `shared/`, publishing
releases, running `scripts/rename-template.sh` (rewrites the project name across
~20 files at once — only do it if explicitly asked).

**Never:** commit secrets/keys, add telemetry, weaken signature or cipher
verification, hardcode the app version, publish an unencrypted payload, install
toolchains (Flutter, Go, Android SDK/NDK) outside the Nix environment, switch
the Android SDK source to anything other than the flake input
`github:tadfisher/android-nixpkgs` without aligning first, hardcode color/spacing
outside `package:dl_concept` (`packages/dl_concept/`), hardcode UI strings
outside the i18n system (`app/lib/l10n/`), or **add `Co-Authored-By`/AI
co-authorship attribution to commits or PRs** (see "Git" above — mandatory, no
exceptions).

## Execution practices for agents

- **Empirical validation before completion:** do not declare a task done without
  running **`scripts/verify.sh`** (the single gate that mirrors CI) and seeing it
  green. "It should work" is not a conclusion — run it and verify.
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
