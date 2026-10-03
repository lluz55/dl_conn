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
  (`#status-section`, 4 itens inline) + Saúde do host
  (`#host-telemetry-section`) + Abrir porta local
  (`#local-port-section`). Os serviços são o bloco **Serviços** dentro da
  própria Visão geral (`#services-overview`) — ver
  [Uma única lista de serviços](#uma-única-lista-de-serviços).

Em `≥1024px` as duas zonas ficam lado a lado (`grid 1fr 1fr`); abaixo,
coluna única (Setup acima, Live abaixo). No modo setup em desktop a coluna
Setup é centralizada (`max-width: 720px`). **Cues de zona são puramente
espaciais** (gap / leve separação) — sem rótulos.

O header encolhe para só brand + theme + lock; `test-relays` e
`clear-services` saem do header (o primeiro vira card visível; o segundo vai
para o cabeçalho do bloco Serviços, via `.card-head-actions`).

## Por quê

O app tem um state machine claro (`locked → connect → live`) que o layout
plano anterior (4 cards empilhados, painel de relays escondido atrás de um
ícone no header, status sempre visível com "Aguardando túnel…") não
refletia — ruído precoce, baixa descoberta do painel de relays e desperdício
de espaço horizontal no desktop. A divisão faseada elimina os três de uma vez
e respeita as amarras do projeto: CSP `style-src 'self'` (zero inline
`style`, zero CDN), sem gradientes, light/dark, tudo tokenizado em
`--color-*` / `--gap-*` / `--radius-*`.

## Status rail (passo seguinte)

Acima de `main` existe `#status-rail`: uma tira **sticky** com os quatro
fatos que decidem se o túnel serve para alguma coisa — Túnel (com a contagem
de expiração), Sessão, Relays ativos e Serviços ativos/total. Cada item é um
`.rail-item` com um `.dot` graduado por `--color-threshold-*`.

O rail **não guarda cópia própria desse estado**. `syncStatusRail()` lê
direto os elementos autoritativos (`#tunnel-expiry`, `#relay-summary`,
`#session-state-pill`, `state.services`) e um `MutationObserver` —
coalescido via microtask — repinta quando qualquer um deles muda. Doze call
sites atualizam aqueles cards; uma segunda cópia do estado divergiria no
momento em que o primeiro deles esquecesse o rail. De brinde a contagem de
1s da sessão mantém o rail honesto sem nenhum timer próprio.

O rail **não é `aria-live`**: a contagem reescreve a cada segundo e uma região
viva anunciaria isso sessenta vezes por minuto. Os mesmos valores existem nos
cards da Visão geral, para onde um leitor de tela navega.

O rail rola horizontalmente em vez de quebrar, então nunca empurra o conteúdo
que ele resume.

## Uma única lista de serviços

A SPA já teve **duas renderizações do mesmo `state.services`**: uma grade de
cartões em `#services-section` e, dentro da Visão geral, a lista compacta
`#services-overview`. Duas seções chamadas "Serviços" na mesma coluna, com os
mesmos dados, foi ambiguidade de navegação, não riqueza: o usuário não tinha
como saber qual era a canônica.

A lista **ganhou**; a grade foi removida. `#services-overview` é hoje a única
visualização de serviços e absorveu tudo que só existia no card eliminado:

- os controles de gestão (Adicionar / Atualizar / Limpar) no
  `.card-head-actions` do bloco;
- a **barra de saúde** proporcional (`#services-health`);
- o **formulário de serviço personalizado** completo, incluindo a exportação
  YAML/Nix;
- a **descrição**, os **selos** (personalizado · temporário/persistido ·
  não sondado) e o **botão de excluir** por linha.

`renderServices()` deixou de construir cartões e passou a ser a casca de
`renderServicesHealth()` + `renderServicesOverview()` — um ponto de entrada, um
renderizador. `statusDot()` foi dissolvido em `serviceStatusMeta()`, que
resolve `{status, cls, title}` uma vez para o badge do ícone e para o texto da
linha, em vez de as duas renderizações duplicarem a tabela de cores.

Duas consequências que valem o registro:

- **O bloco segue a fase, não a contagem.** `renderServicesOverview()` não
  esconde mais o contêiner quando a lista esvazia — com zero serviços o botão
  "Adicionar serviço" precisa continuar alcançável. A visibilidade vem da
  fase Live (`servicesOverview.classList`), e a lista vazia renderiza
  "Nenhum serviço na visualização." como `<li>`.
- **O CSS da grade foi removido, não deixado órfão**: `.services-grid`,
  `.service-card*`, `.service-top`, `.service-link`, `.service-name`,
  `.service-desc`, `.service-custom-meta` e `.service-unprobed` saíram de
  `style.css`. O badge de saúde continua vindo de `.service-icon .svc-dot`,
  reescalado por `.service-overview-item .service-icon` para a linha.

Relacionado: [Reordenação de serviços](#reordenação-de-serviços) e
[Serviços personalizados no frontend](#serviços-personalizados-no-frontend).

## Medidores e gráfico de histórico

O card Saúde do host tem três blocos, nesta ordem:

1. **Medidores ao vivo** (`#tel-meters`, preenchido por JS) — uma barra por
   recurso *que o host realmente reporta*: CPU, memória, GPU e bateria
   aparecem só quando existem. Barra = `<rect>` SVG com `width` escrito por
   `setAttribute`; a cor vem de `color: currentColor` no `.meter`, então
   `.is-warn`/`.is-crit` é **uma classe** e o valor ainda sai de token. O
   `role="meter"` leva `aria-valuenow`/`aria-valuetext`.
2. **Armazenamento** (`#tel-storage`) — uma linha por ponto de montagem:
   nome, barra, percentual e capacidade absoluta. Rola para 2 linhas em
   `max-width: 639px` via `grid-template-areas` em vez de espremer 4 colunas em
   360px.
3. **Histórico** (`#hist-*`) — gráfico de série com seletor de janela
   (1h/24h/7d) e de métrica (CPU/Memória/Disco/GPU), mais mín/méd/máx.
   Alimentado por `?from=&to=` (ver
   [host-telemetry.md](host-telemetry.md)), então **sobrevive a reload**.
   Decisões que importam:
   - O eixo y é **sempre 0..100**. Um eixo auto-escalado faz uma linha plana
     parecer tempestade.
   - O eixo x é **posicional, não linear no tempo**: uma falha na amostragem
     deve ler como lacuna, e uma espalhadura uniforme mantém a linha contínua.
   - A série é *bucket-averaged* para no máximo 240 pontos
     (`HISTORY_MAX_POINTS`). 7 dias de amostras desenham-se como borrão, e
     por serem sub-pixel, não como linha.
   - Sem dado, o painel diz **"Histórico indisponível neste host"** e segue
     funcionando: um daemon antigo que ignora os params devolve objeto, não
     array, e cai nesse caminho.

Os medidores têm um equivalente textual em `.sr-only` (`#tel-cpu` e afins,
preenchido por `renderTelemetry`). Uma barra comunica "quanto está cheio" de
relance; um leitor de tela só lê números — e os dois precisam concordar.

## Reordenação de serviços

A HTML5 drag-and-drop API foi **removida**: ela não tem suporte a toque
nenhum, então no Android e iOS as alças não faziam nada, e é inalcançável
por teclado. No lugar dela, `attachReorder()` usa Pointer Events — mouse,
toque e caneta num caminho só. A alça é um `<span role="button"
tabindex="0">` com `touch-action: none`; as setas ↑/↓ reordenam e o foco
segue o item movido, senão o próximo `keydown` acertaria o que caiu na mesma
posição. Um toque no **corpo** da linha não arrasta: ele rola a lista. A
âncora de arraste é a linha da lista (`.service-overview-item`) — a grade que
existia ao lado já não participa disso.

## Onde isso vive no código

- `web/index.html`: `.app-columns` / `.col-setup` / `.col-live`; `data-phase`
  em `.app-container`; relay panel sem `hidden`; `btn-clear-services` dentro
  de `.card-head-actions` em `#services-overview`.
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
(`.status-grid`) e passou a ser uma lista vertical de **cartões KPI**
(`.kpi-grid` > `.kpi-card.tone-*`): cada métrica
(Túnel/Expira em/Relays/Sessão) ganha um
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
cada reload da aba e nunca mostra mais que o último ~1 minuto observado
(30 amostras × polling de 2s).

`#services-overview` ganhou uma **barra de saúde proporcional**
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

## Cartão de sessão unificado (redesign definitivo — Fase 15)

O redesign fundiu os três cartões que falavam da sessão (`#vault-section`,
`#auto-lock-section` e o valor "Sessão" do rail de status) em **um único
cartão**: `#vault-section` é agora `.card.session-card` com dois lados —

- `#session-setup`: login/desbloqueio (NIP-07, QR, nsec, prompt de cofre),
  ocultado quando a sessão abre — **exceto** com `state.pendingIdentity`,
  mesma regra antiga (esconder levaria os campos de PIN junto);
- `#session-live`: identidade (`#session-identicon` 3×3 derivado do npub por
  FNV-1a + `#session-npub` truncado), pill de estado (`#session-state-pill`,
  variantes `.p-ok`/`.p-warn` com dot), e `#auto-lock-section` reencarnado
  como `.session-foot` com a **contagem regressiva viva** — barra SVG
  (`#countdown-rect`, largura via `setAttribute`, técnica CSP-safe dos
  sparklines) que congela em âmbar/vermelho nos últimos 33%/10% via classes
  `.is-warning`/`.is-danger` no `.countdown-track`.

Os `id`s antigos (`auto-lock-timeout`, `auto-lock-status`, `biometric-*`)
sobreviveram; `auto-lock-status` virou o `kpi-sub` do cartão "Sessão" na
Visão geral, e o valor do KPI ganha o tempo restante como sufixo
(`#kpi-session-countdown`, "Ativa · 14:32"). O tick vem de um getter aditivo
`SessionManager.secondsRemaining` — janela de inatividade ancorada em
relógio (`_timerStartedAt`), então uma aba em segundo plano mostra a verdade
quando acorda; nenhum timer foi duplicado. A paleta/tema passaram a viver em
`<html>` (`data-palette`/`data-theme`, ver [theming.md](theming.md)).

Os cartões do protótipo (`test.html`) que não têm equivalente dinâmico (file
browser, editor, galerias de exemplo) ficaram de fora — o que migrou foi o
sistema visual, não as demos.

### Paridade de estados com o protótipo aprovado

A primeira migração (Fase 15) levou o vocabulário visual (`.session-main`,
`.session-foot`, pills, identicon) mas deixou dois estados do cartão de
sessão com composição mais pobre que o protótipo:

- **Bloqueada / sem sessão** (`#session-setup` visível): o `.card-head`
  ganhou um `.pill` (`#vault-state-pill`, "sem sessão"/"bloqueada" em
  `.p-warn`) ao lado do `<h2>`, espelhando o resumo de estado que o
  protótipo mostra mesmo antes do login (`setVaultStatePill()` em
  `app.js`).
- **Pendente** (identidade destravada, host ainda mudo): o `.session-main`
  troca o identicon por um `.icon-tile.tone-warning` com ícone de relay, e o
  `.session-meta` ganha uma nota de descoberta ("Descobrindo o host pelos
  relays…") e um `.pill.p-info` "NIP-44", replicando a composição de
  handshake do protótipo (`#session-pending-icon`, `#session-discovery-note`,
  `#session-nip44-pill`; alternado por `setSessionPendingVisual()` nos
  eventos `unlocked`/`pending`/`active`/`locked`/`wiped` do `SessionManager`).

O estado **ativo** permanece deliberadamente mais enxuto que o protótipo: não
há nome de host nem pill de URL do túnel no `.session-meta` — esse contexto
já vive no KPI "Túnel" da Visão geral, e duplicá-lo aqui reintroduziria a
fragmentação que a fusão do cartão de sessão eliminou.

## Serviços personalizados no frontend

O bloco `#services-overview` permite adicionar um serviço local por nome,
porta (`1024–65535`), descrição opcional e ícone escolhido da allowlist do
sprite já incluído na página. O acesso imediato reutiliza a rota autenticada
`/local/<porta>/`: por isso é sempre HTTP-only, aponta implicitamente para
`127.0.0.1` e aparece como **não sondado**, nunca verde. O checkbox WebSocket
não muda essa rota temporária; ele só define o campo `websocket` do fragmento
de configuração permanente exportado.

Serviços vindos da descoberta continuam em `state.hostServices`; cadastros do
usuário vivem em `state.customServices`, e `mergeServices()` produz somente a
visão renderizada. Assim, uma nova resposta Nostr atualiza os serviços do host
sem apagar customizações. IDs/prefixos permanentes normalizados são
religiosamente desambiguados contra IDs e prefixos do host, que sempre têm
precedência. Remover num serviço da lista atua apenas na coleção
personalizada; não existe controle de remoção em serviços configurados pelo
host.

A persistência é opt-in e versionada em `localStorage` pela chave
`dl_conn_custom_services_v1`. Entradas não marcadas ficam somente em memória.
A exportação gera fragmentos para merge, nunca uma configuração completa:
YAML com a chave `services:` para `config.yaml`, e lista Nix para
`services.dl-conn.settings.services`. Ambos usam os campos canônicos do daemon
e alvo fixo `http://127.0.0.1:<porta>`, sem segredo, chave Nostr ou estado de
sessão. A lógica pura de validação, merge e serialização vive em
`web/js/custom_services.js`.

### Indicador de saúde do serviço

O badge de status de cada serviço é gerado **dentro** do ícone
(`.service-icon > .svc-dot`, posicionado no canto superior direito via
`position: absolute`), não mais como um `.dot` irmão ao final de
`.service-top`. `serviceIcon(icon, dotHtml)` recebe o HTML do dot e o injeta
como filho do `<span class="service-icon">`, replicando a sobreposição de
badge do protótipo. A classe e o texto vêm de `serviceStatusMeta(svc)` —
`{status, cls, title}` —, a única tabela que decide verde/vermelho/cinza, e
que a linha da lista consome duas vezes: no badge do ícone e no texto de
status. A semântica de cor (`dot-good`/`dot-bad`/`dot-unknown`) não mudou.
