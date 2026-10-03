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

## Alvos de toque e canais de que cada input depende

O alvo de 44×44dp é regra, não sugestão — e vale para **todo** controle
interativo, não só para os que o bloco `max-width: 639px` já alcançava.
Duas classes escapavam dele por estarem em pixel absoluto:
`.service-overview-link` (32px) e `.service-overview-drag` (28px). Agora
consomem `var(--control-h)`, que vale 44px por padrão.

**Ponteiro fino baixa esse alvo, ponteiro grosso não.** A densidade compacta
define `--control-h: 34px` dentro de `@media (pointer: fine)`, e
`applyAppearance()` recusa o atributo `data-density` quando
`matchMedia("(pointer: coarse)")` bate. Duas camadas de guarda de propósito:
a CSS cobre o caso em que o atributo vem de outra origem (o `test.html` de
protótipo, uma preferência antiga), o JS cobre a decisão do usuário.

Cada input tem um canal de acesso que *só ele* possui:

| Canal | Serve a | Por quê não substitui o outro |
|---|---|---|
| `aria-label` no botão de ícone | leitor de tela | não é visível |
| Tooltip `data-tip` | apontador fino (hover + `:focus-visible`) | **não existe em toque** |
| Alça com ↑/↓ | teclado | reordena, não abre |

O tooltip é puro CSS (`content: attr(data-tip)` num `::after`), porque a CSP
proíbe `style` inline e um tooltip posicionado por JS precisa de coordenadas
inline. Em `max-width: 639px` **e** em `pointer: coarse` ele é suprimido: sem
estado de hover, ele só piscaria no tap. O `aria-label` continua sendo o nome
acessível do controle nos dois casos — o tooltip é reforço, nunca o único
rótulo.

## Onde isso vive no código

`web/style.css`: `.app-columns` (`grid 1fr 1fr` em `≥1024px`), `.col`,
`.col-live` (display:none em setup, flex em live), `.status-grid`, `.card-head`,
header slim; breakpoints em `≥1024px`. Estado de fase alternado em
`web/app.js` (`data-phase="live"` em `handleNostrResponse`, `data-phase="setup"`
em `onSessionEvent`).

Relacionado: [architecture.md](architecture.md), [theming.md](theming.md),
[web-frontend-layout.md](web-frontend-layout.md).
