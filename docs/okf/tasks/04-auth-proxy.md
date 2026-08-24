---
type: task
phase: 4
status: done
title: "Fase 4 — Gatekeeper Auth & Proxy Reverso Multiplexador"
description: "Emissão de tokens efêmeros de uso único, cookies de sessão criptografados e proxy reverso Go com suporte a WebSockets e streaming de vídeo."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 4 — Gatekeeper Auth & Proxy Reverso Multiplexador

## Objetivo
Implementar o motor de autenticação e o proxy reverso em Go (`internal/auth` e `internal/proxy`), servindo como a barreira de segurança Zero-Trust entre o tráfego do Cloudflare e os serviços internos do host (Home Assistant, Frigate, Zigbee2MQTT).

## Sub-tarefas

- [ ] **Gerenciador de Tokens de Uso Único (`internal/auth/tokens.go`):**
  - Geração de tokens criptograficamente seguros (CSPRNG 256 bits codificado em base64url / hex).
  - Controle de TTL estrito (default 120 segundos) e invalidação imediata após o primeiro consumo (*one-time use*).
- [ ] **Gerenciador de Sessões com Cookies (`internal/auth/session.go`):**
  - Criação de ID de sessão após consumo bem-sucedido do token.
  - Emissão de cookie HTTP com flags: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - Armazenamento em memória com expiração/renovação deslizante e limpeza periódica de sessões expiradas.
- [ ] **Endpoint de Autenticação (`/auth`):**
  - Rota `GET /auth?token=...&redirect=...`:
    1. Valida o token recebido.
    2. Se válido: emite o cookie de sessão e redireciona (302/307) para o path solicitado (ex: `/frigate/` ou `/hass/`).
    3. Se inválido ou expirado: retorna `401 Unauthorized` com mensagem clara.
- [ ] **Proxy Reverso Baseado em Prefixo de Rota (`internal/proxy/router.go`):**
  - Uso de `net/http/httputil.ReverseProxy` para encaminhar requisições com base na tabela de serviços configurada (`ServiceConfig`).
  - Rewriting correto de headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` e remoção de prefixos (`StripPrefix`) quando configurado.
- [ ] **Suporte Completo a WebSockets & Streaming de Vídeo:**
  - Garantir o repasse dos cabeçalhos `Upgrade: websocket` e `Connection: Upgrade` (essencial para Home Assistant UI e Frigate event stream).
  - Configuração de flush periódico de chunks de dados HTTP para suporte a transmissões de vídeo MSE/HLS do Frigate sem buffering artificial.
- [ ] **Middleware Zero-Trust (Bloqueio Total na Borda):**
  - Qualquer requisição que não passe pelo endpoint `/auth` nem contenha um cookie de sessão válido ou header `Authorization: Bearer <token>` recebe imediatamente `403 Forbidden`.
  - Zero tráfego não-autenticado atinge as portas dos serviços locais.

## Onde isso vive no código
- `internal/auth/tokens.go`
- `internal/auth/session.go`
- `internal/auth/auth_test.go`
- `internal/proxy/router.go`
- `internal/proxy/proxy_test.go`
- `internal/proxy/hub.go`

## Critérios de Aceite (Definition of Done)
1. Requisição para rota protegida sem cookie/token retorna `403 Forbidden`.
2. Token válido no endpoint `/auth` gera cookie de sessão e redireciona para o serviço de destino.
3. Tentativa de reutilizar o mesmo token falha com `401 Unauthorized`.
4. Conexões de WebSocket para o Home Assistant (`/hass/api/websocket`) conectam e trocam mensagens normalmente.
5. Streams de vídeo do Frigate carregam sem engasgos ou perda de headers.
