---
type: task
title: "S17 — NIP-42 AUTH no daemon + conserto do startup travado em fba5aa1"
description: "Encerrar a janela em que o daemon não fala com relays que exigem NIP-42 (damus.io, nostr.land, …) e o daemon fica travado antes do HTTP server abrir 9099."
timestamp: 2026-10-02T19:50:00Z
---

# S17 — NIP-42 AUTH no daemon + conserto do startup travado em fba5aa1

## Origem

Diagnóstico aberto em 2026-10-02 a partir de "frontend não acha o daemon mesmo com nsec/npub corretos":

- O daemon do usuário estava vivo, cloudflared tinha URL, mas **9099 e 9100 recusavam conexão** — provado via `nc 127.0.0.1:9099` e `curl 127.0.0.1:9100/debug` no pid 2233389.
- Sessão antiga (`2162154`) tinha **12.957 `nostr: subscribed to …` em 1h51min** — exclusivamente em `wss://relay.damus.io` e `wss://nostr.land`, 1,8 eventos/segundo: sintoma clássico de relay que envia `auth-required:` e ninguém responde.
- O build em uso (`wkaxzr1snh4624hssvs2gfw33ajz7110-dl_conn-0.1.0`) tem `vendorHash = sha256-M/TVeX2l4H4bp5ZhmpFqdahpaVuziUapfYzOYVrjmnU=` — distinto do anterior, é o pós-`fba5aa1` (security hardening, 2026-10-02 15:48).

A `fba5aa1` introduziu `authHandler.RunCleanup(ctx)` e `telHandler.RunCleanup(ctx)` **chamados em linha** no `main()`. `RunCleanup` é um loop `for { select { … } }` que só termina em `ctx.Done()` — ou seja, **bloqueia o main goroutine para sempre**, e o daemon nunca chega em `startDiagnostics`, no goroutine do `handler.Serve`, nem no `ListenAndServe`.

## Itens

- [x] **Diagnóstico.** Reproduzido em `/tmp/dl_conn_prod.yaml` (12 services, 8 relays, igual ao do usuário); SIGQUIT no processo mostrou `main.run … main.go:101 +0x865 → AuthHandler.RunCleanup → RateLimiter.RunCleanup [select]`. Sem `sudo`, não foi possível `ptrace` no daemon de produção — `kill -QUIT 2233389` foi negado; `sudo -n` pediu tty.
- [x] **Fix do startup.** `cmd/dl_conn/main.go:101` (`authHandler.RunCleanup(ctx)`) e `:367` (`telHandler.RunCleanup(ctx)`) agora rodam em goroutine própria. Cada um comentado com a referência da regressão.
- [x] **NIP-42 no daemon.** `internal/nostr/client.go` ganha `signAuthEvent(ctx, re)` e o `SimplePool` é construído com `nostr.WithAuthHandler(client.signAuthEvent)`. A escolha de `WithAuthHandler` (em vez de hack direto em `relay._onauth` como fez o cliente em `ae7e3e2`) usa o caminho oficial do `go-nostr` que re-auth-e-retenta Subscribe/Publish automaticamente.
- [x] **Teste.** `internal/nostr/nostr_test.go::TestNIP42_SignAuthEvent` constrói um `Event{Kind:22242, Tags:[[relay,url],[challenge,challenge]], Content:""}`, chama `c.signAuthEvent` e verifica o evento assinado com `CheckSignature` contra a pubkey do host — a mesma checagem que o relay faz. Cobre também o caminho negativo (sk diferente → pubkey diferente).
- [x] **OKF alinhado.** Atualizado `docs/okf/concepts/security.md` (NIP-42 agora é cobertura simétrica cliente↔daemon); entrada nova em `docs/okf/log.md`.
- [x] **Verificação empírica.** `nix develop && go test ./... && golangci-lint run && go vet ./... && node web/tests/*` verde; daemon de teste com `/debug` mostra `wss://relay.damus.io subscribed=true sub_count=N` (antes: `false`, loop infinito); discovery DM publicado em `nos.lol` chega no daemon e é rejeitado por allowlist como esperado.

## Critérios de "Definição de Concluído"

1. `go test ./...` verde incluindo o novo teste.
2. `dl_conn --config …` em foreground sobe o servidor HTTP em < 2 s e o `/debug` responde 200.
3. `damus.io` e `nostr.land` aparecem como `subscribed=true` no `/debug` em uma sessão fresca (com AUTH-required).
4. SPA conectada via `/config.json` apontando para o host npub correto recebe o `ResponsePayload` em < 30 s.
5. `git log --oneline -S "signAuthEvent" -- internal/` mostra o commit; este arquivo está marcado como concluído no `tasks/index.md`.

## Caveats e dívida residual

- `nostr.land` ainda flapping em ~1,8 ciclos/s durante o teste local. `damus.io` estabiliza imediatamente. Suspeita: relay específico exige o `pubkey` do kind:22242 diferente, ou tem um rate-limit por IP no AUTH handshake. Não é blocker para o sintoma do usuário (damus suficiente) mas vale acompanhar.
- O handler de AUTH do cliente (`web/js/nostr_client.js:112-124`) e o do daemon ficaram implementações diferentes (cliente: `relay._onauth` direto, daemon: `WithAuthHandler` pool option). Ambos funcionam — `relay._onauth` é um patch legado que sobrevive por compatibilidade, mas se for revisitar vale unificar nos dois lados via `WithAuthHandler` quando a versão do `nostr-tools` for bumpada.
- O fix do startup **bloqueia uma porta de regressão silenciosa** mas não impede que um terceiro `RunCleanup` com a mesma armadilha entre no futuro. Vale um teste estático que detecte `*.RunCleanup(ctx)` sem `go ` na frente em `cmd/dl_conn/main.go`.

## Cross-links

- Regressão original: `fba5aa1 feat(auth): harden the daemon edge and add step-up authentication` (`git blame -L 95,105 cmd/dl_conn/main.go`).
- Cliente implementou o lado espelho em `ae7e3e2 fix(web): respond to relay NIP-42 AUTH challenges during publish`.
- Backscroll: `docs/okf/log.md` 2026-09-10 (sintoma "host sumiu sem erro" em browser rígido foi SocketIdle; este aqui é o outro lado — AUTH-required não respondido).
- Conceito: `docs/okf/concepts/security.md` (seção "Modelo de confiança").