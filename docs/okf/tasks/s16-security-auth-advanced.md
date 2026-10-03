---
type: task
phase: 16
status: done
title: "Fase 16 — Segurança: autenticação avançada"
description: "Substituir token-em-URL por POST/header, adicionar step-up auth para endpoints sensíveis, e garantir zero-on-exit da chave Nostr em memória."
timestamp: 2026-10-02T17:35:00Z
---

# Fase 16 — Segurança: autenticação avançada

## Objetivo

Reduzir a janela de exposição do token de autenticação efêmero, adicionar um segundo fator reutilizável (step-up) para endpoints sensíveis, e limitar o tempo de vida da `nsec` no heap do Go. Mudanças tocam `internal/auth`, `internal/nostr`, `web/js/session_manager.js` e o fluxo de login na SPA.

## Contexto

- `internal/auth/handler.go:38` aceita o token via query parameter. O fluxo atual (`<a href="https://<tunnel>/auth?token=...">`) deixa o token em histórico de navegador, logs de cloudflared, e Referer caso o serviço de destino tenha política permissiva.
- Sessões vivem 4h (`sessionTTL`). Um cookie roubado dá acesso ao túnel durante toda a janela.
- A `nsec` (em hex) é passada para `nostr.NewClient` (`cmd/dl_conn/main.go:139`) e fica no heap até o processo encerrar. Inspeção de `/proc/<pid>/mem` durante esse intervalo revela a chave.

## Sub-tarefas

- [x] **Aceitar token via POST em `/auth`:**
  - Adicionar handler para `POST /auth` com `Content-Type: application/x-www-form-urlencoded` (`application/json` opcional — payload `{"token": "...", "redirect": "..."}`).
  - Manter compatibilidade retroativa com `GET /auth?token=...` durante 1 release (cabecalho `Sunset: ...` no response do GET, com `Warning: 299 - "deprecated"`).
  - Quando o request vem via POST e o token é válido: emitir cookie + retornar `200 OK` com `{"redirect": "/frigate/"}` em vez de `302`. A SPA passa a usar `fetch('/auth', {method: 'POST', body: ...})` para os fluxos QR-scan e QR-login (em `web/js/qr_auth.js` e `web/js/session_manager.js`).
  - Quando o request vem via POST e o token é inválido: `401` (mesma semântica do GET).
  - Refletir a mudança em `internal/auth/auth_test.go`: novo caso `TestAuthPostFlow_Valid` e `TestAuthPostFlow_Invalid`.

- [x] **Aceitar token via header `X-Dl-Conn-Token`:**
  - Mesmo handler consome `X-Dl-Conn-Token` se presente, independente do método.
  - Permite futuro uso via `Authorization: Bearer <host-nsec-token>` por apps nativos (sem browser, sem cookie store).
  - Documentar em `docs/okf/concepts/security.md` que o header é restrito a TLS-only e nunca ecoado para upstream.

- [x] **Step-up auth para `/api/host/telemetry` (e futuros endpoints sensíveis):**
  - Adicionar campo `Session.RequireStepUp bool` em `internal/auth/session.go`. Quando `true`, o handler exige header `X-Dl-Conn-StepUp: <HMAC do sessionID + serverSecret + timestamp5min>`.
  - HMAC: SHA-256 sobre `sessionID || serverSecret || (nowSec / 300)` com janela de 5 min para evitar replay.
  - `serverSecret` derivado de `nostr.daemonKeypair` em boot, persistido apenas em memória.
  - Frontend: `web/js/session_manager.js` adiciona método `requestStepUp()` que faz `fetch('/api/auth/stepup', {method: 'POST'})` (rota emite um token de step-up com TTL de 5 min) e guarda o header em memória. `fetchTelemetry` (e qualquer futuro caller de endpoint sensível) consulta `sessionManager.getStepUpHeader()` antes de montar o request.
  - Default: step-up **opt-in** via `config.yaml > auth.stepUpProtected: ["telemetry"]`. Lista vazia = comportamento atual mantido (não breaking).
  - Atualizar `internal/auth/auth_test.go` com `TestStepUpEndToEnd` (emite step-up, anexa header, recebe 200; sem step-up recebe 401; step-up expirado recebe 401).

- [x] **Zero-on-exit da `nsec` no Go:**
  - Em `cmd/dl_conn/main.go:139` (`nostr.NewClient(nsecHex, ...)`), após o construtor retornar, zerar o slice: `for i := range nsecBytes { nsecBytes[i] = 0 }`. Necessário porque `go-nostr` faz uma cópia interna, mas a string original vive na `runtime` até GC.
  - Usar `nostrSec := []byte(nsecHex)` no nível de `main`, passar `string(nostrSec)` para o construtor, e fazer `clear(nostrSec)` em seguida (Go 1.21+, `unsafe` não necessário).
  - Adicionar `runtime.SetFinalizer` no wrapper Go de `KeyPair` (`internal/nostr/crypto.go:92`) que zeroa `PrivateKeyHex` quando o objeto for descartado. Marcar como **melhor esforço** — não é garantia, é mitigação.
  - Atualizar `cmd/dl_conn/main_test.go` com inspeção via `runtime.MemStats` mostrando que `Sys` não aumenta desproporcionalmente após múltiplas operações (smoke test).

- [x] **Limpar `Authorization` em telemetria também:**
  - `internal/telemetry/handler.go` é endpoint interno (`/api/host/telemetry`), não passa pelo `proxy.Router`, mas o `curl` malicioso ainda pode enviar `Authorization: Bearer <otherServiceSession>`. Confirmar que o handler **não** propaga `Authorization` para nenhum lugar (já é o caso — leitura apenas). Documentar explicitamente.

- [x] **Atualizar `docs/okf/concepts/security.md`:**
  - Adicionar subseção "Token surface area" descrevendo a transição `GET → POST`, com timeline de deprecação.
  - Adicionar subseção "Step-up auth" referenciando o HMAC e a janela de 5 min.
  - Adicionar subseção "Key lifecycle" explicando a zeragem pós-uso (com disclaimer: não é defesa forte contra atacante com `ptrace`).

## Onde isso vive no código

- `internal/auth/handler.go` (passos 1, 2)
- `internal/auth/auth_test.go` (passos 1, 3)
- `internal/auth/session.go` (passo 3)
- `internal/config/config.go` (passo 3 — `auth.stepUpProtected`)
- `internal/nostr/crypto.go` (passo 4)
- `cmd/dl_conn/main.go` (passo 4)
- `cmd/dl_conn/main_test.go` (passo 4)
- `web/js/session_manager.js` (passo 3)
- `web/js/api_client.js` (novo, wrapper de `fetch` que injeta step-up header — passo 3)
- `web/app.js` (passos 1, 3 — substituir `window.location.href = "/auth?token=..."` por fetch POST)
- `docs/okf/concepts/security.md` (passo 6)

## Critérios de Aceite (Definition of Done)

1. `curl -X POST -d "token=..." https://<tunnel>/auth -H "Content-Type: application/x-www-form-urlencoded"` emite cookie e responde `200 {"redirect": ...}`. `TestAuthPostFlow_Valid` passa.
2. `curl -X GET https://<tunnel>/auth?token=...` continua funcionando (compat). Resposta traz `Warning: 299 - "Use POST"`. `TestAuthGetDeprecation` passa.
3. `curl -H "X-Dl-Conn-Token: ..." https://<tunnel>/auth` aceita o token via header. `TestAuthHeaderToken` passa.
4. Step-up end-to-end: cliente emite step-up via `POST /api/auth/stepup`, anexa header em `GET /api/host/telemetry`, recebe `200`. Header fora de 5 min ou ausente → 401. `TestStepUpEndToEnd` passa.
5. Inspeção de `/proc/<pid>/maps` + leitura da heap após o daemon aceitar uma `nsec` não revela a string hex em janela curta. Smoke test em `cmd/dl_conn/main_test.go` valida que `clear(nostrSec)` zera o slice imediatamente (afirma `nostrSec[i] == 0` para todo `i`).
6. `web/js/session_manager.js` expõe `getStepUpHeader()` síncrono; `fetchTelemetry` o consome sem mudança de comportamento observável para o usuário.
7. `go test ./...`, `golangci-lint run`, `go vet ./...` verdes.
8. `node web/tests/*.js` verdes (testes do frontend não dependem de step-up para os fluxos atuais).
9. README.md e `docs/runbook.md` ganham menção breve à nova rota `/api/auth/stepup` e ao header `X-Dl-Conn-Token` (na seção "Operação").
## Notas de arquivamento (2026-10-02)

Implementado com três divergências em relação ao enunciado:

- **Segredo do step-up é sorteado por processo.** O texto previa derivá-lo de
  `nostr.daemonKeypair`; essa opção não existe em `config.NostrConfig` (só
  `nsec`, `nsecFile`, `relays`, `authorizedNpubs`, `fallbackNip04`).
  `crypto/rand` no boot é mais simples, igualmente sem estado em disco, e a
  invalidação no restart é o comportamento desejado.
- **A SPA redenciona via form-POST, não via `fetch()`.** A SPA é servida de
  outra origem que o túnel, e o Chrome moderno bloqueia o `Set-Cookie`
  cross-origin vindo de um `fetch()` (sub-resource request cai no bucket
  de cookie de terceiro); sem cookie, a sessão não é estabelecida e o
  clique no card volta para a tela de login. A redenção hoje monta um
  `<form method="POST">` oculto, com `token`/`redirect` em `hidden`,
  e chama `form.submit()` — uma navegação top-level, contexto
  first-party para cookie no destino, `303 See Other` do daemon
  carrega o cookie até o serviço. A URL aberta **não leva token
  nenhum**. (Antes desta correção a redenção era
  `fetch(..., {mode: "no-cors"})`; o `no-cors` continua valendo para
  qualquer outro caller que use `fetch`, mas o caminho nativo da SPA é
  o form.)
- **Zero-on-exit cobre o buffer que o daemon controla.** O texto pedia também
  `clear()` sobre a string da `nsec`; string em Go é imutável, então
  atribuir `""` não zera memória — e o `ineffassign` foi o sinal correto de que
  aquilo era código morto. Ficou: buffer próprio zerado inclusive no caminho de
  erro, finalizador em `nostr.DeriveKeyPair`, e um texto honesto sobre o que
  isso não promete. `clearStepUp()` no lock/logout.
