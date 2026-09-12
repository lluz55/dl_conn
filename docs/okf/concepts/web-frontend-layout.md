---
type: architecture-decision
---

# Layout do frontend SPA (`web/`): colunas Setup × Live

## Decisão

O SPA (`web/index.html` + `style.css` + `app.js`) organiza a tela em **duas
zonas por ciclo de vida**, reveladas por fase via atributo `data-phase` no
`.app-container`:

- **Setup** (sempre visível): Identidade (`#vault-section`) + Relays
  (`#relay-panel`, promovido de um toggle no header para card visível).
- **Live** (revela após o túnel Nostr responder): Status rail
  (`#status-section`, 4 itens inline) + Serviços (`#services-section`).

Em `≥1024px` as duas zonas ficam lado a lado (`grid 1fr 1fr`); abaixo,
coluna única (Setup acima, Live abaixo). No modo setup em desktop a coluna
Setup é centralizada (`max-width: 720px`). **Cues de zona são puramente
espaciais** (gap / leve separação) — sem rótulos.

O header encolhe para só brand + theme + lock; `test-relays` e
`clear-services` saem do header (o primeiro vira card visível; o segundo vai
para o cabeçalho do card Serviços via `.card-head`).

## Por quê

O app tem um state machine claro (`locked → connect → live`) que o layout
plano anterior (4 cards empilhados, painel de relays escondido atrás de um
ícone no header, status sempre visível com "Aguardando túnel…") não
refletia — ruído precoce, baixa descoberta do painel de relays e desperdício
de espaço horizontal no desktop. A divisão faseada elimina os três de uma vez
e respeita as amarras do projeto: CSP `style-src 'self'` (zero inline
`style`, zero CDN), sem gradientes, light/dark, tudo tokenizado em
`--color-*` / `--gap-*` / `--radius-*`.

## Onde isso vive no código

- `web/index.html`: `.app-columns` / `.col-setup` / `.col-live`; `data-phase`
  em `.app-container`; relay panel sem `hidden`; `btn-clear-services` dentro
  de `.card-head` em `#services-section`.
- `web/style.css`: `.app-columns`, `.col`, `.col-live` (display:none em setup,
  flex em live), `.status-grid` (rail flex), `.card-head`, header slim;
  breakpoints em `≥1024px`.
- `web/app.js`: `data-phase="live"` em `handleNostrResponse`; `data-phase="setup"`
  em `onSessionEvent` (`locked`/`wiped`); `renderRelayList()` no `init`.

## Armadilha: quem dispara a fase Live

A transição para `live` pende do evento `"unlocked"` do `SessionManager` — **um
login que só guarda a identidade não revela nada**. Por isso `onLoginNsec` chama
`session.startSession()` na hora e o cofre (PIN) é um passo opcional exibido
*depois*, com `#vault-section` mantido visível enquanto houver
`state.pendingIdentity` (esconder o card levaria junto os campos de PIN). Ver
[tasks/10-nsec-session-start.md](../tasks/10-nsec-session-start.md).

## Dashboard analytics: KPIs, sparklines e barra de saúde dos serviços

`#status-section` deixou de ser uma lista rasa de 4 pares label/valor
(`.status-grid`) e passou a ser um grid de **cartões KPI** (`.kpi-grid` >
`.kpi-card.tone-*`): cada métrica (Túnel/Expira em/Relays/Sessão) ganha um
ícone-chip colorido e um tom de categorização (`tone-primary`/`tone-warning`/
`tone-info`/`tone-accent`) só para leitura visual rápida — os `id`s
(`tunnel-status`, `tunnel-expiry`, `relay-status`, `session-status`) e a
lógica que os popula em `app.js` não mudaram, só ganharam a classe `kpi-value`
além de `status-value`.

`#host-telemetry-section` ganhou três **sparklines** (`.chart-row` >
`.chart-card.tone-*` > `svg.sparkline`) para CPU (carga), RAM e Disco (o
mountpoint mais cheio). Cada gráfico é um `<polyline>`/`<polygon>` SVG puro
dentro de um `viewBox="0 0 100 36"`, redesenhado por `drawSparkline()` em
`app.js` via `setAttribute("points", …)` — nunca `style`/`fill` inline, que a
CSP (`style-src 'self'`, sem `'unsafe-inline'`) bloquearia. Os dados vêm de um
**ring buffer client-side** (`cpuLoadHistory`/`ramPctHistory`/
`diskPctHistory`, cap `CHART_HISTORY_MAX = 30`) alimentado a cada
`fetchTelemetry()` — não existe endpoint de histórico no backend (só
`Store.Latest()` em `internal/store/telemetry.go`), então o gráfico reseta a
cada reload da aba e nunca mostra mais que os últimos ~5 minutos observados
(30 amostras × polling de 10s).

`#services-section` ganhou uma **barra de saúde proporcional**
(`#services-health` > `svg.health-bar` com três `<rect>` — ativos/inativos/
aguardando) mais a legenda com contagem. Mesma técnica dos sparklines: largura
de cada `<rect>` é `x`/`width` calculados em `renderServicesHealth()` e
aplicados via `setAttribute`, nunca `style.width`. É recalculada em todo
`renderServices()`, então acompanha tanto a resposta do host quanto
"Limpar lista".

Nenhum desses três componentes introduz nova cor de status: reaproveitam
`--color-success`/`--color-error`/`--color-on-surface-dim` (via `.dot-good`/
`.dot-bad`/`.dot-unknown` já existentes) para ativo/inativo/desconhecido, e
usam as variantes `-soft` (ver [theming.md](theming.md)) só como fundo dos
cartões — a paleta ampliada (`accent`/`info`) é puramente decorativa/
categorização, não duplica semântica de saúde.

Relacionado: [theming.md](theming.md) (tokens, light/dark, paleta ampliada),
[security.md](security.md) (CSP, cofre de chaves),
[host-telemetry.md](host-telemetry.md) (coleta/persistência da telemetria que
os sparklines consomem).
