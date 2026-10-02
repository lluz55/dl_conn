---
type: task
phase: 15
status: done
title: "Fase 15 — Segurança: endurecimento de headers e rate limiting"
description: "Quick wins de segurança: filtração do header Authorization antes do proxy, HSTS, Permissions-Policy, rate limit em /auth e /api/host/telemetry, e anonimização de IP em logs."
timestamp: 2026-10-02T17:30:00Z
---

# Fase 15 — Segurança: endurecimento de headers e rate limiting

## Objetivo

Fechar vetores de exfiltração e negação de serviço de baixo custo na borda do daemon (Go), sem alterar o protocolo Nostr nem o layout da SPA. Todos os itens desta fase tocam exclusivamente `internal/` e exigem regressão na suite existente (`go test ./internal/...`, `golangci-lint run`).

## Contexto

Análise de superfície de ataque conduzida em 2026-10-02 identificou que:

- `internal/proxy/router.go` propaga o header `Authorization: Bearer <sessionID>` para os serviços configurados em `services[]`, enquanto já remove esse mesmo header em `internal/proxy/dynamic_ports.go:84`. Falta simetria.
- `cmd/dl_conn/main.go:412-421` (`securityHeaders`) cobre CSP, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, mas **omite** `Strict-Transport-Security` e `Permissions-Policy`.
- `internal/auth/handler.go` e `internal/telemetry/handler.go` não impõem rate limit. Um atacante pode saturar o mapa de tokens efêmeros ou o coletor SQLite.
- `internal/auth/session.go:89` registra o IP integral em `log.Printf`. Em deployments onde `journalctl` é exportado (Datadog, Loki, Sentry), isso vaza PII.

## Sub-tarefas

- [x] **Remover `Authorization` antes do `ReverseProxy.ServeHTTP` em `internal/proxy/router.go`:**
  - No `proxy.Director` (já captura o request antes do `origDir(req)`), fazer `req.Header.Del("Authorization")` sempre que a sessão estiver vinculada a um cookie HTTP — **mesma política** já aplicada em `internal/proxy/dynamic_ports.go:84`.
  - Manter `Authorization` intacto apenas quando o upstream for explicitamente configurado para receber credenciais (e.g. serviços com autenticação HTTP Basic interna) — adicionar campo `service.forwardAuthorization bool` em `internal/config/config.go` com default `false` e documentar em `security.md`.
  - Atualizar `internal/proxy/proxy_test.go` com caso `Authorization_DroppedByDefault` que comprova a remoção e o caso `Authorization_PreservedWhenConfigured`.

- [x] **Adicionar `Strict-Transport-Security` no `securityHeaders` (`cmd/dl_conn/main.go`):**
  - Valor literal `"max-age=63072000; includeSubDomains"` (dois anos).
  - Aplicar **apenas** quando o request chegar via HTTPS (verificar `r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"`). Em acesso LAN HTTP o header é ignorado por spec, mas adicionar a guarda evita "downgrade log warning" desnecessário.
  - Cobrir com teste de unidade inspecionando `httptest.ResponseRecorder` em `cmd/dl_conn/main_test.go` (criar arquivo novo, suíte `TestSecurityHeadersHSTS`).

- [x] **Adicionar `Permissions-Policy` no `securityHeaders`:**
  - Valor: `"camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"`.
  - `camera=(self)` é necessário porque o `qr_scanner.js` acessa `getUserMedia` quando o usuário opta por "Ler nsec via QR". Os demais ficam negados por padrão.
  - Manter sincronizado com `web/index.html` se algum dia a política for duplicada via `<meta>` (hoje só via header).

- [x] **Cookie `Partitioned` em `internal/auth/session.go` `SetSessionCookie` / `setServiceCookie` / cookies emitidos em `bootstrapLaunchSession`:**
  - Setar `Partitioned: true` quando o browser aceitar (CHIPS — Chrome 114+, Firefox em desenvolvimento). Detectar via `r.UserAgent()` parseando major version: se Chrome ≥114 ou Firefox ≥120, setar o campo.
  - Padrão alternativo se detecção for frágil: ler feature flag `auth.partitionedCookies: bool` em `config.yaml` (default `false` até CHIPS estar habilitado em Chrome estável).
  - Atualizar `internal/auth/auth_test.go` para validar presença do atributo em casos configurados.

- [x] **Rate limit em `/auth` por `Cf-Connecting-Ip`:**
  - Usar `golang.org/x/time/rate` (adicionar como dependência em `go.mod`).
  - Bucket `10 req/s` por IP, com burst de 20. Configurável via `auth.rateLimitPerSec float64` e `auth.rateLimitBurst int` em `internal/config/config.go` (defaults acima).
  - Aplicar **antes** de chamar `TokenManager.ConsumeWithReason` em `internal/auth/handler.go:51`. Resposta `429 Too Many Requests` com header `Retry-After: 1`.
  - Limpar buckets inativos a cada 5 min (goroutine análoga a `tokenMgrCleanup`).
  - Teste: `TestAuthRateLimit` em `internal/auth/auth_test.go` dispara 30 requests em 200ms do mesmo IP, espera ≥1 resposta `429`.

- [x] **Cache de 1 s + rate limit em `/api/host/telemetry`:**
  - `internal/telemetry/handler.go`: cachear a última `Snapshot` (já serializada como JSON) por 1 s; quando múltiplos clientes pollarem no mesmo segundo, todos recebem o mesmo payload.
  - Adicionar rate limit por sessão (`auth.SessionManager.ID → rate.Limiter`) — bucket 1 req/s, burst 5. Sessões sobre o limite recebem `429`.
  - Log de cada `429` com `sessionPrefix` (já existe padrão em `auth.tokenPrefix`).
  - Atualizar `internal/telemetry/handler_test.go` com caso de cache hit (segundo request retorna payload idêntico sem segunda coleta).

- [x] **Bloquear `<iframe>` como destino de redirect em `auth.IsDocumentNavigation`:**
  - Em `internal/auth/login_redirect.go:42`, alterar a condição para que `Sec-Fetch-Dest: iframe` **não** seja tratado como navegação válida para o redirect. Manter `document` apenas.
  - Requests em iframe recebem `403` direto (mesmo padrão dos demais não-navegação).
  - Mitiga `X-Frame-Options` inconsistente (o daemon põe DENY no SPA mas não nas rotas autenticadas).
  - Atualizar `internal/auth/login_redirect_test.go` com caso `TestIframeNotRedirected`.

- [x] **Anonimização de IP em logs (opt-in):**
  - Em `internal/auth/session.go:89` (`log.Printf("session denied: ... reason=ip mismatch")`), truncar IPv4 nos últimos octetos (`10.0.66.*`) e IPv6 nos primeiros 48 bits. Implementar helper `internal/auth/logip.go` `Anonymize(ip string) string`.
  - Flag `auth.logIPs bool` em `internal/config/config.go` (default `true` para retrocompatibilidade, mas com anonimização aplicada). Quando `false`, loga `[redacted]`.
  - Aplicar também em `internal/proxy/router.go:139`, `internal/proxy/dynamic_ports.go:101`, `internal/telemetry/handler.go`.
  - Teste de unidade cobrindo IPv4, IPv6, e IP inválido (`""`, `"::not-an-ip"`).

- [x] **Atualizar `docs/okf/concepts/security.md`:**
  - Adicionar subseção "Hardening de borda" enumerando os seis vetores acima e referenciando os arquivos modificados.
  - Atualizar `web-frontend-layout.md` se algum header HTTP impactar layout (não é o caso, só referência cruzada).

## Onde isso vive no código

- `internal/proxy/router.go` (passos 1, 8)
- `internal/proxy/dynamic_ports.go` (passo 8)
- `internal/proxy/proxy_test.go` (passo 1)
- `internal/auth/handler.go` (passos 5)
- `internal/auth/session.go` (passos 4, 8)
- `internal/auth/login_redirect.go` (passo 7)
- `internal/auth/auth_test.go` (passos 4, 5)
- `internal/auth/login_redirect_test.go` (passo 7)
- `internal/config/config.go` (passos 1, 4, 5, 6, 8)
- `internal/config/config_test.go` (defaults)
- `internal/telemetry/handler.go` (passo 6)
- `internal/telemetry/handler_test.go` (passo 6)
- `cmd/dl_conn/main.go` (passos 2, 3)
- `cmd/dl_conn/main_test.go` (novo, passos 2, 3)
- `go.mod` / `go.sum` (passo 5 — `golang.org/x/time`)
- `docs/okf/concepts/security.md` (passo 9)

## Critérios de Aceite (Definition of Done)

1. `grep -rn "Authorization" internal/proxy/router.go` confirma a remoção do header antes de `proxy.ServeHTTP`. O teste `Authorization_DroppedByDefault` passa.
2. `curl -sI https://<tunnel>/ | grep -i strict-transport-security` retorna o header em resposta a um request HTTPS; ausente em request HTTP LAN. `TestSecurityHeadersHSTS` passa.
3. `curl -sI https://<tunnel>/ | grep -i permissions-policy` retorna a política completa. `TestSecurityHeadersPermissionsPolicy` passa.
4. Cookie de sessão tem atributo `Partitioned` quando o User-Agent declara Chrome ≥114 ou Firefox ≥120; ausente caso contrário. `TestSessionCookiePartitioned` passa.
5. Disparar 100 requests em 1 s para `/auth` do mesmo IP retorna ≥1 `429`. `TestAuthRateLimit` passa.
6. Dois requests em sequência para `/api/host/telemetry` dentro de 1 s retornam payload idêntico (cache hit) **e** dois requests com sessão diferente dentro do segundo burst ambos retornam antes do 429. `TestTelemetryCacheAndRateLimit` passa.
7. `<iframe src="https://<tunnel>/frigate/">` recebe `403` em vez do HTML do login. `TestIframeNotRedirected` passa.
8. `journalctl -u dl-conn | grep "ip mismatch"` mostra IPs anonimizados (`10.0.66.*`, `2001:db8:123::*`). `TestLogIPAnonymize` passa.
9. `go test ./...`, `golangci-lint run`, `go vet ./...` verdes.
10. `dl-conn.nix` ainda produz binário (a dependência `golang.org/x/time` é leve — não infla o orçamento `CLI_BUDGET_MB`).
## Notas de arquivamento (2026-10-02)

Implementado com três divergências em relação ao enunciado, todas decididas
contra o texto original porque a versão escrita tinha um problema concreto:

- **`Partitioned` por config, não por User-Agent.** O texto pedia detectar
  Chrome ≥114 / Firefox ≥120 no `r.UserAgent()`. User-Agent é trivialmente
  falsificável e é justamente o cabeçalho que um cliente não precisa fingir;
  além disso, o attribute é ignorado por browsers que não o implementam, então
  o custo de errar para o lado "ligado" é nulo. Virou
  `auth.partitionedCookies` (padrão `false`).
- **Rate limit de `/auth` fica depois do atalho de sessão já válida.** O texto
  pedia aplicá-lo antes de `ConsumeWithReason`; ele está exatamente ali, mas a
  validação de cookie existente — que não consome token nem cria sessão — ficou
  antes. Atingi-la significaria castigar tráfego legítimo (a SPA reentrando em
  `/auth` com sessão viva) para proteger uma operação que não tem custo.
- **Rate limit por `Cf-Connecting-Ip`, nunca `X-Forwarded-For`**, coerente com
  a decisão já registrada em `auth.ClientIP`: `X-Forwarded-For` é um header
  comum que o `cloudflared` apenas repassa, então quem fala com o daemon em LAN
  poderia forjá-lo e esgotar o bucket de outro cliente.

`golang.org/x/time` entrou em `go.mod` (aprovado explicitamente); o
`vendorHash` de `dl-conn.nix` foi atualizado por consequência mecânica. Findings
do `golangci-lint` inalterados: 41 = 41.
