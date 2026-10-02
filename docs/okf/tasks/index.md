---
type: index
title: "Índice de Tarefas de Implementação (OKF)"
description: "Roteiro por fases para a implementação do dl_conn (Go Daemon + Nostr Signaling + Cloudflare Ephemeral Tunnel + GitHub Pages SPA)."
timestamp: 2026-08-26T19:30:00Z
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
| 9 | QR do keygen para auto-preenchimento do nsec no frontend | [09-keygen-qr-login.md](09-keygen-qr-login.md) | ✅ concluída | 6/6 |
| 10 | Sessão efêmera no login por nsec e feedback da descoberta | [10-nsec-session-start.md](10-nsec-session-start.md) | ✅ concluída | 6/6 |
| 11 | Autorizar npubs com o daemon em execução | [11-runtime-npub-authorization.md](11-runtime-npub-authorization.md) | ✅ concluída | 7/7 |
| 12 | Serviço verde só após confirmação de atividade | [12-service-health-status.md](12-service-health-status.md) | ✅ concluída | 6/6 |
| 13 | `keygen files`: npub e nsec em arquivos separados | [13-keygen-files.md](13-keygen-files.md) | ✅ concluída | 9/9 |
| 14 | Telemetria completa do host no dashboard | [14-host-telemetry.md](14-host-telemetry.md) | ✅ concluída | 9/9 |
| 15 | Redesign definitivo do SPA (protótipo → produção) | [15-web-redesign.md](15-web-redesign.md) | ✅ concluída | 10/10 |
| 16 | Serviços personalizados no frontend | [16-custom-frontend-services.md](16-custom-frontend-services.md) | ✅ concluída | 9/9 |

### Trilha de segurança, performance e usabilidade (2026-10-02)

Análise de superfície de ataque e de custo lançou 6 fases novas. Elas recebem
**prefixo de trilha** no nome do arquivo (`s` segurança, `p` performance, `u`
usabilidade) porque a numeração solta já estava ocupada — a fase 15 do índice
acima é o redesign do SPA, e a 16 é o de serviços personalizados. Manter
`15-…`/`16-…` para as novas criaria duas tabelas de fases contraditórias no
mesmo repositório.

| #   | Trilha  | Fase                                                   | Arquivo                                             | Status          | Progresso |
|-----|---------|--------------------------------------------------------|-----------------------------------------------------|-----------------|-----------|
| S15 | Segurança | Endurecimento de headers e rate limiting               | [s15-security-hardening.md](s15-security-hardening.md) | ✅ concluída   | 9/9 |
| S16 | Segurança | Autenticação avançada (POST/header, step-up, zero-on-exit) | [s16-security-auth-advanced.md](s16-security-auth-advanced.md) | ✅ concluída | 6/6 |
| S17 | Segurança | NIP-42 AUTH no daemon + conserto do startup hung do S15 | [s17-nip42-daemon-auth.md](s17-nip42-daemon-auth.md) | ✅ concluída | 6/6 |
| P17 | Performance | Binário Go e bundle web                              | [p17-perf-binary-web.md](p17-perf-binary-web.md)     | ⏳ pendente      | 0/9 |
| P18 | Performance | Hot path do proxy e polling                           | [p18-perf-hotpath.md](p18-perf-hotpath.md)           | ⏳ pendente      | 0/10 |
| U19 | Usabilidade | Feedback de descoberta e renovação                    | [u19-usability-discovery.md](u19-usability-discovery.md) | ⏳ pendente  | 0/9 |
| U20 | Usabilidade | Mobile flow e biometria PRF                           | [u20-usability-mobile-prf.md](u20-usability-mobile-prf.md) | ⏳ pendente | 0/10 |

Bloqueios cruzados: **P20 depende de P17** (o split de `app.js` em módulos ES é
pré-requisito da reorganização dos cards em `index.html`) e **P18 depende de
P17** (o fingerprint por hash pressupõe `web/_min/`). **S15 não bloqueia nada**
e foi o ponto de partida natural.

P17 teve dois itens deliberadamente colocados fora de escopo em 2026-10-02
(troca do driver SQLite para CGO, e o pipeline de minify no Nix); o frontmatter
do arquivo registra o quê e o porquê.

---

## Convenções de Rastreamento
* Cada sub-tarefa é representada por um item de checklist Markdown (`- [ ]` / `- [x]`).
* Cada fase possui critérios claros de "Definição de Concluído" (*Definition of Done*) e testes de verificação empírica.
