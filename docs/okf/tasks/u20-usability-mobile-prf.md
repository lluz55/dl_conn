---
type: task
phase: 20
status: pending
title: "Fase 20 — Usabilidade: mobile flow e biometria PRF"
description: "Tornar a entrada manual de nsec primária (não escondida em details), substituir _bioPin pela extensão WebAuthn PRF quando disponível, e melhorar affordances em viewport mobile."
timestamp: 2026-10-02T18:05:00Z
---

# Fase 20 — Usabilidade: mobile flow e biometria PRF

## Objetivo

Reduzir fricção em dispositivos móveis (onde a maioria dos acessos acontece) substituindo fluxos escondidos ou redundantes, e tornar o desbloqueio biométrico resiliente a reloads via WebAuthn PRF.

## Contexto

- `web/index.html:180-184`: a entrada manual de nsec está num `<details>` colapsado, atrás do divisor "ou". Usuários novos (sem NIP-07) não descobrem.
- `web/js/session_manager.js:233-236`: o desbloqueio biométrico depende do `_bioPin` em memória. Cada reload de aba exige o PIN completo — fricção diária.
- `web/js/webauthn_manager.js` existe, mas só faz assertion sem PRF. A extensão PRF (WebAuthn Level 3, suportada em Chromium 116+ e Firefox recente) permite derivar chave diretamente da credencial biométrica.
- O layout já é mobile-first (`docs/okf/concepts/web-frontend-layout.md`), mas a affordance de "abrir QR scanner" no mobile é fraca — só desktop tem scanner visível.

## Sub-tarefas

- [ ] **Reorganizar entrada de nsec no `web/index.html:170-200`:**
  - Estrutura: três cards lado a lado (em desktop) ou empilhados (em mobile), todos visíveis por padrão:
    1. **NIP-07** (preferencial) — botão "Conectar extensão".
    2. **QR** (mobile) — botão "Escanear QR do nsec" + botão "Mostrar meu QR para o host".
    3. **Manual** — `<label for="nsec-input">Cole seu nsec (nsec1... ou hex)</label>` + `<input id="nsec-input" autocomplete="off" autocorrect="off" spellcheck="false">` + botão "Usar esta chave".
  - Remover o `<details>` colapsado; manter um link discreto "O que é nsec?" abaixo do input manual (não escondendo nada, só oferecendo contexto).
  - Validar que o fluxo NIP-07 continua sendo o padrão (não-breaking).
  - Validar `data-phase="setup"` continua consistente (sem mudanças estruturais, só redistribuição visual).

- [ ] **WebAuthn PRF para `webauthn_manager.js`:**
  - No `registerCredential`, ao criar a credencial, solicitar `extensions: { prf: { eval: { first: salt1 } } }` onde `salt1` é o salt determinístico derivado do `hostNpub` + `sessionID` (SHA-256, 32 bytes).
  - Guardar o output PRF em `crypto.subtle` wrap (não em texto claro) — reusar `crypto_vault.js` para encapsular.
  - No fluxo de unlock, ler `getClientCapabilities` e verificar `extensions.prf`. Se disponível, usar o output PRF como chave do cofre **sem** pedir PIN. Fallback para `_bioPin` atual quando PRF não está disponível.
  - User-facing: quando PRF estiver disponível, mostrar "Toque no sensor biométrico" (sem campo PIN). Quando não, manter campo PIN.
  - Detectar PRF via `await PublicKeyCredential.getClientCapabilities()` (moderno) ou via probe registrando uma credencial descartável em background.
  - Atualizar `web/tests/webauthn_prf_test.js` (novo) com mock de `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` and mock de PRF extension.

- [ ] **Banner de detecção de dispositivo (`web/js/app.js`):**
  - Detectar via `navigator.userAgent` se é mobile (`/Mobi|Android|iPhone|iPad/i.test()`).
  - Em mobile, no `data-phase="setup"`, mostrar banner discreto "💡 Use a câmera para ler o QR do nsec" com botão "Abrir câmera".
  - O banner some quando o usuário escolhe NIP-07 ou insere nsec manualmente.
  - **Não** mostrar em desktop.

- [ ] **Botão "Mostrar meu QR" para o próprio nsec:**
  - Em mobile, oferecer também o caminho inverso: se o usuário já tem `nsec` em vault (vinda de login anterior), exibir QR do `nsec` para escanear do host (cenário "transferir de desktop para mobile").
  - Reusar `qrcode` rendering já presente em `web/js/qr_auth.js`.
  - **Cuidado de segurança**: o QR do `nsec` só pode ser exibido se o vault já está desbloqueado. Caso contrário, fluxo normal (PIN → QR).

- [ ] **Auto-foco e IME correto no input de nsec:**
  - `<input id="nsec-input" inputmode="text" autocapitalize="none">` para evitar autocapitalização em mobile (nsec é lowercase).
  - `<button id="paste-nsec">Colar</button>` ao lado (chama `navigator.clipboard.readText()` com fallback `paste` event).

- [ ] **Validação em tempo real do input de nsec (`web/js/keygen_ui.js`):**
  - Enquanto o usuário digita, validar formato (bech32 `nsec1...` ou hex 64 chars). Mostrar feedback visual ✓/✗ no canto direito do input.
  - Não revelar a chave de volta se for inválida — apenas estado "formato OK" ou "formato inválido".
  - Submit só é habilitado quando formato é válido.

- [ ] **Atualizar `docs/okf/concepts/web-frontend-layout.md`:**
  - Diagrama da fase `setup` reflete os três cards paralelos.
  - Subseção "Mobile affordances" listando as 3 adições (banner mobile, QR scanner primário, paste button).

- [ ] **Atualizar `docs/okf/concepts/security.md`:**
  - Documentar o caminho PRF: o output PRF nunca sai do `crypto.subtle.wrap` excuto serialmente; o salt é determinístico mas específico por (host, sessão).
  - Adicionar nota: "PRF está disponível em Chromium 116+ e Firefox em desenvolvimento. Fallback é o `_bioPin` existente; usuários sem PRF ou sem PIN continuam dependendo do fluxo atual."

## Onde isso vive no código

- `web/index.html` (passo 1)
- `web/style.css` (passo 1 — redistribuição dos cards no layout `data-phase="setup"`)
- `web/js/webauthn_manager.js` (passo 2)
- `web/js/session_manager.js` (passo 2)
- `web/js/crypto_vault.js` (passo 2 — wrap do output PRF)
- `web/js/keygen_ui.js` (passo 6)
- `web/js/app.js` (passos 3, 5, 6)
- `web/js/qr_auth.js` (passo 4)
- `web/tests/webauthn_prf_test.js` (novo, passo 2)
- `web/tests/nsec_input_test.js` (novo, passos 1, 6)
- `docs/okf/concepts/web-frontend-layout.md` (passo 7)
- `docs/okf/concepts/security.md` (passo 8)

## Critérios de Aceite (Definition of Done)

1. Mobile (375×667 viewport): três cards visíveis por padrão (NIP-07 / QR / Manual) sem precisar abrir `<details>`. `nsec_input_test.js` confirma DOM nodes e visibilidade.
2. Desktop (≥1024px): cards lado a lado. Layout responsivo testado em ambos viewports.
3. Em ambiente com PRF disponível (mockado), `webauthn_manager.unlockVault()` resolve sem pedir PIN. Output PRF é encapsulado via `crypto_vault.js` antes de sair da função. `webauthn_prf_test.js` valida.
4. Em ambiente sem PRF, fallback `_bioPin` funciona identicamente ao atual (regressão zero). Smoke manual em Firefox ESR.
5. Mobile user-agent detectado: banner "Use a câmera para nsec" aparece; some após escolher NIP-07 ou manual.
6. Botão "Colar" preenche o input com `navigator.clipboard.readText()`. Fallback manual continua funcionando.
7. Validação em tempo real: input `nsec1...` mostra ✓; input inválido mostra ✗; submit desabilitado enquanto formato inválido. `nsec_input_test.js` cobre 6 casos (nsec válido, hex válido, bech32 truncado, hex curto, hex longo, string vazia).
8. Botão "Mostrar meu QR" só fica habilitado se vault está desbloqueado. Se bloqueado, exibe tooltip "Desbloqueie o cofre primeiro".
9. `node web/tests/*.js` verdes.
10. Sem regressão de design: tokens (`--color-*`, `--gap-*`, `--radius-*`) e tipografia inalterados.