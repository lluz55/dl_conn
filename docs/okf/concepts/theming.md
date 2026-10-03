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

### Eixos de aparência e o painel que os expõe

São **três eixos ortogonais**, todos no `<html>` e todos persistidos:

| Eixo | Atributo | Chave | Faixa |
|---|---|---|---|
| Paleta | `data-palette` | `dl_conn_palette` | azure · evergreen · ember · iris |
| Tema | `data-theme` | `dl_conn_theme` | light · dark |
| Densidade | `data-density` | `dl_conn_density` | comfortable · compact |

**`system` é um estado real do eixo de tema**, não um palpite inicial: a
preferência ausente vale `system` e um listener em
`matchMedia("(prefers-color-scheme: dark)")` re-resolve o tema enquanto a
preferência for `system`. Antes, o valor era lido uma única vez no load —
mudar o SO com a aba aberta não fazia nada — e o primeiro clique no botão
sol/lua descartava a preferência de sistema em silêncio.

O painel **Aparência** (`#appearance-panel`, botão `#btn-appearance` no
header) expõe os três eixos: radio de tema em três vias, swatch por paleta e
densidade. As swatches usam as cores médias de cada paleta em hexadecimal
fixo, **não** tokens: uma amostra tem que mostrar a identidade da paleta, e
não pode mudar quando a paleta está ativa ou quando o tema vira.

**Densidade compacta só é aplicada em ponteiro fino.** Ela baixa
`--control-h` de 44px para 34px, o que violaria o alvo mínimo de toque;
`applyAppearance()` recusa o atributo quando `matchMedia("(pointer: coarse)")`
bate, mas mantém a preferência salva — um dock de volta para o mouse a
restaura. Densidade mexe **só** em espaçamento e altura de controle: cor,
raio e escala tipográfica continuam sendo da paleta, para que os dois eixos
não brigem.

`color-scheme: light` / `[data-theme="dark"] { color-scheme: dark }` é
declarado para que scrollbar, `<select>` e controles nativos do SO sigam o
tema — sem isso a página escura vinha com scrollbar clara.

### Tokens de dataviz

A camada de monitoramento consome uma categoria própria de tokens, para que
trocar a paleta recolora gráficos, medidores e limiares sem tocar em regra
de componente:

- `--color-chart-1..6` — **rampa categórica declarada dentro de cada bloco
  de paleta** (4 × 2 combinações), não em `:root`. Índice 1 é a primary da
  paleta e índice 2 é um laranja quente no lado oposto do eixo azul/laranja,
  que sobrevive a deuteranopia e protanopia. **Nunca codifique uma série só
  por matiz** — pareie cor com rótulo, tracejado ou posição.
- `--color-threshold-ok` / `-warn` / `-crit` — os limiares dos medidores e a
  linha tracejada do gráfico. Derivados de `--color-success`/`warning`/`error`
  em `:root`, então acompanham o tema sem bloco por paleta.
- `--color-chart-grid` / `--color-chart-axis`, `--meter-track` / `--meter-fill`.

Regra de CSP que vale para **todo** gráfico daqui: barra e polyline são
atributos de geometria SVG escritos com `setAttribute`, nunca `style` inline
(`style-src self` não tem `unsafe-inline`). Como a `viewBox` é esticada
por `preserveAspectRatio="none"`, traço e linha usam
`vector-effect: non-scaling-stroke` — sem isso o `stroke-width` é distorcido
pelo escalonamento e a espessura varia com a largura da tela.

Alternância: `applyAppearance()` (escreve os três atributos e sincroniza os
controles), `setupTheme()` (registra o listener de esquema), `toggleTheme()`
(atalho binário explícito, que opta **fora** do "seguir o SO") e
`syncAppearanceControls()`. Todas em `web/app.js`.

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
`<html>`. `web/app.js`: `applyAppearance()`/`setupTheme()`/`toggleTheme()`.
Aplica-se em `document.documentElement`. Vide
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
