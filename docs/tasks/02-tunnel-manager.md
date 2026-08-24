---
type: task
phase: 2
status: pending
title: "Fase 2 — Gerenciador do Túnel Efêmero Cloudflare"
description: "Orquestração do ciclo de vida do subprocesso cloudflared, captura assíncrona de URL efêmera e auto-recuperação."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 2 — Gerenciador do Túnel Efêmero Cloudflare

## Objetivo
Criar um gerenciador em Go (`internal/tunnel`) responsável por iniciar, monitorar, capturar a URL efêmera do `trycloudflare.com` e controlar o ciclo de vida do processo `cloudflared`.

## Sub-tarefas

- [ ] **Orquestrador de Subprocesso (`internal/tunnel/manager.go`):**
  - Execução não-bloqueante de `cloudflared tunnel --url http://127.0.0.1:<PORT> --no-autoupdate`.
  - Captura e streaming das saídas `stdout` e `stderr`.
- [ ] **Parser de URL Efêmera via Expressão Regular:**
  - Implementar parser assíncrono para extrair a URL gerada: `https://[a-zA-Z0-9-]+\.trycloudflare\.com`.
  - Emitir notificação por canal Go (`chan string`) assim que a URL for detectada e estiver acessível.
- [ ] **Health Check & Auto-Restart:**
  - Mecanismo de heartbeat/ping para verificar se o túnel continua respondendo.
  - Reconexão automática em caso de encerramento inesperado do processo com backoff exponencial.
- [ ] **Controle sob Demanda & Inatividade (Opcional configurável):**
  - Suporte a iniciar o túnel apenas quando houver solicitação Nostr e desligar após X minutos sem requisições HTTP registradas.
- [ ] **Shutdown Gracioso:**
  - Encaminhamento correto de sinais (`SIGTERM`/`SIGINT`) para matar o processo filho `cloudflared` de forma limpa, evitando processos zumbis.

## Onde isso vive no código
- `internal/tunnel/manager.go`
- `internal/tunnel/parser.go`
- `internal/tunnel/manager_test.go`

## Critérios de Aceite (Definition of Done)
1. O manager inicia o `cloudflared` localmente e extrai a URL `https://...trycloudflare.com` em menos de 5 segundos.
2. O canal de status notifica a aplicação principal com a URL ativa.
3. Encerrar a aplicação principal mata o processo `cloudflared` imediatamente.
4. Testes unitários com mock do comando validam o parsing da regex e tratamento de erros.
