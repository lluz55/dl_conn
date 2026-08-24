---
type: task
phase: 3
status: done
title: "Fase 3 — Sinalização Nostr & Criptografia NIP-44"
description: "Comunicação P2P criptografada sobre Nostr, escuta em múltiplos relays, validação de whitelist de npub e despacho de respostas."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 3 — Sinalização Nostr & Criptografia NIP-44

## Objetivo
Implementar a camada de descoberta e sinalização fora-de-banda em Go (`internal/nostr`), conectando o daemon a múltiplos relays Nostr, escutando solicitações criptografadas via **NIP-44** (com suporte opcional a NIP-04 como fallback), aplicando controle estrito de acesso por chave pública (`npub`) e respondendo com o payload de conexão.

## Sub-tarefas

- [ ] **Integração com SDK Nostr (`github.com/nbd-wtf/go-nostr`):**
  - Inicialização do cliente a partir da chave privada `nsec` (ou hex).
  - Conversões seguras entre formatos `nsec`/`npub` e hex.
- [ ] **Pool de Relays com Reconexão Contínua:**
  - Gerenciamento de conexões assíncronas com múltiplos relays (ex: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`).
  - Lógica de auto-reconexão e tratamento de desconexões de WebSocket dos relays.
- [ ] **Filtro de Eventos & Escuta Criptografada:**
  - Inscrição (`Subscription`) para eventos de mensagem direta (kind 4 / kind 1059 Gift Wrap) direcionados ao `npub` do host.
  - Ignorar e descartar silenciosamente mensagens enviadas por chaves públicas que **não** constem na whitelist (`authorized_npubs`).
- [ ] **Criptografia NIP-44 (Payloads Seguros):**
  - Descriptografar mensagens de requisição recebidas com NIP-44 (ChaCha20-Poly1305 + conversation key derivada por ECDH Secp256k1).
  - Validar a estrutura JSON da mensagem recebida (`{"action": "discover_services", ...}`).
- [ ] **Despacho de Respostas Criptografadas:**
  - Montar o JSON de resposta contendo: status, `tunnel_url`, `auth_token`, `expires_in_seconds` e catálogo de `services`.
  - Criptografar via NIP-44 direcionado à chave pública do solicitante e assinar com a chave do host (Schnorr Signature / NIP-01).
  - Publicar o evento em todos os relays conectados com confirmação de entrega.

## Onde isso vive no código
- `internal/nostr/client.go`
- `internal/nostr/crypto.go`
- `internal/nostr/handler.go`
- `internal/nostr/protocol.go`
- `internal/nostr/nostr_test.go`

## Critérios de Aceite (Definition of Done)
1. O daemon se conecta a pelo menos 2 relays Nostr simultâneos.
2. Mensagens enviadas por chaves não autorizadas são sumariamente ignoradas (zero vazamento de resposta).
3. Mensagem válida enviada por um `npub` autorizado dispara a geração de token e recebe a resposta criptografada em menos de 1.5s.
4. Testes automatizados cobrem decodificação de chaves, criptografia/descriptografia NIP-44 e validação de whitelist.
