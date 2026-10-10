---
type: task
phase: 20
status: in-progress
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
- `web/js/webauthn_manager.js` existe, mas só faz assertion sem PRF. A extensão PRF (WebAuthn Level 3, com suporte dependente do navegador e do autenticador) permite derivar chave diretamente da credencial biométrica.
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

- [x] **WebAuthn PRF para `webauthn_manager.js`:**
  - No `registerCredential`, ao criar a credencial, solicitar `extensions: { prf: { eval: { first: salt1 } } }` onde `salt1` é o salt determinístico derivado do `hostNpub` + `sessionID` (SHA-256, 32 bytes).
  - Guardar o output PRF em `crypto.subtle` wrap (não em texto claro) — reusar `crypto_vault.js` para encapsular.
  - No fluxo de unlock, ler `getClientCapabilities` e verificar `extension:prf`. Se disponível, usar o output PRF como chave do sidecar do cofre **sem** pedir PIN. Fallback para `_bioPin` atual quando PRF não está disponível.
  - User-facing: quando PRF estiver disponível, mostrar "Toque no sensor biométrico" (sem campo PIN). Quando não, manter campo PIN.
  - Detectar PRF via `await PublicKeyCredential.getClientCapabilities()` (moderno) ou via probe registrando uma credencial descartável em background.
  - Atualizar `web/tests/webauthn_prf_test.js` (novo) com mock de `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` and mock de PRF extension.

  Implementado em 2026-10-09. Mudanças principais:
  - `web/js/webauthn_manager.js` agora expõe `isPrfAvailable()` e propaga o `prfSalt` / `prfOutput` entre `registerCredential` e `authenticateBiometric`; o `rp.id` é omitido quando o hostname é um IP.
  - `web/js/crypto_vault.js` ganhou `encryptVaultPrf` / `decryptVaultPrf` (HKDF-SHA256 do output PRF); o envelope `mode: "prf"` é salvo como sidecar e o vault PIN é preservado para recuperação.
  - `web/js/session_manager.js` (`enableBiometric`, `unlockWithBiometric`, `_openWithPrf`): PRF é o caminho primário; `_bioPin` fica como fallback documentado para dispositivos sem PRF.
  - UI: o card "Ativar biometria" (`web/index.html#biometric-enroll`, `web/app.js#refreshBiometricEnrollUI`) esconde o campo PIN e troca a copy para "toque no sensor" quando PRF está disponível.
  - Cobertura: `web/tests/webauthn_prf_tests.js` com 37 asserções (capability detection, enrollment, fallback legacy, guard de sessão bloqueada, recuperação por PIN, wipe, round-trip criptográfico e re-enrollment).

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