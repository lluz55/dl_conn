---
type: task
phase: 18
status: pending
title: "Fase 18 — Performance: hot path do proxy e polling"
description: "Streaming rewrite + cache por ETag no ModifyResponse, índice por prefixo no Router, AbortController no fetchTelemetry, cache de resolver DNS, e headers de cache para a SPA estática."
timestamp: 2026-10-02T17:45:00Z
---

# Fase 18 — Performance: hot path do proxy e polling

## Objetivo

Reduzir latência p99 e uso de memória no caminho crítico (proxy reverso, polling de telemetria, probes de túnel). Sem alterar o protocolo ou a UX observável.

## Contexto

- `internal/proxy/router.go:127-137` (`RewriteAssetPaths`) faz `io.ReadAll(resp.Body)` em **toda** resposta reescrita. Para bundles de 2 MB+ (Frigate UI, Home Assistant Lovelace) isso aloca, parseia e re-serializa tudo em memória.
- `internal/proxy/router.go:403-421` (`matchService`) faz múltiplas comparações sequenciais por request. Escala pior que O(1) com número de serviços.
- `web/app.js:447` (`setInterval(fetchTelemetry, 2000)`) não aborta o `fetch` anterior; em rede ruim pode haver 2+ requests em voo.
- `internal/tunnel/manager.go:47-53` (`probeOnce`) instancia um novo `dialer` por probe — file descriptors e tempo de bootstrap desperdiçados.
- `cmd/dl_conn/main.go:301` serve `web/` com headers padrão — sem `Cache-Control` explícito além do `Last-Modified`.

## Sub-tarefas

- [ ] **Streaming rewrite no `ModifyResponse` (`internal/proxy/router.go:127`):**
  - Para respostas com `Content-Length > 1 MB`, usar `bufio.Scanner` em chunks de 64 KB.
  - Reescrever `Content-Length` após streaming e setar `Transfer-Encoding: chunked` se necessário.
  - Para respostas ≤ 1 MB, manter `io.ReadAll` (overhead de streaming não compensa).
  - Manter compat com WebSocket upgrade — `Hijacker()` deve permanecer intocado.
  - Adicionar teste `internal/proxy/proxy_test.go::TestStreamingRewriteLargeBody` com body de 3 MB e assert `len(receivedBody) == len(originalBody)`.

- [ ] **Cache de rewrite por `(prefix, etag)` (`internal/proxy/router.go:130`):**
  - Adicionar `sync.Map[string]CachedRewrite` indexado por `etag` + `prefix` (para evitar colisão entre serviços diferentes com mesmo `etag`).
  - Value: `[]byte` do body reescrito + timestamp.
  - TTL: 5 min (configurável). Cleanup via goroutine.
  - Quando o backend envia `ETag` e o body não mudou no backend, o daemon retorna o body cacheado sem chamar `io.ReadAll` no upstream.
  - Quando o backend envia `Last-Modified` e o cache tem versão mais nova, retornar `304 Not Modified` direto (sem chamada upstream).
  - **Gotcha**: invalidar cache quando `services[]` é recarregado em runtime (já existe hot-reload de `npubs`, replicar padrão).
  - Teste: `TestCacheRewriteHit` (segundo request com mesmo ETag não chama upstream — usar `httptest.Server` contador).

- [ ] **Índice por prefixo em `Router.matchService` (`internal/proxy/router.go:403`):**
  - Substituir loop sequencial por `prefixIndex map[string]ServiceConfig` construído no `NewRouter`.
  - Longest-prefix-match ainda necessário para `/local/<port>/...` — manter fallback para `dynamic.Match`.
  - Benchmark: `BenchmarkRouterMatchService_Sequential` vs `BenchmarkRouterMatchService_Indexed`. Esperado: −60% ns/op.
  - Adicionar benchmark em `internal/proxy/router_bench_test.go` (novo).

- [ ] **AbortController no `fetchTelemetry` (`web/app.js:422`):**
  - Manter `currentTelemetryAbort: AbortController` em escopo do módulo.
  - Antes de cada novo fetch, chamar `currentTelemetryAbort?.abort()` e instanciar novo controller.
  - Passar `signal` para o `fetch`.
  - Quando a aba volta a ficar visível (`document.visibilitychange`), fazer um `fetchTelemetry` imediato sem esperar o próximo tick do `setInterval`.
  - Teste manual em DevTools: throttling "Slow 3G", aba em background 30 s — só 1 request quando volta (não 15).

- [ ] **Pausar polling de telemetria com aba oculta (`web/app.js:447`):**
  - No handler atual (`app.js:458-459`), **inverter** a lógica: parar o `setInterval` quando `document.hidden === true`, retomar quando voltar a ficar visível.
  - Mostrar indicador visual discreto "telemetria pausada (aba oculta)" no `#status-rail` para o usuário não estranhar valores estáticos.
  - Confirmar com Playwright/Manual que após 5 min com aba oculta, a UI não atualizou (sem requests em Network tab).

- [ ] **Reuso de `Resolver` no `probeOnce` (`internal/tunnel/manager.go:47`):**
  - O `quickTunnelResolver` já é package-level (`tunnel/manager.go:24`). Falta passá-lo como `net.Dialer.Resolver` para o `probeOnce` em vez de montar `dialer` novo a cada chamada.
  - Mover instanciação de `dialer` para `NewManager`, guardar como `*Manager.tunnelProbeDialer`.
  - Quando o `Manager` for `Close()`ado, fechar `dialer` (se for um `*net.Dialer` com state — confirmar se relevante).
  - Teste em `internal/tunnel/manager_test.go`: medir `MaxOpenFDs` durante 100 probes — esperado ≤ 2 (1 atual + 1 idle), antes era 100.

- [ ] **Cache de probe (`internal/tunnel/manager.go:58`):**
  - O probe atual (`1.1.1.1:53` lookup) é idempotente por ~30 s. Cachear o resultado em `sync.Map[string]time.Time` por 30 s.
  - Quando o `trycloudflare.com` hostname está resolvido para IP válido, retornar do cache sem chamada de rede.
  - Benefício medido em testes: p99 do `probeOnce` cai de ~80 ms (DNS roundtrip) para <1 ms.

- [ ] **Headers de cache para a SPA (`cmd/dl_conn/main.go:301`):**
  - Servir `web/*.html`, `web/*.css`, `web/*.js` com `Cache-Control: public, max-age=300, must-revalidate` (5 min).
  - Servir arquivos em `web/vendor/` com `Cache-Control: public, max-age=86400, immutable` (vendor raramente muda entre releases).
  - Servir arquivos em `web/_min/` (após Fase 17) com hash no nome (`app.<sha8>.js`) e `Cache-Control: public, max-age=31536000, immutable` — versionamento por content hash.
  - `ETag` continua sendo gerado pelo `http.FileServer`; manter.
  - Atualizar `cmd/dl_conn/main_test.go` com `TestStaticCacheHeaders` validando o header correto por tipo de arquivo.

- [ ] **Adicionar `pprof` opcional atrás de flag (`cmd/dl_conn/main.go`):**
  - Flag `--pprof-addr :6060` (opt-in, default vazio = desabilitado).
  - Quando habilitada, importa `net/http/pprof` no mux secundário.
  - Permite debug futuro de regressões de performance sem inflar binário em produção.
  - Documentar em `docs/runbook.md` (seção "Diagnóstico").

- [ ] **Atualizar `docs/okf/concepts/performance.md`:**
  - Adicionar subseção "Hot path" com métricas observadas antes/depois (binário, latência, polling, cache).
  - Cross-link para `architecture.md` quando relevante.

## Onde isso vive no código

- `internal/proxy/router.go` (passos 1, 2, 3)
- `internal/proxy/proxy_test.go` (passos 1, 2)
- `internal/proxy/router_bench_test.go` (novo, passo 3)
- `internal/tunnel/manager.go` (passos 6, 7)
- `internal/tunnel/manager_test.go` (passos 6, 7)
- `web/app.js` (passos 4, 5)
- `web/tests/polling_tests.js` (novo, passos 4, 5 — fake timers jsdom)
- `cmd/dl_conn/main.go` (passos 8, 9)
- `cmd/dl_conn/main_test.go` (passo 8)
- `docs/okf/concepts/performance.md` (passo 10)
- `docs/runbook.md` (passo 9)

## Critérios de Aceite (Definition of Done)

1. `TestStreamingRewriteLargeBody` passa: body de 3 MB é reescrito byte-a-byte idêntico; alocação medida por `runtime.MemStats` ≤ 4 MB (antes: ~6 MB para o body + cópia).
2. `TestCacheRewriteHit`: dois requests consecutivos com mesmo `ETag`, segundo recebe body idêntico sem o `httptest.Server` registrar a chamada (`http.GetCount() == 1`).
3. `BenchmarkRouterMatchService_Indexed` é ≥ 60% mais rápido que `BenchmarkRouterMatchService_Sequential` em 10000 iterações.
4. DevTools Network: com aba em background 30 s, **zero** requests para `/api/host/telemetry`. Volta a pollar quando visível. `polling_tests.js` valida via fake timers + `visibilitychange` mockado.
5. `MaxOpenFDs` durante 100 probes ≤ 2 (`TestProbeReusesDialer`).
6. `TestProbeCacheHit`: 10 chamadas a `probeOnce` em 1 s geram apenas 1 lookup DNS (medido via fake `Resolver` mockado).
7. `TestStaticCacheHeaders`: HTML/JS/CSS recebem `max-age=300`; vendor recebe `max-age=86400`; `app.<sha8>.js` recebe `max-age=31536000`.
8. `--pprof-addr :6060` expõe `http://localhost:6060/debug/pprof/heap`; sem a flag, `/debug/pprof/*` retorna 404.
9. `go test ./...`, `golangci-lint run`, `go vet ./...`, `node web/tests/*.js` verdes.