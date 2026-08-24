---
type: task
phase: 1
status: done
title: "Fase 1 — Fundação e Configuração Nix"
description: "Estruturação do repositório Go, flake.nix, devShells e carregador de configuração (YAML/Env)."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 1 — Fundação e Configuração Nix

## Objetivo
Configurar a estrutura base do projeto Go em `/home/lluz/dev/dl_conn`, garantindo reprodutibilidade no NixOS através de `flake.nix` e estabelecendo a camada de configuração declarativa para o daemon.

## Sub-tarefas

- [x] **Módulo Go e Estrutura de Diretórios:**
  - Inicializar `go mod init dl_conn` com Go 1.22+.
  - Criar árvore padrão de pacotes:
    - `cmd/dl_conn/main.go` (Entrypoint)
    - `internal/config/` (Parser e validação de schema)
    - `internal/tunnel/` (Gerenciador do subprocesso `cloudflared`)
    - `internal/nostr/` (Cliente e handlers NIP-44)
    - `internal/auth/` (Tokens efêmeros e sessões)
    - `internal/proxy/` (Proxy reverso HTTP/WebSocket)
    - `web/` (Frontend SPA estático)
- [x] **Ambiente de Desenvolvimento Nix (`flake.nix`):**
  - Definir `flake.nix` com `devShells.default` contendo: `go`, `gopls`, `golangci-lint`, `cloudflared`, `git`.
  - Definir pacote `packages.default` via `pkgs.buildGoModule`.
- [x] **Esquema de Configuração Declarativa (`internal/config`):**
  - Modelar structs em Go para suporte a YAML e variáveis de ambiente:
    - `NostrConfig`: `nsec` (ou path de arquivo de segredo), `relays` (lista de URLs WS), `authorized_npubs` (whitelist de chaves públicas autorizadas).
    - `TunnelConfig`: porta local de escuta (default `9099`), binário `cloudflared` customizável, timeout de inatividade.
    - `ServiceConfig`: lista de serviços com `id`, `name`, `icon`, `prefix`, `target` (ex: `http://10.0.66.1:8123`), `strip_prefix` e flag `websocket`.
    - `AuthConfig`: tempo de vida do token de uso único (ex: 120s), TTL do cookie de sessão (ex: 4h).
- [x] **Arquivo de Exemplo (`config.example.yaml`):**
  - Criar arquivo modelo documentado cobrindo Home Assistant, Frigate e Zigbee2MQTT.
- [x] **Testes Unitários:**
  - Testes de parsing e validação de regras de negócio (ex: rejeição se `authorized_npubs` estiver vazio, portas inválidas, etc.).

## Onde isso vive no código
- `flake.nix`
- `go.mod`, `go.sum`
- `cmd/dl_conn/main.go`
- `internal/config/config.go`
- `internal/config/config_test.go`
- `config.example.yaml`

## Critérios de Aceite (Definition of Done)
1. ✅ `nix develop` inicializa o ambiente com Go e `cloudflared` prontos.
2. ✅ `go build ./cmd/dl_conn` compila sem erros ou warnings.
3. ✅ Leitura e validação de `config.example.yaml` com 100% de testes unitários passando.
