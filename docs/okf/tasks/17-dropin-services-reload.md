---
type: task
phase: 17
status: completed
title: "Fase 17 — Serviços modulares drop-in (services.d) e recarga a quente sem root"
description: "Suporte a diretório drop-in (services.d/*.yaml), recarga atômica de serviços via SIGHUP e detecção automática sem restart do daemon."
timestamp: 2026-10-07T09:30:00Z
---

# Fase 17 — Serviços modulares drop-in e recarga a quente sem root

## Problema

Anteriormente, a lista `services:` no `config.yaml` era carregada uma única vez
durante a inicialização do daemon. O tratador de `SIGHUP` em `cmd/dl_conn/main.go`
recarregava apenas a allowlist de `authorizedNpubs`, mantendo `proxy.Router`,
`health.Monitor` e `nostr.Handler` imutáveis.

Além disso, sob NixOS com `DynamicUser = true`, a configuração do sistema reside em
caminhos restritos (`/nix/store` ou `/var/lib/dl-conn` sob UID dedicado), o que
exigia privilégios de `root` para edição e `systemctl restart dl-conn` para
adicionar novos serviços — o que derrubava o processo e rotacionava a URL
efêmera `*.trycloudflare.com` do túnel Cloudflare, invalidando sessões de usuários.

## Decisões desta fase

1. **Diretório Drop-in (`services.d` / `servicesDir`):**
   - Suporte a `--services-dir <path>` e `servicesDir: <path>` no `config.yaml` e
     no módulo NixOS (`services.dl-conn.servicesDir`).
   - Resolução padrão: `<configDir>/services.d` se o diretório existir.
   - Leitura lexicográfica de arquivos `*.yaml` e `*.yml`, ignorando arquivos
     ocultos, temporários ou de backup.
   - Suporte flexível a 3 formatos: objeto único de serviço, lista direta `[]` ou
     mapa wrapper `services: []`.
   - Mesclagem limpa: drop-ins podem sobrescrever serviços base por `id`, mas
     conflitos de prefixo entre IDs diferentes são rejeitados na validação.

2. **Hot-reload Concorrente e Thread-Safe:**
   - [`proxy.Router`](file:///home/lluz/dev/dl_conn/internal/proxy/router.go) ganha
     `sync.RWMutex`, `UpdateServices(services)` e leituras seguras em `matchService`,
     `ServeHTTP` e `rebuildProxy`.
   - [`health.Monitor`](file:///home/lluz/dev/dl_conn/internal/health/monitor.go) ganha
     `UpdateServices(services)`, preservando o estado de serviços existentes e iniciando
     novos em `StatusUnknown`.
   - [`nostr.Handler`](file:///home/lluz/dev/dl_conn/internal/nostr/handler.go) ganha
     `servicesMu` e `UpdateServices(services)` para anunciar serviços atualizados em DMs.

3. **Operação 100% Sem Root:**
   - Usuários não-privilegiados podem apontar `servicesDir` para caminhos que possuem
     permissão de escrita (ex: `~/.config/dl-conn/services.d` ou `/etc/dl-conn/services.d`).
   - O daemon monitora alterações na pasta (`watchServicesDir`) a cada 3 s via fingerprint
     de modtime/tamanho dos arquivos YAML. Ao detectar inclusão ou modificação, dispara a
     recarga automaticamente.
   - Administradores também podem forçar a recarga imediata via sinal `SIGHUP`
     (`systemctl reload dl-conn`).

## Sub-tarefas

- [x] **`internal/config/dropins.go`**: Implementação de `LoadServicesDir`, `MergeServices`
  e `ResolveServicesDir`.
- [x] **`internal/config/config.go`**: Campo `ServicesDir` no struct `Config`, e
  `LoadWithServicesDir`.
- [x] **`internal/proxy/router.go`**: Concorrência com `sync.RWMutex`, `UpdateServices`
  e `matchService` isolado.
- [x] **`internal/health/monitor.go`**: `UpdateServices` e proteção com `m.mu.RLock()`
  em `probeAll`.
- [x] **`internal/nostr/handler.go`**: `UpdateServices` e proteção com `servicesMu`.
- [x] **`cmd/dl_conn/main.go`**: Flag `--services-dir`, unificação do SIGHUP e
  watcher automático em background.
- [x] **`nixos/module.nix`**: Opção `servicesDir` repassada via CLI e permitida em
  `ReadOnlyPaths`.
- [x] **Testes**: Testes unitários com `-race` em todos os pacotes.

## Definition of Done

1. Adicionar ou editar um arquivo `.yaml` no diretório drop-in atualiza as rotas do proxy,
   o monitor de saúde e a descoberta Nostr sem reiniciar o daemon e sem derrubar o túnel.
2. Não exige permissão de root quando a pasta de drop-ins pertence ao usuário.
3. Testes unitários de `internal/config`, `internal/proxy`, `internal/health`,
   `internal/nostr` e `cmd/dl_conn` passam limpos sob o detector de corrida (`-race`).
