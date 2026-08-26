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

Relacionado: [theming.md](theming.md) (tokens, light/dark),
[security.md](security.md) (CSP, cofre de chaves).
