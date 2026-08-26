---
type: task
phase: 11
status: pending
title: "Fase 11 — Autorizar npubs com o daemon em execução (CLI + reload)"
description: "Subcomando `dl_conn npubs add` grava a npub no config.yaml de forma atômica e sinaliza o daemon (SIGHUP) para recarregar a allowlist sem reiniciar o túnel."
timestamp: 2026-08-26T07:20:00Z
---

# Fase 11 — Autorizar npubs com o daemon em execução

## Problema

`nostr.authorizedNpubs` só é lido uma vez, na subida do processo:
`config.Load()` → `nostr.NewClient(..., cfg.Nostr.AuthorizedNpubs, ...)`
(`cmd/dl_conn/main.go:42,111`), que congela a whitelist em
`Client.authorized` (`internal/nostr/client.go:26`). Autorizar um novo
dispositivo hoje exige **editar o YAML à mão e reiniciar o serviço** — o que
derruba o túnel Cloudflare efêmero e portanto invalida a URL
`trycloudflare.com` já distribuída, além de matar as sessões vivas.

Consequência prática para quem está do outro lado: um `npub` fora da lista tem
seu DM descartado em silêncio por `ParseEvent`
(`internal/nostr/client.go:168`), e a SPA só consegue reportar o timeout de 30 s
introduzido na [[10-nsec-session-start]] — sem caminho de conserto que não seja
um restart.

## Decisões desta fase

1. **Interface: subcomando CLI**, não endpoint HTTP nem action Nostr. A
   operação é de administração do host, então exige acesso ao host — não
   amplia a superfície exposta pelo túnel.
2. **Persistência: o próprio `config.yaml`.** A lista continua tendo uma fonte
   única de verdade; não há segundo arquivo de estado para divergir.
   - **Consequência assumida:** sob NixOS o `--config` aponta para
     `/nix/store` (read-only, `nixos/module.nix:120`), então o comando
     **falha em voz alta** com instrução explícita: apontar
     `services.dl-conn.configFile` para um caminho gravável em
     `/var/lib/dl-conn` (o `StateDirectory`/`ReadWritePaths` já existem,
     `nixos/module.nix:136-138`). Nunca escrever silenciosamente noutro lugar.
3. **Escopo: só `add`.** `list`/`remove`, autorização por DM Nostr e convites
   com expiração ficam fora — ver "Fora de escopo".

## Sub-tarefas

- [x] **`internal/config` — `AddAuthorizedNpub(path, npub string) (bool, error)`:**
  valida com `nostr.DecodeNpub` (rejeita npub malformada; normaliza caixa, como
  o frontend já faz desde `608541f`); retorna `false, nil` sem tocar no arquivo
  se a npub já estiver na lista (idempotente).
- [x] **Edição preservando o arquivo:** usar `yaml.Node` (`gopkg.in/yaml.v3`)
  para inserir o item em `nostr.authorizedNpubs` mantendo comentários, ordem e
  indentação. **Não** re-serializar o struct `Config` — isso apagaria os
  comentários do `config.example.yaml` que os usuários copiam.
- [x] **Escrita atômica e fail-loud:** temp no mesmo diretório → `fsync` →
  `os.Rename`, preservando modo/dono do original; antes do rename, reler o
  resultado com `config.Load` + `Validate()` e abortar se inválido. Erro de
  permissão vira mensagem que cita a decisão 2 acima.
- [x] **`internal/nostr.Client` — allowlist mutável sob lock:** hoje
  `authorized` é escrito na construção e lido pela goroutine do `Serve` sem
  sincronização (`client.go:26,61,168`). Adicionar `sync.RWMutex`,
  `SetAuthorized([]string) error` e `IsAuthorized` sob `RLock`. O setter
  **sempre** reinsere a pubkey do próprio host, como `NewClient` faz
  (`client.go:46`) — recarregar não pode deixar o daemon sem falar consigo mesmo.
- [x] **`cmd/dl_conn/npubs.go` — subcomando cobra** no estilo de `keygen.go`:
  `dl_conn npubs add <npub> [--config path] [--json] [--no-reload]`. Saída
  humana (`added` / `already present` + total) e `--json` para script.
- [x] **Reload sem restart:** handler de `SIGHUP` em `main.go` que refaz
  `config.Load(configPath)` e chama `client.SetAuthorized(...)`, logando o novo
  total. **Só a allowlist recarrega** — relays, serviços e túnel seguem
  intactos (mudá-los continua exigindo restart; documentar isso na ajuda do
  comando). `ExecReload = kill -HUP $MAINPID` em `nixos/module.nix`.
  O CLI dispara o sinal sozinho (PID via `systemctl show -p MainPID dl-conn`);
  se não encontrar o processo, avisa para recarregar à mão em vez de silenciar.
- [x] **Testes:** `config_test.go` — add novo, duplicado, npub inválida,
  comentários preservados, config resultante inválido não substitui o original,
  arquivo read-only produz erro com a instrução do NixOS.
  `nostr_test.go` — `SetAuthorized` troca a whitelist, mantém a chave do host, e
  passa sob `-race` com leitura concorrente durante o swap.
  `cmd/dl_conn/npubs_test.go` — parsing de args e saída `--json`.

## Onde isso vive no código

- `internal/config/config.go` (`AddAuthorizedNpub`, escrita atômica)
- `internal/nostr/client.go` (`Client.authorized` + `RWMutex`, `SetAuthorized`)
- `cmd/dl_conn/npubs.go` (novo), `cmd/dl_conn/main.go` (registro do comando + SIGHUP)
- `nixos/module.nix` (`ExecReload`), `config.example.yaml` (comentário sobre o comando)

## Definition of Done

1. Com o daemon rodando, `dl_conn npubs add npub1…` autoriza o dispositivo e a
   descoberta de serviços passa a responder **sem restart** — a URL
   `trycloudflare.com` corrente continua válida.
2. Rodar o mesmo comando duas vezes não duplica a entrada nem reescreve o arquivo.
3. npub inválida e `config.yaml` read-only falham com mensagem acionável, sem
   deixar arquivo parcial nem config inválido em disco.
4. `go test ./... -race` verde.

## Fora de escopo (fases futuras)

- `npubs list` / `npubs remove`.
- Autorizar por DM Nostr (nova action em `internal/nostr/protocol.go`).
- Convites de uso único ou npub com expiração.

Relacionado: [[10-nsec-session-start]], [[03-nostr-signaling]],
[security](../concepts/security.md), [protocol](../concepts/protocol.md).
