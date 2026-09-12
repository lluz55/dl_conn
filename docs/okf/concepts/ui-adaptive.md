---
type: architecture-decision
---

# UI adaptativa: mobile, tablet e desktop

## Decisão

A experiência deve ser boa em **celular, tablet e desktop** — não apenas "não
quebrar". O SPA é **mobile-first** e usa breakpoints de CSS (não os breakpoints de
componentes de um framework móvel):

| Faixa | Largura | Layout |
|-------|---------|--------|
| Compact (celular) | < 1024px | coluna única: Setup acima, Live abaixo |
| Expanded (tablet/desktop) | ≥ 1024px | duas colunas (`grid 1fr 1fr`) lado a lado |

A transição de fase (Setup → Live) é controlada por `data-phase` no
`.app-container` (ver [web-frontend-layout.md](web-frontend-layout.md)), não por
um componente de navegação separado. Alvos de toque ≥ 44×44dp em telas small;
em desktop, suporte a mouse/teclado (hover, foco visível, atalhos, scroll) e a
mesma funcionalidade de compact/medium. Nenhuma funcionalidade exclusiva de um
form factor.

## Por quê

O produto visa três contextos de primeira classe (celular, tablet, janela de
desktop redimensionável no browser). Tratar um breakpoint como "principal" e os
outros como fallback degrada a UX nos não-priorizados.

## Onde isso vive no código

`web/style.css`: `.app-columns` (`grid 1fr 1fr` em `≥1024px`), `.col`,
`.col-live` (display:none em setup, flex em live), `.status-grid`, `.card-head`,
header slim; breakpoints em `≥1024px`. Estado de fase alternado em
`web/app.js` (`data-phase="live"` em `handleNostrResponse`, `data-phase="setup"`
em `onSessionEvent`).

Relacionado: [architecture.md](architecture.md), [theming.md](theming.md),
[web-frontend-layout.md](web-frontend-layout.md).
