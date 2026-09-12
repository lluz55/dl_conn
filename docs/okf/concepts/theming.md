---
type: architecture-decision
---

# Sistema de temas (design tokens)

## Decisão

O SPA (`web/`) define um sistema de tema único via **CSS custom properties**
(Design Tokens) em `web/style.css` — cor, tipografia e espaçamento **nunca**
são hardcoded em valores literais nos elementos. Base: tokens de cor
(`--color-*`), espaçamento/raio (`--gap-*`, `--radius-*`), declarados no `:root`
e sobrescritos por um seletor de tema (light/dark). Dark e light são sempre
implementados em paralelo — nunca uma feature só com um dos dois.

Componentes comuns (botão, input, card, diálogo) são themados via classes
utilitárias/escopo em `web/style.css` que consomem os tokens — não há wrapper
por componente. Todos reusam `--radius-*` como raio de canto; o resto (cor de
fundo, borda, tipografia) segue os tokens derivados de `--color-*`.

### Paleta ampliada para o dashboard (tons de categorização)

Além de `--color-primary`/`--color-success`/`--color-warning`/`--color-error`
(semântica de status), o tema ganhou dois tons de **categorização neutra**
para diferenciar cartões de KPI/gráfico que não representam bom/ruim:
`--color-accent` (roxo) e `--color-info` (ciano) — cada um com seu par
`-hover`/`-on-*`, replicado nos três blocos de tema (`:root` light,
`prefers-color-scheme: dark`, `[data-theme="dark"]`/`[data-theme="light"]`).

Cada tom de status/categoria (`primary`/`accent`/`info`/`success`/`warning`/
`error`) também ganhou uma variante **soft** (`--color-*-soft`) — um tingimento
sutil (14–16% de mistura) sobre `--color-surface`, via `color-mix(in srgb, …)`,
usado como fundo de cartão de estatística (`.kpi-card`, `.chart-card`) em vez
da cor sólida (reservada para ícones/chips). `color-mix()` resolve os tokens
`var()` em tempo de uso, então essas variantes **não precisam** de bloco
próprio por tema — herdam automaticamente o `--color-primary` etc. já
sobrescrito. Continua **zero gradiente**: todo tingimento é sólido
(`color-mix` produz uma cor plana, não um gradiente).

## Por quê

Tratado como sistema desde o início (não retrofit) porque cor/spacing soltos
pelo CSS são o tipo de dívida técnica que se espalha rápido e fica cara de
consolidar depois — cada regra vira um lugar a mais para caçar quando o tema muda.

## Onde isso vive no código

`web/style.css`: `:root { --color-*; --gap-*; --radius-*; }` + variantes de
tema; `.app-columns`, `.col`, `.card`, `.card-head`, etc. O SPA alterna o tema
(ícone sol/lua no header) e respeita a preferência do sistema quando aplicável.
Vide [web-frontend-layout.md](web-frontend-layout.md) para o uso dos tokens no
layout de duas colunas, e a seção "dashboard analytics" de lá para
`.kpi-card`/`.chart-card`/`.health-bar` (consumidores dos tons `accent`/`info`
e das variantes `-soft` descritas acima).

Relacionado: [ui-adaptive.md](ui-adaptive.md), [i18n.md](i18n.md) (mesma
lógica de "nunca hardcode, sempre token/recurso central" aplicada a texto).
