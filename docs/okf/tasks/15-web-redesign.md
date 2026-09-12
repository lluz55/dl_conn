---
type: task
title: "Fase 15 — Redesign definitivo do SPA (protótipo → produção)"
status: done
---

# Fase 15 — Redesign definitivo do SPA

Migração do protótipo aprovado (`web/test.html`/`test.css`) para o app de
produção, tornando-o o design definitivo. Referência visual: profundidade em
camadas (elevações, não hairlines), 4 palettes × light/dark, tipografia com
propósito, "Sessão" unificada.

- [x] `web/style.css` reescrito a partir do CSS do protótipo: tokens de
      geometria/tipografia/motion, 4 palettes (`azure`, `evergreen`, `ember`,
      `iris`) em light+dark, elevações em camadas, componentes novos
      (`.pill`, `.mono-chip`, `.identicon`, `.session-*`, `.countdown-*`,
      `.divider-label`, `.icon-tile`, `.btn-tonal`, `.empty-state`)
- [x] Mecanismo de fase (`[data-phase]`, gating da `.col-live`, centralização
      do setup em desktop) portado intacto para o novo design
- [x] Fontes auto-hospedadas: subconjuntos latin woff2 de Space Grotesk /
      Inter / JetBrains Mono em `web/vendor/fonts/` (CSP proíbe CDN), com
      `font-display: swap` e fallback de sistema; proveniência registrada no
      README do diretório
- [x] `web/index.html`: cartão de sessão unificado (`#vault-section`
      `.session-card` com lados `#session-setup` e `#session-live` —
      identidade, estado e auto-lock com contagem regressiva no mesmo lugar;
      `#auto-lock-section` virou o rodapé do cartão) + vocabulário de classes
      novo; todos os `id`s consumidos por `app.js`/testes preservados
- [x] `web/app.js`: tema+paleta movidos para `<html>` (`data-theme`/
      `data-palette`), pill de estado da sessão, identicon 3×3 derivado do
      npub, ticker da contagem regressiva alimentado por
      `SessionManager.secondsRemaining`, contagem também no KPI "Sessão"
- [x] `web/js/session_manager.js`: getter aditivo `secondsRemaining`
      (janela de inatividade ancorada em relógio, sem duplicar o timer)
- [x] CSP: `font-src 'self'` adicionado ao `<meta>` e espelhado em `spaCSP`
      (`cmd/dl_conn/main.go`); daemon registra `mime` de `.woff2`
- [x] Testes do frontend: `session_tests.js` sai com `process.exit` (timer de
      15 min do SessionManager segurava o event loop — hang pré-existente);
      regex do `tunnel_rotation_tests.js` atualizada para o guard real com
      bloco `pushDebug` (asserção obsoleta já vermelha no HEAD)
- [x] Conceitos atualizados: [theming.md](../concepts/theming.md),
      [web-frontend-layout.md](../concepts/web-frontend-layout.md); armadilha
      do `*/` dentro de comentário CSS registrada no log

## Done when
- As 9 suítes `node web/tests/*.js` verdes; `go build/vet/test` verdes com
  contagem de findings do `golangci-lint` inalterada vs HEAD (41 = 41 — dívida
  pré-existente, fora de escopo); SPA renderiza com o novo design em
  telefone/tablet/desktop.

## Notas de arquivamento
- Os arquivos do protótipo (`web/test.html`/`test.css`/`test.js`) nunca
  entraram no git; permanecem locais como referência e podem ser apagados a
  qualquer momento — o design vive agora em `style.css` + `index.html`.
