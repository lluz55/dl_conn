---
type: task
phase: 17
status: pending
title: "Fase 17 — Performance: binário Go e bundle web"
description: "Reduzir o binário dl_conn de ~15,9 MB para ≤9 MB (CLI_BUDGET_MB=9), e o bundle web first-load de ~150 KB gzip para ≤90 KB gzip (WEB_BUDGET_KB=90). Quebrar app.js monolítico em módulos ES."
timestamp: 2026-10-02T17:40:00Z
---

# Fase 17 — Performance: binário Go e bundle web

## Objetivo

Atender os orçamentos de tamanho definidos em `docs/okf/concepts/performance.md` (até hoje não materializados em números concretos):

- **`CLI_BUDGET_MB = 9`** — binário `dl_conn` ≤ 9 MB após strip + ldflags.
- **`WEB_BUDGET_KB = 90`** — first-load total (HTML + CSS + JS + fontes + vendor) ≤ 90 KB gzip.

Sem quebrar nenhum teste existente. Sem alterar a UX observável — só o pipeline de build.

## Contexto

- Binário atual `dl_conn` (`/home/lluz/dev/dl_conn/dl_conn`) tem **15.993.013 bytes (≈15,25 MiB)**. A maior parte é o `modernc.org/sqlite` puro-Go (compila o engine SQLite em Go e fica grande) e símbolos DWARF que não são strippados pelo build padrão.
- `web/app.js` é **2.445 linhas / ~98 KB** (não-gzipped), servidas cruas via `http.FileServer(http.Dir(webDir))` em `cmd/dl_conn/main.go`. Não há bundler nem minify.
- `web/style.css` é **1.919 linhas / ~59 KB**.
- `web/vendor/` contém `nostr-tools-2.9.2.mjs` (**97 KB**) + `jsqr-1.4.0.mjs` (**131 KB**) + 3 fontes woff2 (**~102 KB**).
- Total first-load ≈ **497 KB** não-gzip, ≈ **150 KB** gzip estimado.

## Sub-tarefas

- [ ] **Definir valores numéricos dos orçamentos em `docs/okf/concepts/performance.md`:**
  - Atualizar a tabela para incluir `CLI_BUDGET_MB = 9` e `WEB_BUDGET_KB = 90` (gzip).
  - Adicionar nota explicando que esses são limites de **CI gate**, configuráveis via env (`CLI_BUDGET_MB_OVERRIDE`, `WEB_BUDGET_KB_OVERRIDE`) para não travar dev local.

- [ ] **Adicionar `scripts/check-budgets.sh`:**
  - Mede o binário (`stat -c %s result/bin/dl_conn`) e os bytes servidos (`gzip -c web/index.html web/style.css web/app.js web/vendor/*.mjs web/vendor/fonts/*.woff2 | wc -c`).
  - Falha (exit 1) se exceder `CLI_BUDGET_MB` ou `WEB_BUDGET_KB` (resolvidos de env com fallback para os defaults).
  - O script é parte do completion gate documentado em `AGENTS.md`.
  - Registrar em `docs/okf/concepts/performance.md` e referenciar no `docs/runbook.md` (seção "Verificações obrigatórias").

- [ ] **Strip + ldflags em `dl-conn.nix`:**
  - Adicionar `ldflags = [ "-s" "-w" ]` (remove tabela de símbolos + DWARF). Esperado: −30% no tamanho.
  - Adicionar `trimpath = true` (remove prefixos absolutos do filesystem dos binários).
  - Adicionar `GOFLAGS = "-trimpath"` ao `env` do `buildGoModule`.
  - Medir antes/depois (`du -h result/bin/dl_conn`) e documentar o delta em `performance.md` (subseção "Resultados observados").

- [ ] **Substituir `modernc.org/sqlite` por `mattn/go-sqlite3`:**
  - Em `go.mod`, adicionar `github.com/mattn/go-sqlite3 v1.14.x`.
  - Em `dl-conn.nix`, habilitar `CGO_ENABLED = 1` no `env` (NÃO como atributo direto da derivação — ver gotcha em `AGENTS.md`).
  - Adicionar `buildInputs = [ pkgs.sqlite ];` e `tags = [ "sqlite_omit_load_extension" ];` no `buildGoModule`.
  - Em `internal/store/db.go`, ajustar import.
  - **Esperado**: binário volta a ficar ≤9 MB (sqlite3 C é ~600 KB; modernc puro-Go era ~6 MB).
  - Re-rodar `go test ./internal/store/...` para validar compat.

- [ ] **Adicionar step de minify no build (`dl-conn.nix`):**
  - Usar `pkgs.esbuild` (já em nixpkgs) para minificar `web/app.js` (target `es2022`, mangle, compress).
  - Usar `pkgs.postcss` com `cssnano` para `web/style.css` (sem `purge` agressivo porque o CSS tem variantes `data-phase`).
  - Usar `pkgs.html-minifier-terser` (ou `pkgs.html-terser`) para `web/index.html`.
  - O resultado vai para `web/_min/`; o daemon serve `web/_min/` quando `NODE_ENV=production`.
  - Manter `web/` legível como fonte — só `web/_min/` é gerado.
  - Adicionar hook `checkPhase` que falha se `web/_min/app.js` não existir após build (smoke gate).

- [ ] **Modularizar `web/app.js`:**
  - O arquivo é uma IIFE monolítica de ~98 KB. Quebrar em módulos ES:
    - `web/js/app/app_lifecycle.js` — boot, init, top-level state.
    - `web/js/app/views_setup.js` — fase `data-phase="setup"`.
    - `web/js/app/views_live.js` — fase `data-phase="live"`.
    - `web/js/app/views_health.js` — `#health` overlay.
    - `web/js/app/keygen_ui.js` — QR + nsec input.
    - `web/js/app/relay_panel.js` — status de relays.
    - `web/js/app/i18n_strings.js` — centralizar strings PT-BR inline (atualmente hardcoded em `app.js`).
  - Converter `app.js` em entry-point que apenas orquestra imports. Tamanho esperado: < 8 KB após minify.
  - Manter `web/index.html` compatível — o `<script type="module" src="js/app.js"></script>` atual continua funcionando.

- [ ] **Import dinâmico de `jsqr` quando necessário:**
  - Substituir `<script src="vendor/jsqr-1.4.0.mjs">` por `import('./vendor/jsqr-1.4.0.mjs')` chamado apenas quando o usuário clica "Ler nsec via QR" (`web/js/qr_scanner.js`).
  - Esperado: 131 KB do `jsqr` saem do first-load (só carregam sob demanda).
  - Medir com `PerformanceObserver` em `web/tests/perf_first_load.js` (novo teste, roda com node 22).

- [ ] **Sub-set de `nostr-tools` no bundle:**
  - O bundle atual importa tudo do `nostr-tools`. Auditar quais funções são usadas (`getEventHash`, `finishEvent`, `generateSecretKey`, etc.) e criar `web/vendor/nostr-tools-core.mjs` que re-exporta apenas o necessário. Build step com `esbuild` `--bundle` ou `nix run nixpkgs#esbuild -- --bundle`.
  - Esperado: −70% do vendor (97 KB → ~30 KB).
  - Adicionar guard em `web/tests/vendor_audit.js` que falha se `vendor/nostr-tools-core.mjs` exceder 40 KB.

- [ ] **Atualizar `docs/okf/concepts/web-frontend-layout.md`:**
  - Adicionar subseção "Bundle pipeline" descrevendo o build step Nix + onde vivem os artefatos.
  - Cross-link para `performance.md` (orçamentos) e `scaffolding.md` (regras de i18n/tokens).

## Onde isso vive no código

- `dl-conn.nix` (passos 4, 6)
- `go.mod`, `go.sum` (passo 5)
- `internal/store/db.go` (passo 5)
- `internal/store/db_test.go` (passo 5)
- `scripts/check-budgets.sh` (novo, passo 2)
- `web/app.js`, `web/index.html`, `web/style.css` (passos 6, 7, 8)
- `web/js/app/*.js` (novo, passo 6)
- `web/js/qr_scanner.js` (passo 7)
- `web/vendor/nostr-tools-core.mjs` (novo, passo 8)
- `web/tests/perf_first_load.js`, `web/tests/vendor_audit.js` (novos, passos 7, 8)
- `docs/okf/concepts/performance.md` (passos 1, 3)
- `docs/okf/concepts/web-frontend-layout.md` (passo 9)
- `docs/runbook.md` (passo 2)

## Critérios de Aceite (Definition of Done)

1. `nix develop --command bash -c "nix-build -A pkg && du -h result/bin/dl_conn"` reporta ≤ 9 MB. CI roda `scripts/check-budgets.sh` e passa.
2. `nix-build` falha se `web/_min/app.js` não for gerado (smoke gate).
3. `go test ./...`, `golangci-lint run`, `go vet ./...` verdes após substituição do driver SQLite. Nenhum teste novo falha.
4. `scripts/check-budgets.sh` falha explicitamente quando binário ou bundle excedem orçamento (testar localmente elevando o limite via env).
5. Em browser, primeira carga do SPA dispara **uma** request para `app.js` (não múltiplas — confirmar em Network tab). Total transferido (gzip) ≤ 90 KB para `index.html + style.css + app.js + fonts/* + vendor/*`.
6. `PerformanceObserver` em `web/tests/perf_first_load.js` (rodando contra build minificado) mede `loadEventEnd - navigationStart` ≤ 600 ms em CI (rede simulada: 1 Mbps / 100 ms RTT).
7. `node web/tests/vendor_audit.js` confirma que `nostr-tools-core.mjs` ≤ 40 KB e `jsqr-1.4.0.mjs` NÃO está em `web/_min/` (só carrega sob demanda).
8. README.md menciona "Build minificado" e aponta para `scripts/check-budgets.sh`.
## Itens deliberadamente fora de escopo (2026-10-02)

Decisão do usuário ao abrir a trilha de segurança:

- **Trocar `modernc.org/sqlite` por `mattn/go-sqlite3` (CGO)** — o driver
  puro-Go fica. O binário passa a ser medido com `strip`/`trimpath`
  (itens 3 e 6 da lista), e o `CLI_BUDGET_MB` é ajustado ao resultado real em
  vez de perseguir um número que só o driver achieves. O item 4 da lista
  permanece unchecked até haver interesse explícito em CGO, que traria
  `CGO_ENABLED`, `buildInputs` e um novo `vendorHash` para manter.
- **Pipeline de minify no Nix** (esbuild/postcss/html-minifier) — também
  adiado; o que fica priorizado nesta fase é o split de `app.js` em módulos
  ES, os orçamentos e `scripts/check-budgets.sh`, que são mensuráveis sem
  tocar na estratégia de build.

Consequência para as fases dependentes: [p18](p18-perf-hotpath.md) assume
`web/_min/` com hash no nome, que depende do item de minify. Sem ele, o
versionamento por content hash da Fase 18 cai para `max-age=300,
must-revalidate`.
