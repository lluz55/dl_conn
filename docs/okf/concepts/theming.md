---
type: architecture-decision
---

# Sistema de temas (design tokens)

## Decisão

O SPA (`web/`) define um sistema de tema único via **CSS custom properties**
(Design Tokens) em `web/style.css` — cor, tipografia e espaçamento **nunca**
são hardcoded em valores literais nos elementos. Desde o redesign definitivo
(Fase 15), o sistema tem **duas dimensões ortogonais declaradas como
atributos no `<html>`**:

- **Paleta** (`data-palette`): `azure` (padrão), `evergreen`, `ember`, `iris`.
  Cada palette redefine os tokens de cor (`--color-*`); blocos light usam o
  seletor simples (`[data-palette="X"]`), dark usa o composto
  (`[data-palette="X"][data-theme="dark"]`). O padrão `azure` dispensa
  atributo (blocos `:root, [data-theme="light"]`), mas `app.js` grava
  `data-palette` sempre — **todo bloco dark é composto, logo um `data-theme`
  sem `data-palette` no elemento nunca casa com dark e a página fica clara.**
- **Tema** (`data-theme`): `light` | `dark`, sobre a paleta ativa.

Tokens de cor por estado de superfície: `--color-bg`, `--color-surface`,
`--color-surface-2`/`-3` (afundados), `--color-elevated`, `--color-text`,
`--color-text-2`/`-3`, `--color-outline`, `--color-scrim`, mais os tons
semânticos `primary`/`success`/`warning`/`error` e de categorização
`accent`/`info` (cada um com `-strong`, `-on-*` e `-soft` — este último via
`color-mix(in srgb, …)`, que resolve `var()` em tempo de uso e herda a
sobrescrita do tema-base, sem bloco próprio). Sombra com matiz por tema:
`--shadow-tint` + `--edge-highlight` alimentam a escada de elevações
`--elev-1/2/3` — profundidade em camadas substituiu as hairlines como
separador primário; `--color-outline` ficou para separadores semânticos.

Geometria/tipografia/motion são **independentes de paleta** (definidos uma vez
em `:root`): `--gap-*`, `--radius-*` (+ aliases `--radius-card/input/btn/...`
para compat), escala `--fs-*` e `--fw-*`/`--lh-*`, `--transition`, e as três
famílias `--font-display` (Space Grotesk), `--font-body` (Inter),
`--font-mono` (JetBrains Mono) — **auto-hospedadas** em
`web/vendor/fonts/` (subsets latin woff2; a CSP `style-src 'self'` proíbe
CDN), sempre com fallback de sistema. A escala tipográfica (`s-display*`,
`s-h1/h2/h3`) é aplicada via classes utilitárias por contexto, nunca no
elemento nu.

Componentes comuns (botão, input, card, diálogo, pill, chip) são themados via
classes utilitárias/escopo em `web/style.css` que consomem os tokens — não há
wrapper por componente. Continua **zero gradiente**: todo tingimento é sólido
(`color-mix` produz uma cor plana). A paleta é decorativa; a semântica de
saúde continua exclusiva de `--color-success`/`error`/`on-surface-dim` via
`.dot-good`/`.dot-bad`/`.dot-unknown`.

Alternância de tema: botão sol/lua no header persiste `dl_conn_theme`
(tema); paleta persiste `dl_conn_palette` — sem UI de troca ainda, um seletor
futuro lê `localStorage`. Both are applied to `document.documentElement` by
`setupTheme()`/`toggleTheme()` in `app.js`.

## Por quê

Tratado como sistema desde o início (não retrofit) porque cor/spacing soltos
pelo CSS são o tipo de dívida técnica que se espalha rápido e fica cara de
consolidar depois — cada regra vira um lugar a mais para caçar quando o tema
muda. As quatro palettes vêm do protótipo aprovado do redesign (Fase 15):
a estrutura `palette × tema` foi desenhada para o seletor virar UI sem tocar
em nenhuma regra de componente.

## Onde isso vive no código

`web/style.css`: `:root` (tokens base + azure light), blocos
`[data-palette="X"]`/`[data-palette="X"][data-theme="dark"]`,
`[data-theme="dark"]` (azure), e componentes que consomem os tokens.
`web/index.html`: atributos `data-palette="azure" data-theme="light"` no
`<html>`. `web/app.js`: `setupTheme()`/`toggleTheme()`. Vide
[web-frontend-layout.md](web-frontend-layout.md) para o uso dos tokens no
layout de duas colunas, no cartão de sessão unificado e nos cartões
`.kpi-card`/`.chart-card`/`.health-bar` (consumidores dos tons
`accent`/`info` e variantes `-soft`).

Armadilha de sintaxe registrada em
[log.md](../log.md): a sequência estrela-barra **dentro do texto de um
comentário CSS fecha o comentário cedo**, e o parser engole a próxima regra
inteira — foi assim que o bloco `:root` do protótipo morreu uma vez. Não
escreva variantes de token com curinga adjacente a `/` em comentários.

Relacionado: [ui-adaptive.md](ui-adaptive.md), [i18n.md](i18n.md) (mesma
lógica de "nunca hardcode, sempre token/recurso central" aplicada a texto).
