---
type: task
phase: 12
status: done
title: "Fase 12 — Serviço verde só depois de confirmado ativo"
description: "O daemon sonda o target local de cada serviço e envia `status` (up/down/unknown) na resposta Nostr; o dashboard pinta o ponto verde apenas para `up`."
timestamp: 2026-08-26T00:00:00Z
---

# Fase 12 — Serviço verde só depois de confirmado ativo

## Problema

O ponto verde do card de serviço no dashboard (`renderServices`,
`web/app.js`) era ligado por `svc.websocket` — um **flag de configuração**
(`services[].websocket` no `config.yaml`), não uma observação. Um serviço
desligado, com a porta fechada ou nem instalado aparecia verde ("Live") desde
o primeiro instante da fase `live`, só porque estava listado no YAML. O
usuário só descobria o contrário ao clicar em "Abrir" e receber o
`502 upstream service unavailable` do `proxy.Router`.

## Decisões desta fase

1. **Quem confirma é o daemon, não a SPA.** O host já conhece
   `services[].target` e fala com ele por rede local; a SPA teria de sondar
   pelo túnel, o que exigiria headers CORS no proxy e gastaria requisições
   pelo `trycloudflare.com`. **Consequência assumida:** o status viaja no
   payload da descoberta, então o dashboard mostra o estado do último probe,
   não um stream ao vivo — ele atualiza a cada nova resposta do host.
2. **Probe = dial TCP, não GET HTTP.** Alvos podem não ser HTTP, e serviços
   vivos respondem 401/404 em `/` (Frigate, Zigbee2MQTT). A pergunta aqui é
   alcançabilidade.
3. **`unknown` é um estado de primeira classe.** Enquanto o primeiro probe não
   volta, o serviço não é verde nem vermelho — cinza esmaecido. Nunca inventar
   verde por ausência de informação.

## Sub-tarefas

- [x] **`internal/health` (novo) — `Monitor`:** `New(services)` inicia todos em
  `StatusUnknown`; `Run(ctx)` sonda tudo na hora e depois a cada 30 s
  (`DefaultInterval`), com timeout de 3 s por alvo; `Status(id)` sob `RWMutex`
  devolve `unknown` para IDs desconhecidos em vez de erro.
- [x] **`ServiceInfo.Status`** (`internal/nostr/protocol.go`): campo
  `status` no JSON cifrado, valores `up` / `down` / `unknown`.
- [x] **Status fresco no momento da resposta:** `Handler.SetStatusFunc` +
  `servicesWithStatus()` carimbam uma **cópia** do slice a cada DM
  (`internal/nostr/handler.go`) — o slice do handler não é mutado, e a resposta
  nunca carrega o status congelado na construção.
- [x] **Wiring** (`cmd/dl_conn/main.go`): `health.New(cfg.Services)` +
  `go monitor.Run(ctx)`, `handler.SetStatusFunc(monitor.Status)`, e
  `Status: health.StatusUnknown` no mapeamento inicial de `serviceInfos`.
- [x] **Frontend** (`web/app.js`, `web/style.css`): `statusDot(svc)` mapeia
  `up → .dot-good` ("Ativo"), `down → .dot-bad` ("Inativo"),
  qualquer outra coisa → `.dot-unknown` ("Aguardando confirmação do host").
  O `data-status` fica no DOM para teste/depuração.
- [x] **Testes:** `internal/health/monitor_test.go` (estado inicial `unknown`,
  listener real → `up`, porta fechada e URL inválida → `down`, defaults de
  porta por esquema) e `TestHandler_ServicesWithStatus` em `nostr_test.go`.

## Onde isso vive no código

- `internal/health/monitor.go` (novo), `internal/health/monitor_test.go`
- `internal/nostr/protocol.go` (`ServiceInfo.Status`), `internal/nostr/handler.go`
- `cmd/dl_conn/main.go` (monitor + `SetStatusFunc`)
- `web/app.js` (`statusDot`), `web/style.css` (`.dot-unknown`)

## Definition of Done

1. Com o serviço local parado, o card aparece **cinza/vermelho**, nunca verde.
2. Serviço no ar → verde na descoberta seguinte ao primeiro probe.
3. Antes de qualquer probe concluído, o estado é `unknown` (cinza).
4. `go test ./...` verde.

## Fora de escopo (fases futuras)

- Revalidação ao vivo pela SPA (exigiria CORS no proxy).
- Health check por HTTP com path/código esperado configurável por serviço.
- Intervalo/timeout de probe configuráveis no `config.yaml`.

Relacionado: [[11-runtime-npub-authorization]], [[04-auth-proxy]],
[web-frontend-layout](../concepts/web-frontend-layout.md),
[protocol](../concepts/protocol.md).
