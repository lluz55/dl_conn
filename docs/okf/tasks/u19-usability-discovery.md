---
type: task
phase: 19
status: pending
title: "Fase 19 — Usabilidade: feedback de descoberta e renovação"
description: "Dividir a janela de descoberta em fases com feedback visível (relay ping → publish → wait → fail), animar o return banner, e oferecer botão para renovar a URL do túnel sob demanda."
timestamp: 2026-10-02T17:55:00Z
---

# Fase 19 — Usabilidade: feedback de descoberta e renovação

## Objetivo

Tornar o fluxo "ligar e aguardar" em algo observável e controlado pelo usuário. Reduzir a percepção de "travou" durante a fase `setup` e devolver controle ao usuário para forçar nova URL do túnel.

## Contexto

- `web/app.js:1257` arma um `setTimeout` de 30 s como timeout de descoberta. Durante esse intervalo, o usuário vê apenas "Aguardando túnel…" sem saber se algum relay respondeu ou se o pedido sequer saiu.
- O `NostrClient._debug` (`web/js/nostr_client.js:58`) expõe estado rico, mas só fica visível no console de debug — usuário comum não abre.
- O túnel Cloudflare é **efêmero**: a cada restart do daemon, a URL muda. Não há UI para forçar uma nova rodada — o usuário só percebe o problema quando tenta acessar um serviço e recebe 403.
- O `return-banner` (`web/index.html:121-126`) já existe mas entra sem animação, dando a impressão de "apareceu de repente".

## Sub-tarefas

- [ ] **Adicionar evento de fases no `NostrClient` (`web/js/nostr_client.js`):**
  - Criar `EventTarget` interno e expor `client.addEventListener('phase', cb)` onde `cb({phase, payload})`.
  - Fases: `connecting-relays` → `relays-ready` → `publishing-discovery` → `waiting-response` → `tunnel-ready` ou `failed`.
  - Cada fase tem `payload` opcional (ex.: `{connected: 3, total: 5}` para `relays-ready`).
  - **Não remover** `_debug` — ele continua logando tudo, é um superset dos eventos `phase`.

- [ ] **Mapear fases para o DOM (`web/app.js:1280-1340`):**
  - Substituir o "Aguardando túnel…" único por uma pilha de passos visíveis:
    1. "Conectando a 5 relays…"
    2. "3/5 relays conectados, autenticando…"
    3. "Pedido publicado em 3 relays"
    4. "Aguardando resposta do host…"
    5. (sucesso) → "Túnel pronto: https://xxxx.trycloudflare.com"
    6. (falha) → "Host não respondeu em 30 s. [Tentar novamente] [Ver diagnóstico]"
  - Reusar `<progress>` nativo com `value` atualizado a cada fase (acessível).
  - Marcar o passo atual com `aria-current="step"`; passos completados com `<p aria-hidden="true">✓</p>`.

- [ ] **Persistir contador de falhas no `localStorage` (`web/js/nostr_client.js:120`):**
  - Quando uma fase falha, incrementar `dl_conn.discoveryFailures` (TTL 24 h).
  - Após 3 falhas em 24 h, exibir banner persistente "Múltiplas falhas recentes — verificar configuração do host" linkando para a seção de debug.
  - Reset quando `tunnel-ready` é atingido.

- [ ] **Botão "Pedir nova URL" no `live` rail (`web/index.html:200+`):**
  - Adicionar botão `Pedir nova URL` ao lado do KPI "Túnel" no layout `live`.
  - Ao clicar, chama `NostrClient.sendDiscoverRequest` (`web/js/nostr_client.js:148`) novamente.
  - Mostra overlay "Renovando…" com fases idênticas às do setup.
  - Ao concluir, atualiza o KPI com a nova URL sem reload.
  - Estado desabilitado enquanto `tunnel-ready` ainda é recente (< 60 s) — evita loop do tipo "renovou → renovação antiga vence".

- [ ] **Animar entrada do `return-banner` (`web/style.css:700-720`):**
  - Adicionar `@keyframes return-banner-enter { from { transform: translateY(-12px); opacity: 0 } to { ... } }` (150 ms `ease-out`).
  - Aplicar via `animation` no `#return-banner.is-visible`.
  - **Não alterar** o design system: o banner continua com as cores/tokens atuais. Só movimento.

- [ ] **Animar mudança de URL no KPI Túnel (`web/app.js` view `live`):**
  - Quando o `tunnel-ready` chega com URL diferente da anterior, fazer `flash` 300 ms na cor de sucesso (`--color-success`) no `<output>` que contém a URL.
  - Reusar token `--motion-fast` (já existente? verificar) — caso contrário criar `--motion-duration-fast: 150ms` em `web/style.css`.

- [ ] **Botão "Copiar URL do túnel":**
  - Ao lado do KPI Túnel, botão `Copiar` que chama `navigator.clipboard.writeText(tunnelUrl)` com feedback visual "Copiado!" por 1,5 s.
  - Ícone via SVG inline (mesmo padrão dos demais ícones de `web/index.html`).
  - Funciona em mobile via menu "compartilhar" do sistema.

- [ ] **Atualizar `docs/okf/concepts/web-frontend-layout.md`:**
  - Adicionar subseção "Fases de descoberta" com diagrama textual das fases e mapeamento para `data-phase`.
  - Documentar o botão "Pedir nova URL" no layout `live`.

- [ ] **Atualizar `docs/runbook.md`:**
  - Seção "Operação": mencionar a UI de descoberta e o que o operador deve verificar se vê N falhas seguidas.
  - Não duplicar conteúdo já presente em `web-frontend-layout.md`.

## Onde isso vive no código

- `web/js/nostr_client.js` (passos 1, 3)
- `web/app.js` (passos 2, 4, 6)
- `web/index.html` (passos 4, 5, 7)
- `web/style.css` (passos 5, 6 — animações)
- `web/tests/discovery_phases_test.js` (novo, passo 1 — fake relays + EventTarget)
- `docs/okf/concepts/web-frontend-layout.md` (passo 8)
- `docs/runbook.md` (passo 9)

## Critérios de Aceite (Definition of Done)

1. `nostr_client.js` dispara eventos `phase` na ordem documentada em testes com relays fake (`discovery_phases_test.js`).
2. Inspeção manual do DOM no setup: cada fase renderiza o passo correspondente com `aria-current` correto. Tab navigation funciona (teclado pula para o passo atual).
4. Após 3 simulações de falha em <24 h, o banner persistente aparece. Após sucesso, banner some.
5. Botão "Pedir nova URL" dispara `sendDiscoverRequest` (verificado via spy em `discovery_phases_test.js`). Desabilitado durante o primeiro minuto de túnel fresco.
6. DevTools Animations panel mostra `return-banner-enter` a 150 ms `ease-out` quando o banner aparece. Sem jank (sem `top`/`left`, só `transform`).
7. Botão "Copiar" chama `navigator.clipboard.writeText` e mostra feedback por 1,5 s. Em `http://` (LAN), funciona via fallback `document.execCommand('copy')` se a Clipboard API falhar.
8. `node web/tests/*.js` verdes; smoke test manual em Chrome mobile (iPhone SE viewport 375×667) e desktop (1920×1080).
9. Nenhuma string PT-BR hardcoded — strings vêm de `i18n_strings.js` (Fase 17 introduz o arquivo; se ainda não existir, criar).
10. Tokens visuais (`--color-success`, `--motion-duration-fast`, etc.) são os do design system atual; sem redesign.