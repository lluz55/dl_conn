---
type: task
phase: 10
status: done
title: "Fase 10 — Sessão efêmera no login por nsec e feedback da descoberta"
description: "Login por nsec passa a abrir a sessão imediatamente (cofre vira passo opcional) e a descoberta de serviços informa falha de publicação e ausência de resposta do host."
timestamp: 2026-08-25T00:00:00Z
---

# Fase 10 — Sessão efêmera no login por nsec e feedback da descoberta

## Problema

Após inserir o `nsec` com sucesso a SPA mostrava "Conectado: npub1…" e **nada
acontecia** — nenhum serviço aparecia. `onLoginNsec` apenas guardava a
identidade em `state.pendingIdentity`; a descoberta de serviços pende do evento
`"unlocked"` do `SessionManager`, que só era emitido por `createVault()` /
`unlockWithPin()`. Sem definir um PIN e salvar o cofre, `state.session.sk`
continuava `null`, `startNostr()` abortava, `data-phase` ficava em `setup` (com
`.col-live` em `display:none`) e `#services-section` nunca perdia o `hidden`.

Agravante: quando o pedido era enviado, o resultado de `sendDiscoverRequest()`
era descartado e não havia timeout de resposta — um host offline ou um `npub`
fora de `authorizedNpubs` (descartado em silêncio por `ParseEvent`,
`internal/nostr/client.go`) era indistinguível de "ainda carregando".

## Sub-tarefas

- [x] **`web/js/session_manager.js` — `startSession(identity)`:** abre a sessão
  desbloqueada só em memória (sem persistir nada), emitindo `unlocked` +
  `pending`. Rejeita identidade sem `sk`/`npub`.
- [x] **`createVault()` dividido:** `saveVault(identity, pin)` cifra e persiste;
  `createVault()` chama `saveVault()` e só chama `startSession()` se a sessão
  ainda estiver bloqueada — salvar o cofre de uma sessão já viva não pode
  re-emitir `unlocked` (derrubaria e refaria a conexão Nostr à toa).
- [x] **`web/app.js` — `onLoginNsec()`** chama `startSession()`; o cofre vira
  passo opcional via `showSavePrompt()` / `dismissSavePrompt()` (botão
  **"Agora não"**, `#btn-skip-vault`). `#vault-section` só é escondido no
  `unlocked` quando não há identidade pendente para salvar.
- [x] **NIP-07 não cria mais `pendingIdentity` com `sk: null`** — sem chave
  privada não há o que salvar no cofre.
- [x] **Feedback da descoberta:** `startNostr()` trata `{status:"timeout"}` e
  `{status:"failed"}` do `sendDiscoverRequest()`; `startDiscoveryTimeout()`
  (30 s) avisa que o host não respondeu e cita `authorizedNpubs`.
  `clearLiveTimers()` centraliza a limpeza em `locked`/`wiped`/`clear all`.
- [x] **Testes:** `web/tests/session_tests.js` cobre `startSession` (desbloqueia,
  expõe `sk`, emite `unlocked`+`pending`, não persiste, rejeita identidade sem
  chave) e o `createVault` sobre sessão viva (persiste sem re-emitir
  `unlocked`). `DEFAULT_RELAYS` passou a ser exportado por
  `web/js/relay_manager.js` para `relay_tests.js` deixar de fixar "4 defaults".

## Onde isso vive no código

- `web/js/session_manager.js` (`startSession`, `saveVault`, `createVault`)
- `web/app.js` (`onLoginNsec`, `showSavePrompt`, `dismissSavePrompt`,
  `startNostr`, `startDiscoveryTimeout`, `clearLiveTimers`)
- `web/index.html` (`#btn-skip-vault`), `web/style.css` (`.btn-link`)
- `web/js/relay_manager.js` (`export const DEFAULT_RELAYS`)

## Definition of Done

1. ✅ Inserir o nsec (digitado ou via QR) leva direto à zona Live e dispara a
   descoberta, sem exigir PIN.
2. ✅ Salvar o cofre depois não reconecta a sessão; "Agora não" segue sem salvar.
3. ✅ Host offline / `npub` não autorizado produz mensagem explícita em até 30 s.
4. ✅ `node --check` verde; `web/tests/*`: 19 + 7 + 40 + 35 = 101 asserções, 0 falhas.

Relacionado: [[08-session-vault-auth]], [[09-keygen-qr-login]],
[web-frontend-layout](../concepts/web-frontend-layout.md).
