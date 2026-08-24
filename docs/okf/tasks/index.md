---
type: index
title: "Índice de Tarefas de Implementação (OKF)"
description: "Roteiro por fases para a implementação do dl_conn (Go Daemon + Nostr Signaling + Cloudflare Ephemeral Tunnel + GitHub Pages SPA)."
timestamp: 2026-08-23T16:00:00Z
---

# Índice de Tarefas de Implementação — `dl_conn`

Este diretório contém o planejamento detalhado e rastreável de implementação do projeto **`dl_conn`** seguindo o padrão **Open Knowledge Format (OKF)**.

O objetivo do projeto é expor e acessar de forma segura serviços locais rodando no host NixOS (`n100`) — tais como Home Assistant, Frigate e Zigbee2MQTT — através de um **túnel efêmero da Cloudflare (`trycloudflare.com`)**, utilizando **Nostr (NIP-44)** para sinalização segura/descoberta, **Gatekeeper em Go com tokens/cookies** para controle de acesso Zero-Trust e uma **Single-Page Application estática no GitHub Pages** como cliente universal.

---

## Tabela de Fases

| # | Fase | Arquivo | Status | Progresso |
|---|------|---------|--------|-----------|
| 1 | Fundação e Configuração Nix | [01-fundacao.md](01-fundacao.md) | ✅ concluída | 5/5 |
| 2 | Gerenciador de Túnel Cloudflare | [02-tunnel-manager.md](02-tunnel-manager.md) | ✅ concluída | 5/5 |
| 3 | Sinalização Nostr & Criptografia NIP-44 | [03-nostr-signaling.md](03-nostr-signaling.md) | ✅ concluída | 5/5 |
| 4 | Gatekeeper Auth & Proxy Reverso Multiplexador | [04-auth-proxy.md](04-auth-proxy.md) | ✅ concluída | 6/6 |
| 5 | Frontend Estático (GitHub Pages SPA) | [05-frontend-ghpages.md](05-frontend-ghpages.md) | ✅ concluída | 6/6 |
| 6 | Módulo NixOS, SOPS & Validação E2E | [06-nixos-e2e.md](06-nixos-e2e.md) | ✅ concluída | 5/5 |
| 7 | Diagnóstico e Teste de Relays no Frontend | [07-relay-testing.md](07-relay-testing.md) | ✅ concluída | 6/6 |
| 8 | Cofre Cifrado de Sessão (PIN / Biometria) | [08-session-vault-auth.md](08-session-vault-auth.md) | ✅ concluída | 6/6 |

---

## Convenções de Rastreamento
* Cada sub-tarefa é representada por um item de checklist Markdown (`- [ ]` / `- [x]`).
* Cada fase possui critérios claros de "Definição de Concluído" (*Definition of Done*) e testes de verificação empírica.
