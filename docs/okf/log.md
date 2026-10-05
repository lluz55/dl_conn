---
type: log
---

# Log de curadoria do conhecimento

## 2026-10-05

- **O tempo de ligado do host só aparecia em horas.** `formatUptime()` somava
  tudo em horas: `Xh Ym`. Não é um detalhe de estilo — uma máquina ligada há 45
  dias aparecia como `1080h`, um número que não é legível nem se coloca num
  calendário, e a duração é o dado que o operador lê para saber "desde quando
  isso está assim". Agora a duração é **decomposta** em `mês / sem / d / h / min`
  e a pill `#tel-uptime` mostra **as duas maiores unidades**: `42 min` abaixo de
  uma hora, `1 h 0 min`, `3 d 17 h`, `2 sem 3 d`, `1 mês 1 sem` acima disso.
  - **Mês = 30 dias** é convenção, não calendário: uptime é duração, não data,
    e não há mês do calendário para dividir. Só `mês` flexiona (`1 mês` /
    `3 meses`); `sem`, `d`, `h` e `min` são abreviações invariantes, e `min`
    fica por extenso porque um `m` solto seria ambíguo entre minuto e mês.
  - **Duas unidades** é decisão de layout: `.card-head-actions` tem
    `flex-wrap` e a pill é `white-space: nowrap`, então uma terceira unidade
    jogaria a pill para a linha inteira no celular.
  - Entrada negativa ou não numérica vira travessão, como nos outros
    formatadores do painel. O daemon continua mandando `uptime_s` em segundos
    de `/proc/uptime` — nada mudou no protocolo.
  - `web/tests/telemetry_tests.js` cobre a nova escala (0, 1 min, 1 h, 1 d,
    1 semana, 1 mês, plural, fracionário, negativo) e continua avaliando a
    função de produção extraída do fonte. Ver
    [concepts/host-telemetry.md](concepts/host-telemetry.md) (Frontend rendering).

- **Histórico e telemetria remota no GitHub Pages via CORS e Bearer token Nostr.**
  A rota `GET /api/host/telemetry` antes dependia exclusivamente de cookie de mesma origem (`ValidateSession`),
  tornando impossível ler o histórico de métricas (SQLite) a partir de lançadores estáticos como o GitHub Pages
  (`lluz55.github.io`), resultando na mensagem "histórico disponível via túnel".
  1. O daemon Go (`internal/telemetry/handler.go`) agora responde com cabeçalhos CORS (`Access-Control-Allow-Origin`,
     `Access-Control-Allow-Credentials`, `Access-Control-Allow-Methods`, etc.) e trata preflights `OPTIONS` (204 No Content).
  2. A autenticação do endpoint agora aceita tanto a sessão de cookie padrão quanto `Authorization: Bearer <token>`
     gerado pelo handshake NIP-44 via Nostr (`WithTokens(tokenMgr)`).
  3. `TokenManager.Validate(token)` (`internal/auth/tokens.go`) permite validação de leitura durante o TTL do token,
     preservando a possibilidade de consumo único em navegações top-level de serviços.
  4. O frontend SPA (`web/app.js`) agora direciona as requisições de telemetria e histórico para `state.tunnelURL`
     quando disponível, anexando o cabeçalho `Authorization: Bearer <state.authToken>`. Com isso, a SPA no GitHub
     Pages carrega e desenha o histórico completo (1h, 24h, 7d) e mantém os medidores atualizados sem erros 404.

- **Telemetria de host no GitHub Pages via Nostr (sem polling 404) e remoção de relay pago.**
  No frontend SPA rodando no GitHub Pages (`*.github.io`):
  1. `startTelemetryPolling()` e `fetchHistory()` agora verificam `canPollTelemetry()`. Em
     origens estáticas sem backend (`*.github.io`), o polling HTTP relativo contra `/api/host/telemetry`
     é suprimido imediatamente, eliminando os erros contínuos de 404 a cada 2 segundos no console.
  2. Os dados de telemetria recebidos via Nostr (`data.host_telemetry` da resposta de descoberta)
     são preservados na tela, com o selo exibindo `Nostr · ao vivo` (ou `Nostr · ha Xs`), atualizando
     sempre que o usuário renova o status via DM Nostr.
  3. `renderMeters()`, `cpuPercent()`, `hostTempC()` e `tempSourceLabel()` agora suportam os campos
     planos do payload Nostr (`snap.cpu_load1`, `snap.ram_used_pct`, etc.) além dos objetos aninhados
     do HTTP, permitindo que as barras de medidores (CPU, RAM, GPU, Bateria) desenhem corretamente.
  4. O relay `wss://nostr.land` foi removido dos padrões (`DEFAULT_RELAYS` e `config.json`), pois
     passou a exigir pagamento e rejeitava eventos de publicação com `restricted: Pay for access`.

## 2026-10-04

- **O painel Aparência abria, desenhava os três eixos e não fazia nada: erro de
  grafia camelCase/kebab-case no seletor.** O handler `choose()` montava o
  seletor concatenando a chave do `dataset` —
  `closest("[data-" + attr + "]")` com `attr = "themeChoice"` —, o que produz
  `[data-themeChoice]`. O atributo no markup é `data-theme-choice`. O seletor
  não casa com nada, `closest()` devolve `null`, o early return engole o clique
  e **nem o `localStorage` é escrito**: tema, paleta e densidade eram
  inalteráveis pela UI, sem nenhum erro no console. Os tokens, os blocos de
  paleta em `style.css` e o `applyAppearance()` estavam todos corretos — o
  defeito estava inteiramente no nome do atributo, o que explica o sintoma
  "mostra o visual, sem efeito real".
  - O seletor agora sai de `dataAttr()`, que converte a chave, e sai da mesma
    chave que o `dataset` lê: as duas não podem mais divergir. Também houve
    guarda para `event.target` sem `closest`.
  - `web/tests/appearance_tests.js` (novo) **executa** o
    `setupAppearancePanel()` de produção contra um DOM falso e clica de
    verdade: prova que o clique persiste e re-aplica, que clicar no rótulo
    dentro do botão seleciona, e que clicar no fundo do grupo não seleciona
    nada. A primeira versão do teste era uma checagem por regex e **passava no
    código quebrado**, porque derivava o nome do atributo com a mesma regra
    errada do bug — registrar isso porque é a armadilha óbxima ao testar esse
    tipo de defeito.
  - Ver [concepts/theming.md](concepts/theming.md) (Painel Aparência).

- **O histórico continuava vazio depois da correção de tamanho: a causa era o
  daemon em execução, não o código.** O serviço que serve o painel roda
  `dl_conn --config /var/lib/dl-conn/config.yaml`, de um build `dl_conn-0.2.0`
  no nix store — a tag `v0.2.0`, **10 commits atrás** da árvore de trabalho. A
  consulta de intervalo (`e4f6819`) é **posterior** à tag, e a verificação no
  binário confirma: existem `api/host/telemetry` e `telemetry_samples`, mas não
  existe `telemetry history is not available` nem `num_cpu`. Ou seja, o daemon
  ignora `?from=`/`?to=` e responde com o **objeto** do snapshot, enquanto o
  front espera um **array**. Nenhuma versão do front conserta isso — o painel
  não pode funcionar contra esse binário. Corrigido o código, a ação que
  falta é **redeploy** (`nix build`/release e reiniciar o serviço).
  - O front agora **nomeia** esse caso: uma resposta que não é array vira
    "o daemon em execução é anterior ao histórico: reinicie o serviço na
    versão atual…". Antes era um "histórico indisponível" genérico que
    mandava o operador caçar bug no lugar errado.
  - `web/tests/telemetry_tests.js` ganha o caso: um daemon que responde objeto
    é reconhecido como desatualizado, e nenhum dado é extraído dele.

- **Nova categoria de temperatura no gráfico.** `HISTORY_METRICS` deixou de ser
  uma lista de chaves e virou uma tabela de descritores (chave, rótulo,
  **unidade**, **domínio do eixo**, limiar de alerta, extrator da série). O
  motivo é uma soma, não estilo: a série deixou de ser sempre percentual, e
  uma temperatura desenhada no domínio 0..100 % é um **número errado**, não
  só um rótulo errado. Eixo, sufixo de cada número, linha de alerta e legenda
  passam a sair do mesmo descritor.
  - A aba "Temp." lê o sensor da CPU (que todo host x86/ARM expõe) e cai para
    a GPU quando o host não tem sensor de CPU; a legenda diz qual das duas
    está sendo lida, e as duas **nunca** são misturadas numa série — uma linha
    que trocasse de fonte no meio seria uma mentira sobre o host. A categoria
    "GPU" continua sendo utilização, que é a grandeza da barra do medidor.
  - Nenhuma mudança de backend: `cpu.temp_c` já era capturado e persistido
    por amostra. O que faltava era poder mostrá-lo.
  - O teste web avalia a tabela **extraída do fonte de produção** (um
    `extractConstValue` novo no harness), não uma cópia: uma cópia passaria
    happily depois da tabela mudar por baixo.

- **Disco: uma linha por filesystem, não por ponto de montagem.**
  `ReadDisks` deduplicava por mountpoint, que é a chave errada. Medido no host
  de desenvolvimento: `/`, `/nix/store` e
  `/var/lib/containers/storage/overlay` são **o mesmo** volume ext4 (mesmo
  fsid `[-601701970 -330095992]`, mesmos blocks/bfree) e o painel listava três
  linhas idênticas — "3 pontos de montagem" para um disco. Agora a chave é
  `fsKey()`: o **filesystem ID**, com queda para tamanho/livre quando o
  fsid é zero. Bind mounts e subvolumes btrfs colapsam, que é o correto,
  porque `statfs` num subvolume já reporta o número do filesystem inteiro.
  - `internal/sensors/disk_test.go` é novo: o teste do `fsKey` é hermético
    (valores de `Statfs_t` sintéticos) e o de `ReadDisks` lê o `/proc/mounts`
    real afirmando que **nenhuma** dupla de linhas compartilha o mesmo
    `(total, used)` — é a afirmação que falha antes da mudança.
  - Registrado em [host-telemetry.md](concepts/host-telemetry.md) e
    [web-frontend-layout.md](concepts/web-frontend-layout.md).

## 2026-10-03

- **Os gráficos de CPU/memória/disco/GPU não carregavam.** O gráfico de
  histórico (`#hist-*`) é alimentado por `?from=&to=`, e a resposta vinha com
  **toda** amostra gravada na janela. A janela padrão da SPA é 7 dias e o
  intervalo padrão de coleta é 10 s — ou seja, ~60 480 amostras. Medido antes
  da correção: **25,3 MB** por carregamento, 1,06 s de leitura e **820 ms**
  bloqueando um `Insert` concorrente, porque o store é `SetMaxOpenConns(1)` e
  os `Insert` são justamente o que alimenta o gráfico. No cliente, o
  `JSON.parse` dos 25 MB travava a main thread por ~198 ms a cada carga.
  - `Store.RangeBucketed(from, to, maxPoints)` corta a janela em no máximo
    `maxPoints` buckets e devolve a amostra mais nova de cada um, com
    `GROUP BY (ts - from) / bucket`. O bucket é um **divisor da janela** e não
    um tamanho fixo, para os buckets serem intervalos alinhados e nenhuma
    amostra ser contada duas vezes. Depois: **0,10 MB** com `?points=240`,
    118 ms, e espera do writer em 98 ms. Sem `?points=` (SPA antiga) a resposta
    fica em 0,30 MB, porque `maxRangePoints` (720) é o teto padrão.
  - A divisão é sobre os offsets inteiros da janela (`span+1`), não sobre
    `span`. Com `span` a janela que divide exatamente por `maxPoints` devolvia
    `maxPoints+1` grupos, e o teto tem de ser um teto — o teste
    `TestStore_RangeBucketed_CapsRowCount` existe para isso.
  - `?points=N` é limitado a `[1, 720]`, e só um valor não inteiro é `400`:
    pedir mais que o teto é um cliente que ainda não conhece o teto, não um
    erro que valha falhar o pedido. `?points=` sozinho não transforma o pedido
    em intervalo (um teto sem janela não tem o que limitar), o que preserva o
    contrato de compatibilidade da rota sem params.
  - No front, `fetchHistory` parou de ser rearmado a cada tick do poll de 2s:
    hoje tem cooldown de 30 s após qualquer tentativa e cadência de 5 min após
    sucesso. Antes, uma falha repetia a requisição de janela inteira **a cada
    2 s** enquanto a aba ficasse aberta — o defeito se multiplicava sozinho. O
    gráfico também parou de congelar: ele recarrega quando a série envelhece.
  - Falhar não apaga mais a série desenhada, e os quatro estados vazios foram
    separados (carregando / erro do daemon / host sem a métrica / janela sem
    amostras). A GPU é o caso que mais confundia: num host sem `nvidia-smi` o
    gráfico dizia "sem amostras para esta métrica", que é indistinguível de um
    gráfico quebrado. Agora `missingMetricReason()` diz que a coleta usa
    `nvidia-smi`.
  - Registrado em [host-telemetry.md](concepts/host-telemetry.md).

- **Registro de serviços: Home Assistant e `dsh` removidos, Agent of Empires
  entrou.** O `config.example.yaml` (rastreado) e o `config.yaml` local perderam
  as entradas `hass` e `dsh` e ganharam `aoe` (`Agent of Empires`,
  `http://127.0.0.1:25809`, prefixo `/aoe`, ícone 👑). Motivo do registro: o
  `dsh` era o único serviço configurado que usava `originHost`, e o `hass` era
  o exemplo canônico do backend que não suporta subpath — trocar de serviço
  deixaria as duas features sem caso vivo na config e a documentação
  apontando para serviços inexistentes.
  - `originHost: "127.0.0.1:25809"` é obrigatório para o `aoe`, não
    cosmético. O `aoe serve` tem um guard de DNS-rebinding que confia apenas em
    loopback, IP literal roteável e no próprio `--host`; verificado
    empiricamente que `Host: <hostname>.trycloudflare.com` devolve **403** em
    `/` e em `/api/…`, enquanto `Host: 127.0.0.1:25809` devolve 200 — e
    continua 403 se o `Origin` público acompanhá-lo, o que o `originHost`
    resolve ao remover `Origin`/`Sec-Fetch-Site`. A alternativa
    (`--allowed-host` no `aoe`) exigiria ressincronizar e reiniciar o serviço a
    cada rotação de URL efêmera.
  - O `aoe` não tem flag de base path (só `--host`/`--port`/`--remote`), e seu
    HTML referencia `/assets/…`, `/manifest.json`, `/theme-bootstrap.js` e
    `/api/…` na raiz. É o caso do frontend que não conhece o prefixo: os
    assets são reescritos pelo `rewriteAssetPaths` e o resto cai na atribuição
    pelo cookie `dl_conn_svc` — inclusive o `/api/…`, que conflita com a rota
    oculta do Frigate e é resolvido pelo mesmo cookie, na ordem de
    `matchService`. Esse raciocínio passou a ser documentado em função do `aoe`,
    e a doc do `launchTokenFile` ficou genérica (o recurso segue suportado e
    testado, só não está mais em uso por serviço configurado).
  - O `aoe serve` roda com `--no-auth` (permitido só em bind loopback). Atrás da
    sessão Zero-Trust do `dl_conn` isso é aceitável, mas é uma segunda
    credencial a considerar: o `aoe` pode executar comandos no host, então
    `--auth=passphrase` seria a postura mais forte se o proxy deixar de ser a
    única barreira.
  - Prosa de `README.md` (descrição + diagrama), `AGENTS.md` e
    `concepts/architecture.md` passou a citar Agent of Empires no lugar de Home
    Assistant. O histórico datado em `log.md` e nos `tasks/` foi preservado.

- **Harness de UI local (`/dev.html`), atrás de `--dev-mock-auth`.**
  Sobe a SPA real contra sessão, host Nostr e telemetria falsas, para
  trabalhar na interface sem nsec real, relay real ou túnel no ar.

  1. **A propriedade de segurança é o diretório, não a flag — e isso só
     apareceu quando testei de verdade.** A primeira versão punha o harness em
     `web/dev.html` + `web/dev/` e protegia com uma rota 404 explícita.
     Compilei um binário *anterior* a essa rota e ele serviu o harness
     inteiro, funcional, **sem a flag**: `proxy.RootFallback` só encaminha
     para o roteador caminhos que casam com prefixo de serviço, e o resto vai
     para o handler estático — e `isSPAPath()` lista apenas `/`,
     `/index.html`, `/app.js`, `/style.css` e `/_static/`. Qualquer
     *outro* arquivo presente em `webDir` é servido. Movido para `harness/`,
     fora de `web/`: agora não há o que servir, a garantia vale para
     qualquer binário, e `build/web.tar.gz` (montado de `web/`) deixa de
     embarcar código de dev. A flag e o aviso no boot continuam, como
     defesa em profundidade.
  2. **Não fura autenticação.** O harness falsifica estado local do browser;
     toda rota real continua exigindo cookie de verdade. A identidade é
     `k = 1` do secp256k1 — o ponto gerador, uma "null key" conhecido e
     impossível de confundir com a chave de alguém — e nunca é persistida.
  3. **Import map não serve aqui**, e areasono vale registrado: ele exige
     `<script type="importmap">` inline, que `script-src self` bloqueia.
     Afrouxar a CSP na página de dev faria o harness parar de validar o que a
     página real valida. A solução é patchar `SessionManager.prototype` e
     `NostrClient.prototype` — classes, construtores e estado privado reais,
     só os métodos que a SPA chama trocados.
  4. **O harness não precisa de nsec nem npub reais.** A primeira versão
     servia um alias de `web/config.json` em `/dev/config.json`, o que na
     prática obrigava a ter o npub real do host presente só para o harness
     subir — `startNostr()` aborta com "Host npub não configurado" antes de
     qualquer mock. Agora `harness/config.json` é servido pelo mesmo file
     server e usa os pontos geradores do secp256k1 (k=1 identidade, k=2 host),
     bech32 válido e derivado de nada real.
  6. **O corpo vem de `/index.html` em runtime**, para não haver duas cópias
     do markup. O `<script src="./app.js">` do próprio `index.html` é
     removido na injeção: de `/dev/` ele resolveria para `/dev/app.js`, e o
     `dev_boot` já importa o app ele mesmo depois de aplicar os patches. O
     daemon serve também um alias de `config.json` em `/dev/`, porque a SPA
     busca `"./config.json"` relativo ao documento e, sem o alias, o harness
     nasce sem host npub e `startNostr()` aborta antes do mock.

  Dois bugs encontrados **usando** o harness, ambos reais e um deles de
  produção: `setBackendActive()` só emite `"active"` se `_pendingBackend` já
  for true, e quem liga essa flag é o `unlockWithPin` —olvidar disso deixa o
  app travado em "Em espera" sem erro nenhum, porque `startTelemetryPolling()`
  só dispara no evento `"active"`. Ver
  [concepts/testing.md](concepts/testing.md).


- **Passagem do SPA para painel de monitoramento (dashboard industrial).**
  A UI tinha peças de design system prontas que nunca chegaram à tela, e um
  backend que já persistia histórico que ninguém lia. O que mudou:

  1. **Camada de dataviz no sistema de temas.** `--color-chart-1..6`
     (rampa categórica dentro de cada bloco de paleta, com índice 2 no lado
     oposto do eixo azul/laranja para sobreviver a daltônico), mais
     `--color-threshold-ok/warn/crit`, `--color-chart-grid`, `--meter-track`
     e `--meter-fill`. Trocar a paleta agora recolora gráficos, medidores e
     limiares. Detalhes e armadilhas de CSP em
     [concepts/theming.md](concepts/theming.md).
  2. **Terceiro eixo de aparência, `data-density`.** Compacta só é aplicada em
     ponteiro fino, em CSS *e* em JS, porque ela baixa `--control-h` abaixo do
     mínimo de toque de 44px.
  3. **Painel Aparência** expondo os três eixos. As quatro palettes já
     existiam e `dl_conn_palette` já era persistido — `theming.md` registrava
     textualmente "sem UI de troca ainda". Não havia como trocar a paleta.
  4. **`system` virou estado real do tema.** `setupTheme()` lia
     `prefers-color-scheme` uma vez no load e nunca mais: mudar o SO com a aba
     aberta não fazia nada, e o primeiro clique no sol/lua descartava a
     preferência de sistema em silêncio. Agora há listener de `matchMedia`, e o
     binário do header virou atalho explícito que opta fora de seguir o SO.
  5. **Telemetria: de 6 números para medidores + armazenamento por mount +
     histórico.** `sensors.Snapshot` é bem mais rico do que a tela mostrava;
     cada recurso virava **um** número e metade dos campos ia embora. `Disks`
     já era array e virou uma linha por volume — a média escondia exatamente o
     disco que está enchendo.
  6. **Histórico de verdade.** `telemetry_samples` já tinha índice em `ts`, mas
     só existia `Latest()`; as sparklines eram ring buffer client-side que
     zerava a cada reload. Adicionado `Store.Range()` + `?from=&to=` no
     `/api/host/telemetry`, e `WithStore(telStore)` em `main.go` — sem essa
     linha o handler responde 501. Seletores de janela (1h/24h/7d) e de métrica.
     Detalhes em [concepts/host-telemetry.md](concepts/host-telemetry.md).
  7. **`Snapshot.NumCPU`.** Load average só se interpreta relativo ao número de
     núcleos, então sem ele não há como mostrar percentual de CPU — que é a
     única forma do número significar algo num painel.
  8. **Status rail** sticky com Túnel/Sessão/Relays/Serviços, lendo os
     elementos autoritativos via `MutationObserver` em vez de duplicar estado
     em doze call sites.
  9. **Reordenação de serviços trocou HTML5 DnD por Pointer Events.** A API
     antiga não funciona em toque nenhum — as alças eram inertes no Android e
     iOS — e é inalcançável por teclado. Agora há caminho único para mouse,
     toque e caneta, mais ↑/↓ na alça focável.
  10. **Contrato de diálogo reutilizado** (`openDialog`/`closeDialog`/`
      wireDialog`): Escape, foco entrando e foco voltando ao opener. O leitor
      de QR tinha `role="dialog" aria-modal="true"` e nada disso.
  11. **Tooltips `data-tip` finalmente renderizados.** O markup carregava 24
      atributos `data-tip` e **zero** CSS os estilizava: todo botão só-de-ícone
      (lock, refresh, clear, debug, adicionar serviço) saía sem explicação
      nenhuma. Implementados em CSS puro, com variante `data-tip-end` para
      controles no fim da linha e supressão em ponteiro grosso.
  12. **`.status-grid` deixou de ser classe morta.** O markup a carregava desde
      o redesign e este conceito a descrevia como "4 itens inline", mas
      nenhuma regra casava com ela: herdava o `flex-direction: column` de
      `.kpi-grid` e renderizava quatro cards de largura cheia até num desktop
      de 1200px. A regra existe agora e a divergência com o documento acabou.
  13. **`role="progressbar"` sem `aria-valuenow`** na contagem de
      auto-bloqueio: assistive tech não tinha como dizer onde a contagem estava.

  Restrições mantidas: sem framework, sem bundler, sem CDN, CSP
  `style-src self` sem `unsafe-inline` (toda barra e polyline é atributo de
  geometria SVG escrito por `setAttribute`), zero gradiente, tudo tokenizado.

- **Redirecionamento direto em sessões já ativas e suporte a `?next=` autenticado no `RootFallback`.**
  Ao abrir múltiplos serviços a partir do frontend SPA cross-origin (ex.: GitHub Pages):
  1. No `web/app.js`, o token de uso único (`state.authToken`) não era descartado após o primeiro
     resgate, fazendo com que cliques subsequentes submetessem novamente o token já consumido via
     `POST /auth`. Como navegadores não enviam cookies `SameSite=Lax` em requisições POST cross-origin,
     o daemon rejeitava o token expirado e redirecionava para `/?next=<serviço>`. O `openService`
     agora consome `state.authToken = null` na primeira abertura e, para cliques posteriores com sessão
     já estabelecida, navega diretamente via GET (`window.open(serviceHref(...), "_blank")`), permitindo
     que o navegador envie o cookie `SameSite=Lax` sem passar por `/auth`.
  2. No `internal/proxy/router.go` (`RootFallback`), requisições para `/?next=<destino>` feitas por
     clientes que já possuem cookie de sessão válido (`ValidateSession(r) == true`) agora são
     imediatamente redirecionadas (`303 See Other`) para `auth.SafeRedirect(next)` em vez de servir a
     SPA raiz vazia (`index.html`). Isso elimina o cenário em que um acesso redirecionado a `/?next=`
     exibia a tela inicial desautenticada em navegadores que já possuíam sessão ativa.

- **CSP `form-action` bloqueava redenção cross-origin, e `api.trycloudflare.com` capturada em erro.**
  Três causas convergiam para abrir páginas em branco para todos os serviços:
  1. A política de CSP em `web/index.html` e `cmd/dl_conn/main.go` definia `form-action 'self'`.
     Com a migração da redenção do token para `<form method="POST">` (para suporte a cookies
     cross-origin), a submissão a partir do GitHub Pages para a URL do túnel (`https://*.trycloudflare.com`)
     era bloqueada pelo CSP do navegador, deixando a nova aba permanentemente travada em `about:blank`.
     Ajustado para `form-action 'self' https:`, espelhando a diretiva de conexões seguras.
  2. Em erros de inicialização ou rate-limit do `cloudflared`, o daemon capturava
     `https://api.trycloudflare.com` das mensagens de erro do utilitário e anunciava via Nostr,
     fazendo os links apontarem para a API interna da Cloudflare. `extractTunnelURL` agora
     ignora explicitamente `https://api.trycloudflare.com`.
  3. No reaproveitamento de sessão em `POST /auth`, o destino `redirect` agora é lido do corpo
     do formulário em vez de apenas da query string da URL, garantindo que o redirecionamento
     não caia para a raiz `"/"` em acessos subsequentes.

- **`noopener` no pré-open quebrava a redenção: abas de serviço em branco.** O
  login por nsec funcionava, mas clicar em "Abrir" num card de serviço abria
  uma aba `about:blank` em branco e **nunca resgatava o token** — sem POST em
  `/auth`, sem `Set-Cookie`, sem sessão, sem página do serviço. Reportado como
  "as páginas dos serviços não estão sendo mostradas, estão em branco".

  Causa raiz, medida e não deduzida: `redeemToken` pré-abria a aba com
  `window.open("", nome, "noopener,noreferrer")` e depois submete o form com
  `form.target = nome`. O Chromium **não registra no mapa de nomes de contextos
  de navegação uma janela aberta com `noopener`**, então o `target` do form não
  resolve para nada; um form cujo `target` nomeia janela inexistente é uma
  navegação para nova janela, o popup blocker descarta, e a redenção
  desaparece em silêncio. Reproduzido no Chromium 152 (o POST não chega ao
  túnel; sobra uma aba `about:blank`), **e não no Firefox 155**, que executa o
  POST normalmente — por isso a falha é silenciosa e específica de navegador,
  e por isso os testes de unidade não pegavam: eles só verificavam a *forma*
  do código (features, target, campos) contra um stub de `window.open`, que
  nunca exercita o comportamento real do browser.

  Fix em `web/js/api_client.js`: o pré-open não pede mais `noopener`/
  `noreferrer`, e o isolamento que essas flags deviam dar é restaurado
  explicitamente com `severOpener()` — `opener` é atributo gravável
  cross-origin, então atribuir `null` no proxy devolvido corta o caminho de
  volta da página do serviço para a SPA, que era o objetivo real do `noopener`.
  Bônus de robustez: se o popup blocker recusar a janela (`window.open`
  devolvendo `null`), a redenção cai para a aba atual em vez de o clique não
  ter efeito nenhum.

  Verificado ponta a ponta com o **módulo real** em browser real, com clique
  confiável (CDP `Input.dispatchMouseEvent` no Chromium, Marionette
  `WebDriver:ElementClick` no Firefox): antes → `NOTHING — redemption dropped`
  e aba `about:blank`; depois → `POST /auth` com o token no body, `Set-Cookie`
  establishing a sessão, 303 seguido para `/hass/` e a página do serviço
  renderizada. Passa nos dois navegadores. `node web/tests/api_client_tests.js`
  passa, com a asserção que fixava `noopener` invertida e um caso novo para o
  popup bloqueado.

  Registrado porque corrige uma decisão registrada na entrada abaixo — a
  hipótese original ("`form.submit()` com `target="_blank"` não é reconhecido
  como user-initiated") apontava para o alvo errado: o que o Chromium não
  reconhece é o `target` por nome quando a janela foi aberta com `noopener`.
  O `window.open` primeiro e o form fora de `display: none` continuam válidos e
  foram mantidos.

- **Release `v0.2.0` — primeira release com tag.** A `0.1.0` nunca foi publicada:
  era o valor inicial de `version` em `dl-conn.nix`, escrito no commit `62806bb`
  junto com o flake, e 111 commits de funcionalidade se acumularam sobre ele sem
  bump. A escolha por **minor** e não major se apoia em
  [protocol.md](concepts/protocol.md): `ResponsePayload` só ganhou campos
  `omitempty` novos (`description`, `host_telemetry`), nada foi removido ou
  renomeado, então nenhum cliente existente quebra. O intervalo coberto vai das
  fases 1–16 do [tasks/index.md](tasks/index.md) mais as trilhas S15/S16/S17.
  `CHANGELOG.md` foi criado agora — o comando de release documentado em
  `AGENTS.md` usa `--notes-file CHANGELOG.md`, ou seja, o arquivo era exigido
  por esse fluxo e nunca tinha existido. Registrado aqui porque a release
  carrega duas decisões que não estão em nenhum outro lugar: por que minor, e
  por que o `CHANGELOG.md` é a fonte das notas de release.
  **Pendente de decisão do operador:** `golangci-lint run` reporta 42 avisos
  pré-existentes (35 `errcheck`, 7 `staticcheck`) em código que não mudou nesta
  release; `go test`, `go vet` e as 12 suítes de `web/tests/` passam.

- **Nova aba abre com `window.open`, depois form-POST navega para ela.** A
  redenção por form-POST abriu caminho para um segundo bug que a
  substituição direta deixou: a nova aba (`form.target = "_blank"`)
  ficava em `about:blank` em alguns navegadores, porque (a) o form
  estava `display: none`, e (b) `form.submit()` com `target="_blank"`
  em um clique é o padrão que os popup blockers nem sempre reconhecem
  como user-initiated, mesmo dentro de um handler de click. Sintoma
  reportado: "as paginas estão sendo abertas com about blank em vez
  do serviço".

  Fix: o caminho da nova aba agora chama `window.open("", nome, ...)`
  — gesto do usuário dentro do click — para garantir que o popup é
  permitido, e o form submita com `target` apontando para o **nome**
  dessa janela pré-aberta (não o literal `"_blank"`), então a navegação
  cai na aba que já existe em vez de abrir outra. O form também sai
  de `display: none` para `position: absolute; left: -9999px` —
  invisível para o usuário (todos os inputs são `hidden`), mas ainda
  "no layout" para o navegador não pular a submissão. Casos cobertos
  pelos testes: target ausente (sem pré-aberta, navega a aba atual),
  target `_blank` (pré-aberta com nome único, form aponta pra ela),
  chamadas consecutivas com nomes distintos.

  Decisão registrada porque é o tipo de coisa que parece "óbvia na
  teoria" mas só aparece quando o browser decide não gostar do seu
  form: o `window.open` primeiro é o padrão canônico de popup
  user-gesture-bound, e o `display: none` em forms submetidos é uma
  pegadinha conhecida. `go test ./...`, `go vet ./...` e as 12 suítes
  de `web/tests/` passam; lint não introduz warnings novos.

- **Redenção de token agora é form-POST, não `fetch()` cross-origin.** A SPA
  redencionava o token via `fetch(..., {mode: "no-cors"})` e dependia do
  `Set-Cookie` da resposta para abrir o serviço (`web/js/api_client.js`).
  Quando a SPA vive em uma origem diferente do túnel (deploy no GitHub
  Pages), o Chrome moderno trata esse `Set-Cookie` como cookie de
  terceiro e o descarta — o navegador abre a URL do serviço sem sessão,
  o daemon redireciona para o login, e o usuário "perde" o login recém
  feito. Sintoma reportado: *apos o login todos os serviços estão sendo
  redirecionados para a pagina inicial novamente sem os dados de login
  previamente salvos*.

  Fix: a redenção agora monta um `<form method="POST">` oculto, com
  `token` e `redirect` em campos `hidden`, e chama `form.submit()`
  programaticamente — uma navegação top-level. O daemon (`internal/auth`
  /`handler.go` e `internal/auth/login_redirect.go`) detecta o form-POST
  via `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document` (helper
  novo `IsFormSubmission`) e responde `303 See Other` em vez de JSON;
  o `Set-Cookie` da resposta cai em contexto first-party (a origem de
  destino da navegação), o token continua no corpo (nunca na URL), e
  o `JSON` antigo segue valendo para qualquer `fetch()`-based caller
  que ainda dependa dele — `POST /auth` agora bifurca: form-POST → 303,
  fetch-POST → `200 {"redirect": …}`.

  Decisão registrada porque contraria o que o item 3 das decisões S15/S16
  acima diz: o `no-cors` continua (não há `preflight`), mas o que importa
  não é mais o efeito colateral de um `fetch()` — é a navegação em si.
  `go test ./...`, `go vet` e as 12 suítes de `web/tests/` passam;
  lint não introduz warnings novos.

- **SPA 404 após o rebuild S17.** Login continuou respondendo porque Nostr
  e `/auth` vivem em memória; `/` e `/config.json` voltaram 404 porque
  o pacote Nix do `dl_conn` só embute `bin/dl_conn` — o `web/` que o daemon
  serve via `http.FileServer` precisava ser extraído manualmente para
  `/var/lib/dl-conn/web/` a cada release. A primeira tentativa de `nixos-rebuild switch`
  que pegou o commit `fba5aa1` (e qualquer reconstrução subsequente sem o
  passo de rsync) deixa a árvore vazia. O navegador parecia ter "voltado a
  funcionar" só porque a página ficou em cache da sessão anterior.
  Fix estrutural em `6bd5a5d fix(nix): bundle web/ into the dl_conn package`:
  `dl-conn.nix` agora copia `$src/web → $out/share/web` no `postInstall`,
  `nixos/module.nix` define `DL_CONN_WEB_DIR=${cfg.package}/share/web`
  no `Environment`, e `cmd/dl_conn/main.go` lê esse env var com fallback
  para `./web` no dev local. A partir desse commit, `nixos-rebuild switch`
  sozinho mantém dashboard e daemon em sincronia — sem mais `rsync`.

## 2026-10-02

- **Regressão corrigida em S17 (2026-10-02): startup travado + NIP-42 não
  respondido pelo daemon.** O build pós-`fba5aa1` tinha dois problemas
  sobrepostos que faziam o daemon ficar "vivo mas surdo":

  1. **`authHandler.RunCleanup(ctx)` e `telHandler.RunCleanup(ctx)` chamados
     em linha** no `main()`. `RunCleanup` é um loop `for { select { … } }`
     que só termina em `ctx.Done()`, então bloqueava o main goroutine para
     sempre antes de `startDiagnostics`, do goroutine do `handler.Serve` e
     do `ListenAndServe` — daí 9099/9100 recusando conexão, com o cloudflared
     ativo achando IP. Confirmado por SIGQUIT no pgrep'd `dl_conn` mostrando
     `main.run … main.go:101 +0x865 → AuthHandler.RunCleanup → RateLimiter.RunCleanup
     [select]`. Sem `sudo`, não foi possível ptrace o pid de produção
     (user `dl-conn`); o usuário precisa reiniciar o serviço uma vez com o
     build corrigido para sair do estado atual. Fix: ambos em `go …`.

  2. **Daemon sem handler de NIP-42 AUTH.** `relay.damus.io` e
     `wss://nostr.land` passaram a exigir `auth-required:` para kind:4 DM e/ou
     subscribe. O cliente (`web/js/nostr_client.js:112-124`) já responde
     desde `ae7e3e2` via `relay._onauth`; o daemon não tinha equivalente —
     `git log -S "nip42" -- internal/` retornava vazio. O sintoma era um
     tight subscribe/close loop nos relays problemáticos: 12.957
     `nostr: subscribed to …` em 1h51min na sessão de produção, taxa de
     1,8 eventos/s. Fix: `internal/nostr/client.go` ganha `signAuthEvent`
     e o `SimplePool` é construído com `nostr.WithAuthHandler(...)` (caminho
     oficial, não o hack `relay._onauth` que o cliente usa). Após o fix,
     `/debug` mostra `damus.io subscribed=true`, e DM publicado em `nos.lol`
     chega no daemon e é rejeitado pela allowlist como esperado.

  Tarefa registrada em
  [`tasks/s17-nip42-daemon-auth.md`](tasks/s17-nip42-daemon-auth.md).
  Cobertura de NIP-42 passa a ser simétrica cliente↔daemon — ver
  [`concepts/security.md`](concepts/security.md#modelo-de-confianca).

## 2026-09-19

- **Visão geral em lista vertical.** Os quatro cartões KPI de Túnel, Expiração,
  Relays e Sessão continuam com os mesmos IDs, tons e conteúdo, mas `.kpi-grid`
  passou de grade responsiva para uma coluna flex vertical. A mudança reduz a
  variação horizontal da leitura sem tocar na máquina de estados ou na lógica
  de sessão. O teste estrutural em `web/tests/layout_tests.js` fixa o novo
  contrato. Ver [concepts/web-frontend-layout.md](concepts/web-frontend-layout.md#dashboard-analytics-kpis-sparklines-e-barra-de-saúde-dos-serviços).

## 2026-09-16

- **Serviços personalizados no frontend (Fase 16).** O SPA passou a cadastrar
  atalhos HTTP para `127.0.0.1:<porta>` por meio do proxy autenticado dinâmico,
  com nome/descrição/ícone e persistência local explicitamente opt-in. A
  coleção customizada é separada da descoberta do host e mesclada somente para
  renderização, preservando os dois lados em refresh e impedindo colisões de
  ID/prefixo de substituir configuração do daemon. Exportações YAML e Nix são
  fragmentos de merge contendo só serviços personalizados e campos canônicos;
  o checkbox WebSocket é intencionalmente apenas de exportação, pois
  `/local/<porta>/` continua HTTP-only por política de segurança. Ver
  [concepts/web-frontend-layout.md](concepts/web-frontend-layout.md#serviços-personalizados-no-frontend)
  e [tasks/16-custom-frontend-services.md](tasks/16-custom-frontend-services.md).

## 2026-09-13

- **Saúde do host com atualização quase em tempo real.** O polling autenticado
  de `/api/host/telemetry` no SPA passou de 10s para 2s, mantendo pausa quando
  a aba fica oculta, atualização imediata ao voltar e o ticker visual de 1s.
  Os sparklines continuam limitados a 30 amostras e agora representam cerca de
  1 minuto observado. Ver [concepts/host-telemetry.md](concepts/host-telemetry.md)
  e [concepts/web-frontend-layout.md](concepts/web-frontend-layout.md).

## 2026-09-12

- **Redesign definitivo do SPA: o protótipo aprovado virou produção (Fase 15).**
  `web/style.css` foi reescrito a partir do CSS do protótipo — 4 palettes
  (`azure`/`evergreen`/`ember`/`iris`) × light/dark declaradas como
  `data-palette`/`data-theme` no `<html>`, profundidade em camadas
  (escada `--elev-*` com matiz por tema via `--shadow-tint`) substituindo as
  hairlines, tipografia em três famílias **auto-hospedadas**
  (`web/vendor/fonts/`, subsets latin woff2 — a CSP não admite CDN, e o
  daemon ganhou `mime.AddExtensionType(".woff2")` + `font-src 'self'`
  espelhado no `spaCSP` de `cmd/dl_conn/main.go` porque este é obrigado a
  acompanhar o `<meta>` do `index.html`). O cartão de sessão unificou
  identidade + estado + auto-lock com contagem regressiva alimentada pelo
  getter aditivo `SessionManager.secondsRemaining` (janela ancorada em
  relógio, nenhum timer duplicado). Motivo de registrar: é a troca de tema de
  maior superfície desde o app; o contrato de que **blocos dark são sempre
  compostos** (`[data-palette][data-theme]`) e de que os `id`s vistos por
  `app.js`/testes precisaram sobreviver à reescrita do markup está documentado
  em [concepts/theming.md](concepts/theming.md) e
  [concepts/web-frontend-layout.md](concepts/web-frontend-layout.md); rastreio
  em [tasks/15-web-redesign.md](tasks/15-web-redesign.md).
  - Armadilha descoberta na depuração do protótipo: a sequência
    estrela-barra **dentro do texto de um comentário CSS fecha o comentário
    cedo** e faz o parser engolir a regra seguinte inteira (foi o `:root` do
    próprio protótipo, vítima de `--color-*/--gap-*` escrito em comentário).
    Regra prática: nunca curinga adjacente a barra em comentário.
  - Dois testes que estavam vermelhos/pendurados antes desta fase e foram
    consertados junto: `session_tests.js` não terminava (o `setTimeout` de
    15 min do SessionManager segura o event loop — agora `process.exit` com
    o veredito) e o regex de recency-guard do `tunnel_rotation_tests.js`
    não casava com o bloco `pushDebug`+`return` real do `app.js`.
  - Política de lint confirmada na prática: o `golangci-lint` do repo carrega
    41 findings pré-existentes (HEAD = working tree); esta fase não adicionou
    nenhum, e dívida alheia ao escopo não foi tocada.

- **Modernização visual do SPA: dashboard admin com KPIs, sparklines e barra
  de saúde dos serviços.**
  - Paleta ampliada com dois tons de categorização puramente decorativos
    (`--color-accent` roxo, `--color-info` ciano) e variantes `-soft` de
    todos os tons de status/categoria via `color-mix(in srgb, …)` — sem
    bloco extra por tema, porque `color-mix()` resolve `var()` em tempo de
    uso e já herda a sobrescrita light/dark do tom base. Continua zero
    gradiente (a política do projeto): todo tingimento é sólido.
  - `#status-section` virou grid de cartões KPI (`.kpi-card.tone-*`) em vez
    de 4 pares label/valor soltos; mesmos `id`s/lógica de população, só
    ganharam ícone-chip e fundo tingido.
  - Telemetria do host ganhou 3 sparklines (CPU/RAM/Disco) como SVG puro
    (`<polyline>`/`<polygon>` num `viewBox` fixo, pontos escritos via
    `setAttribute`) alimentadas por um ring buffer client-side de 30
    amostras — não existe endpoint de histórico no backend
    (`Store.Latest()` só devolve a amostra mais recente), então o gráfico é
    efêmero por aba, não uma série histórica persistida.
  - Lista de serviços ganhou uma barra de saúde proporcional
    (ativos/inativos/aguardando) desenhada como três `<rect>` SVG com
    `x`/`width` calculados em JS — mesma técnica dos sparklines.
  - Motivo de registrar a técnica: a CSP do projeto (`style-src 'self'`,
    sem `'unsafe-inline'`) proíbe `element.style.foo = …` **e**
    `setAttribute("style", …)`, mas não a manipulação de atributos SVG
    (`points`/`x`/`width`) nem de `class` — por isso todo o "charting" saiu
    sem biblioteca nova e sem violar a CSP, escrevendo atributos SVG em vez
    de estilo inline. Ver [web-frontend-layout.md](concepts/web-frontend-layout.md#dashboard-analytics-kpis-sparklines-e-barra-de-saúde-dos-serviços)
    e [theming.md](concepts/theming.md#paleta-ampliada-para-o-dashboard-tons-de-categorização).
  - Correção incidental: `setSessionStatus()` reatribuía `className` por
    inteiro, o que teria descartado a nova classe `kpi-value` a cada
    mudança de tom de sessão — trocado para `classList.add/remove`
    cirúrgico do prefixo `status-*`.

## 2026-09-11

- Corrigido o HTTP 401 das APIs absolutas do dsh: cookie de bootstrap agora
  usa `Path=/`; cookies `dsh-auth-*` são removidos no encaminhamento a outros
  serviços e validados pelo nome derivado da autoridade do backend. Testes
  cobrem `/api/directoryPicker/list` e isolamento de cookies entre serviços.
  Um marcador `HttpOnly` restrito ao prefixo força cookies antigos de `/dsh/`
  a passarem pelo novo bootstrap, onde são expirados. A origem compartilhada
  continua sendo uma limitação de isolamento no navegador.

## 2026-09-10

- **Bootstrap automático e privado da sessão web do `dsh`.**
  - `ServiceConfig.launchTokenFile` permite que o proxy leia a URL local de
    lançamento somente após autenticar a sessão `dl_conn`, valide origem/path
    contra o `target`, resgate o token no loopback e encaminhe apenas o cookie
    assinado com escopo no prefixo do serviço.
  - O token não passa pela Cloudflare nem aparece no navegador; a integração
    falha fechada e não registra credenciais. A unidade systemd do `dsh` captura
    sua linha de startup atomicamente em `/run/dsh/web-url` com modo restrito.
  - Motivo: eliminar a cópia manual sem desativar a autenticação nativa de uma
    interface capaz de executar comandos no host.

- **Ferramentas de depuração no frontend SPA + recuperação de socket morto.**
  - Sintoma reportado: em alguns navegadores rígidos (qutebrowser), após um tempo
    de uso o backend "some" — nsec/npub válidos, sem erro no console. Firefox
    funciona. Causa raiz: `nostr-tools` `SimplePool` **não reconecta** relés
    automaticamente; se o WebSocket de um relay morre (aba em segundo plano /
    throttling de rede, comum em navegadores rígidos), a assinatura para de
    entregar as respostas do host **silenciosamente**, enquanto a UI ainda acha
    que o relay está conectado — não há exceção, não há `onclose` visível.
  - Adicionado em `web/js/nostr_client.js`: `setDebugListener`/`_debug`, estado
    por relay (`relayStates`), hooks `relay.onclose`/`relay.onnotice` que
    registram o fechamento espontâneo e podam `connectedRelays`, resultado de
    `publish()` **por relay** (não só agregado), `oneose`/`onclose` da
    assinatura, e `getRelayDiagnostics()`/`isAlive()`.
  - Adicionado em `web/app.js`: console de depuração (`#debug-section`, botão
    `#btn-toggle-debug`), `pushDebug`/`renderDebug`, `logIdentity` (npub do
    cliente vs host, dica de `authorizedNpubs`), `reconnectNostr()` (hard
    reconnect: desconecta e re-roda `startNostr`), `runDiagnostics()`
    (self-test manual: reprova relés, reporta liveness, recupera) e
    `startNostrWatchdog()` que **detecta a transição todos-os-relés-mortos e
    reconecta automaticamente** — convertendo o "backend sumiu sem erro" em um
    evento visível + recuperação. Sem telemetry/tráfego extra: o watchdog só
    inspeciona `connectedRelays` em memória e re-assina aos relés já
    configurados.
  - `web/index.html` + `web/style.css`: painel tokenizado (sem inline style, sem
    gradiente, light/dark), botão no header, log monoespaçado colorido por nível.
  - `web/tests/debug_tools_tests.js`: 43 asserções (lê `app.js`/`nostr_client.js`
    como texto e grepa a instrumentação), seguindo o padrão de
    `tunnel_rotation_tests.js`. `node web/tests/*`: 157/157 verde.
  - Motivo de registrar: a causa raiz é um comportamento do
    `SimplePool` (sem auto-reconnect) que afeta só navegadores que matam sockets
    ociosos — não é bug de cripto nem de validação de chave, e é
    indetectável sem o log. A recuperação automática é a correção, não só o log.


Histórico de mudanças relevantes no bundle OKF (`docs/okf/`). Cada entrada:
data, o que mudou, por quê.

## 2026-08-26

- **Planejada a Fase 11 — autorizar npubs com o daemon em execução**
  ([tasks/11-runtime-npub-authorization.md](tasks/11-runtime-npub-authorization.md)).
  - Motivo de registrar: a allowlist é congelada na subida do processo
    (`config.Load` → `nostr.NewClient`, `cmd/dl_conn/main.go`), então autorizar
    um dispositivo novo obrigava a reiniciar o serviço — e reiniciar derruba o
    túnel Cloudflare **efêmero**, invalidando a URL `trycloudflare.com` já
    distribuída. O custo do restart é que justifica a fase; não é conveniência.
  - Decisões tomadas com o usuário: interface é **subcomando CLI**
    (`dl_conn npubs add`), não endpoint HTTP nem action Nostr — a operação é
    administrativa e não deve ampliar a superfície exposta pelo túnel; a
    persistência é o **próprio `config.yaml`** (fonte única de verdade, sem
    segundo arquivo de estado para divergir); escopo só `add`.
  - Armadilha assumida e documentada: sob NixOS o `--config` vem do
    `/nix/store` (read-only), então escrever no `config.yaml` só funciona se
    `services.dl-conn.configFile` apontar para `/var/lib/dl-conn` — o comando
    falha em voz alta com essa instrução em vez de gravar noutro lugar.
  - Efeito colateral que a fase precisa cobrir: `Client.authorized` hoje é
    escrito só na construção e lido pela goroutine do `Serve` sem lock; tornar
    a lista recarregável (SIGHUP) transforma isso em data race, então
    `sync.RWMutex` + `SetAuthorized` fazem parte do escopo, não são extra.
  - Atualizado `concepts/security.md` com a seção da allowlist do daemon: até
    aqui o conceito só falava das chaves do app Flutter e nada dizia sobre quem
    pode alterar `authorizedNpubs` nem por qual caminho.
## 2026-08-25

- **Login por nsec abre a sessão na hora; o cofre virou passo opcional**
  ([tasks/10-nsec-session-start.md](tasks/10-nsec-session-start.md)).
  - Sintoma: nsec aceito ("Conectado: npub1…") e nenhum serviço aparecia.
    Causa: a descoberta pende do evento `"unlocked"` do `SessionManager`, que
    só era emitido por `createVault()`/`unlockWithPin()` — `onLoginNsec`
    apenas guardava a identidade em `state.pendingIdentity`, então
    `session.sk` ficava `null`, `startNostr()` abortava e a coluna Live nunca
    era revelada.
  - Novo `SessionManager.startSession(identity)`: sessão desbloqueada só em
    memória, sem persistir nada. `createVault()` foi dividido (`saveVault()`
    cifra/persiste) e só chama `startSession()` se ainda estiver bloqueado —
    salvar o cofre de uma sessão viva não pode re-emitir `unlocked` e derrubar
    a conexão Nostr.
  - `startNostr()` passou a tratar `timeout`/`failed` de `sendDiscoverRequest()`
    (o retorno era descartado) e ganhou timeout de 30 s apontando
    `authorizedNpubs` — o host descarta em silêncio remetentes fora da
    whitelist (`internal/nostr/client.go` → `ParseEvent`), o que era
    indistinguível de "ainda carregando".
  - Motivo pra registrar: a decisão de que **a chave em memória basta para
    usar o app** e o cofre é conveniência (não porta de entrada) é o oposto do
    que o fluxo anterior codificava, e contradizê-la reintroduz o bug.

- **Reformulação de layout do SPA (`web/`): colunas Setup × Live.**
  - `index.html`: envolve o conteúdo em `.app-columns` com `.col-setup`
    (Identidade + Relays) e `.col-live` (Status + Serviços); `data-phase`
    (`setup`/`live`) no `.app-container`; painel de relays **promovido** de
    toggle no header para card visível (sem `hidden`); `btn-clear-services`
    relocalizado para `.card-head` dentro de `#services-section`; header
    enxuto (só brand + theme + lock).
  - `style.css`: `.app-columns` (grid 1fr; `≥1024px` → `1fr 1fr`), `.col`,
    `.col-live` (oculto em setup, flex em live), `.status-grid` vira rail
    flex inline, `.card-head`, header slim (brand/tipo menores); sem
    gradiente, sem inline, light/dark mantidos.
  - `app.js`: `data-phase="live"` em `handleNostrResponse` (revela a coluna
    Live na resposta do túnel Nostr); `data-phase="setup"` em
    `onSessionEvent` (`locked`/`wiped`); `renderRelayList()` no `init` para
    popular o painel promovido; removidos `btn-test-relays`/`toggleRelayPanel`.
  - Motivo: o layout anterior era uma lista plana de 4 cards que não
    refletia o state machine do app (`locked → connect → live`), escondia o
    painel de relays atrás de um ícone e desperdiçava o espaço horizontal do
    desktop. A divisão faseada elimina ruído precoce, melhora a descoberta de
    relays e respeita a CSP (`style-src 'self'`, zero inline/CDN). Decisão
    registrada em `concepts/web-frontend-layout.md`.
  - Verificação: `node --check app.js` verde; `grep 'style='` em `index.html`
    sem ocorrências (CSP ok); IDs exigidos presentes; `data-phase` cabeado.

- **Correção de bug: login NIP-07 não revelava os serviços.** Causa raiz:
  `onLoginNip07()` obtém só o `npub` (a extensão NIP-07 nunca expõe a chave
  privada) e chamava `startNostr()`, que aborta em `if (!state.session.sk)
  return;` — assim `handleNostrResponse` nunca disparava, `data-phase` ficava
  `"setup"` e a coluna Live (com Serviços) permanecia oculta. Como a
  descriptografia NIP-44 da resposta do host exige a chave privada, NIP-07
  sozinho nunca conseguiria mostrar serviços. Corrigido: `onLoginNip07` não
  chama mais `startNostr()` silenciosamente; se não houver `state.session.sk`,
  semente `pendingIdentity` e revela o fallback de nsec para o usuário
  completar o fluxo seguro de cofre (que possui a chave). Verificado em
  navegador headless (Chromium + Playwright-core): NIP-07 → fallback de nsec
  → salvar cofre → `data-phase="live"`, coluna Live visível, serviço
  renderizado.

- **Correção: Serviços não apareciam após login (coluna Live oculta / prompt de
  host-npub escondido).** Dois pontos: (1) `showHostNpubPrompt()` revelava
  `#host-npub-section`, mas esse elemento vivia DENTRO de `#vault-section`, que
  `onSessionEvent("unlocked")` esconde — logo o prompt ficava invisível e o
  fluxo travava silenciosamente quando `host_npub` não estava configurado
  (ex.: `config.json` sem `host_npub` ou não carregado), nunca chegando aos
  serviços. Corrigido: `#host-npub-section` foi movido para `<section>
  standalone` em `.col-setup` (fora do vault), revelável de forma independente.
  (2) A coluna Live só revelava após a resposta do host, deixando a tela em
  branco durante a conexão (sem feedback de "conectando"). Corrigido:
  `onSessionEvent("unlocked")` agora define `data-phase="live"` ao autenticar,
  revelando a coluna Live (status rail) imediatamente; os serviços populam
  quando o host responde. Verificado em Chromium headless: (A) com `host_npub`
  configurado → `data-phase="live"`, coluna Live visível, serviço renderizado;
  (B) sem `host_npub` → coluna Live revelada e prompt de host-npub **visível**
  (antes escondido), permitindo que o usuário informe o npub e prossiga.

## 2026-08-23

- **Redesign visual do frontend SPA (`web/`):**
  - `index.html`: estrutura semântica (`<header>`/`<main>`), sprite SVG inline de
    ícones (outline, `currentColor`) reusado via `<use>` — substitui todos os emoji
    estáticos. Nova seção de status com indicador de expiração do túnel.
  - `style.css`: reescrita completa como design system em tokens CSS — light/dark
    (via `data-theme` + `prefers-color-scheme`), tipografia fluida (`clamp`),
    elevação por *drop-shadow* sólido (nunca gradientes), cards com hover elevado,
    switches e dots coloridos, micro-interações respeitando `prefers-reduced-motion`.
  - `app.js`: alternância de tema com SVG (sol/lua), resumo de health com dots
    coloridos (sem emoji), cards de serviço enriquecidos (ícone, live-dot, descrição
    opcional, CTA com ícone de saída), contador de expiração do túnel
    (`expires_in_seconds`) e status da sessão ao vivo (Ativa/Bloqueada).

- **UX de login NIP-07 sem provedor:** `onLoginNip07()` agora detecta a mensagem
  "NIP-07 extension not found" e, em vez de expor um erro opaco, abre
  automaticamente o `<details>` de fallback `nsec` e orienta o usuário
  ("Extensão NIP-07 não detectada. Insira seu nsec abaixo."). O aviso original
  é informativo e esperado — `window.nostr` só existe com Alby/nos2x/Amber
  instalado sobre origem segura (https/localhost, nunca `file://`).
  - Responsividade: mobile = coluna única + formulários empilhados + grade 1 coluna;
    telas grandes = container até 1200px, grade de serviços 3–4 colunas, foco
    visível via `:focus-visible`.
  - Motivo: a SPA era visualmente genérica (emoji, sombra única, `max-width: 900px`).
    O redesign a torna profissional/elegante e verdadeiramente responsiva entre
    smartphones e desktops, respeitando as restrições do projeto (nenhum degrade,
    cores/spacing via tokens, e nenhuma alteração na lógica de criptografia/sync
    NIP-44 — os testes `web/tests/*` continuam verdes: 71/71).
  - **Fase 7 (`07-relay-testing.md`):** Diagnóstico e teste de latência (RTT WSS),
    probing NIP-11, CRUD e seleção inteligente de relays no frontend SPA (`web/`).
  - **Fase 8 (`08-session-vault-auth.md`):** Armazenamento local seguro do
    `npub`/`nsec` via cofre Web Crypto API (PBKDF2 + AES-256-GCM), desbloqueio
    de sessão por PIN e autenticação biométrica via WebAuthn (`navigator.credentials`).
  - Motivo: Prover observabilidade de rede na conexão com relays Nostr e
    eliminar a fricção de login repetitivo de `nsec` sem comprometer a segurança
    (zero chaves privadas em texto plano no storage do navegador).
- Criação do plano detalhado de implementação para o projeto `dl_conn` em
  `docs/tasks/` e `docs/okf/tasks/` (Fases 1 a 6). Arquitetura definida:
  daemon Go standalone + orquestrador de túnel efêmero Cloudflare
  (`trycloudflare.com`) + sinalização e descoberta P2P via Nostr (NIP-44) +
  gatekeeper Zero-Trust com tokens de uso único e cookies de sessão + proxy
  reverso multiplexador com WebSockets/streaming de vídeo para Home Assistant,
  Frigate e Zigbee2MQTT + SPA estática no GitHub Pages.
  Motivo: prover acesso remoto universal, seguro e sem abrir portas ou expor IP
  aos serviços locais do host NixOS `n100`.
- Implementação completa das 6 fases:
  - **Fase 1:** `go.mod`, `flake.nix` (devShells + packages.default +
    nixosModules.default), `internal/config/` (parser YAML/env + validação +
    testes), `config.example.yaml`, `cmd/dl_conn/main.go`.
  - **Fase 2:** `internal/tunnel/manager.go` (cloudflared subprocess, regex
    parser, channel notificação, auto-restart com backoff exponencial,
    shutdown gracioso), `internal/tunnel/parser.go`, testes.
  - **Fase 3:** `internal/nostr/` (cliente SimplePool multi-relay, NIP-44
    encrypt/decrypt, decodificação nsec/npub, handler com whitelist, protocolo
    de request/response JSON), testes de round-trip NIP-44 e whitelist.
  - **Fase 4:** `internal/auth/` (tokens one-time CSPRNG 256-bit com TTL,
    sessions com cookies HttpOnly/Secure/SameSite, endpoint `/auth` com
    redirect), `internal/proxy/` (reverse proxy com StripPrefix, headers
    X-Forwarded, WebSocket upgrade, Zero-Trust middleware 403),
    `internal/proxy/hub.go` (WebSocket hub para streaming), testes de
    integração full-auth-flow + Zero-Trust blocking.
  - **Fase 5:** `web/` SPA estática (`index.html`, `style.css` com tokens CSS
    + dark/light + breakpoints, `app.js`, `js/nostr_auth.js` NIP-07+nsec,
    `js/nostr_client.js` NIP-44 via nostr-tools CDN), `.github/workflows/
    deploy-pages.yml`.
  - **Fase 6:** `nixos/module.nix` + `dl-conn.nix` (NixOS module com
    DynamicUser, hardening, sops secret), integração no
    `/home/lluz/nixos-config` (input `dl-conn`, `services.dl-conn` no
    `hosts/n100/default.nix` mapeando HASS/Frigate/Zigbee2MQTT + secret SOPS),
    `docs/runbook.md`.

- **Diagnóstico e correção de regressão no login `nsec` + cliente NIP-44 (`web/`):**
  - **Bug relatado:** `Erro: nsec deve decodificar para 32 bytes` ao inserir um
    `nsec` válido (`nsec1gccfk4suf25m4aarcgrl6uwf902whqkcuy85hdtdy264khr2rlnsrfn7kv`).
  - **Causa raiz:** `nostr-tools@2.9.2` `nip19.decode(nsec).data` retorna um
    **`Uint8Array`** (não uma string hex), e `nostr_auth.js#loginNsec` tratava
    `data` como se fosse `string` → a checagem `typeof skHex !== "string"`
    lançava espremendo o caminho de erro. Corrigido convertendo
    `Uint8Array` → hex de 64 chars antes da validação. O `nsec` acima decodifica
    para os 32 bytes esperados (verificado: `sk` = 64-hex, `getPublicKey` →
    `pub` válida `c6a71dcff32...`).
  - **Nota de interop:** o *summary* inicial hipotetizou que `nip19.decode`
    retorna hex *string* para `npub` (o oposto de `nsec`) — confirmado: sim,
    `npub`→`string`, `nsec`→`Uint8Array`.
  - **Bugs adicionais descobertos ao validar o caminho pós-login (cliente NIP-44
    não tinha cobertura de teste `web/tests`, então ficaram latentes):**
    - `nostr_client.js` chamava `nip44.conversationKey(...)`, que **não existe**
      na v2.9.2 (o namespace exporta apenas `encrypt`, `decrypt`,
      `getConversationKey`, `v2`). → `TypeError` em runtime. Corrigido para
      `nip44.getConversationKey(priv, pub)` (ordem correta: nossa privada,
      pública do peer).
    - `sendDiscoverRequest` fazia `nip19.decode(senderNpub)` onde
      `senderNpub` já é hex (`getPublicKey`), lançando `Unknown letter: "b"`.
      Corrigido com helper `toHexPubKey(value)` que aceita hex ou bech32.
    - `_signEvent` usava `signEvent(sk, event)` (removido na v2.9.2).
      Corrigido para `finalizeEvent(event, sk)` (ordem de argumentos: evento,
      chave). O template de evento de requisição também carecia de `created_at`,
      exigido por `serializeEvent`.
    - `subscribeToResponses` rejeitava respostas válidas: verificava
      `incomingEvent.pubkey !== receiverNpub` (o remetente da DM é o *host*, não
      o cliente). Corrigido para comparar contra `hostPubHex`.
  - **Prova empírica (Node, esm.sh remapeado para `nostr-tools@2.9.2` local):**
    round-trip completo com dois pares de chaves — cliente assina+cifra
    requisição (`finalizeEvent` + `getConversationKey(clientPriv, hostPub)` +
    `nip44.encrypt`) → host decifra com `getConversationKey(hostPriv, clientPub)`
    (mesmo CK — ECDH simétrico, interoperável com Go
    `GenerateConversationKey`) → host responde assinado+cifrado → cliente
    decifra via `subscribeToResponses`/`_decryptEvent`. 12/12 asserções passam.
    `sessionStorage` não expõe chave privada em texto plano.
  - **Verde:** `node --check` em `app.js`, `js/nostr_auth.js`, `js/nostr_client.js`;
    `web/tests/*`: 71/71 (crypto 19 + relay 40 + session 12). Go não alterado
    (NIP-44 server-side já coberto por `internal/nostr` round-trip).

- **"Apagar todos" no frontend:** botão (ícone `i-trash` + texto) no cabeçalho da
  seção Serviços (`index.html` → `#btn-clear-services`, `app.js` → `onClearServices`).
  Limpa `state.services[]` e re-renderiza com placeholder `services-empty`.
  Serviços não são persistidos (vêm do discover via Nostr), então o botão só
  limpa a visualização; ao reconectar/re-descobrir repopulam. Header responsivo:
  empilha título+botão no mobile (`max-width:639px`), separa à direita no
  desktop. Tokens/CSS: reaproveita `--gap-*`/`--fs-sm`/`--radius-card` — sem
  cores/spacing hardcoded. `app.js` não é coberto por `web/tests/` (IIFE sem
  export; flow completo exige host vivo), validado por `node --check` + review.
- **Visibilidade do botão "Apagar todos" e tooltips:** o botão estava dentro de
  `#services-section`, que fica `hidden` até o discover via Nostr responder — por
  isso não aparecia no frontend. Relocalizado para `.header-actions` como um
  `btn-icon` (ícone `i-trash`) sempre visível (como os demais do header), com
  `aria-label` + tooltip. Tooltips (`data-tip` + CSS `::after`/`::before`, tokens
  sem hardcode, respeita `prefers-reduced-motion` e `:focus-visible`) adicionados
  a todos os botões existentes (header, login, vault, relays) — nenhum tinha.
  Botões de toggle/remove de relay (gerados em `app.js#renderRelayList`) também
  receberam tooltip. `node --check app.js` verde; web tests mantidos 71/71.
- **"Apagar todos os dados" (factory reset do frontend):** botão `#btn-clear-all`
  (`btn-link-danger` + ícone `i-alert`, tooltip) na seção Identidade. `onClearAll()`
  (com `confirm` irreversível) limpa **todo** dado `dl_conn_*` de `localStorage`
  (vault, host_npub, theme, relays, brute_force, webauthn_cred) e `sessionStorage`
  (npub, sk, bio_pin) via `startsWith("dl_conn_")` + `session.wipe()` (WebAuthn +
  vault + brute-force) + estado em memória (services, tunnelURL, authToken,
  config.hostNpub, nostr, timer) + `location.reload()`. Prove estático: o sweep
  cobre todos os 8 prefixes de chave usados em `js/*` + `app.js`. Após reload,
  `loadConfig()` restaura host_npub/relays do `config.json` (estático, re-fetchado)
  e mostra a tela de login limpa. Diferente de `onWipe` ("Esqueci o PIN"), que
  mantém host_npub/theme — este é o reset total.
- **Por que o "Apagar todos os serviços" não aparecia:** estava dentro de
  `#services-section`, que só recebe `remove("hidden")` dentro de
  `handleNostrResponse` (após o discover via Nostr responder). Antes de um
  túnel/discovery bem-sucedado a seção (e o botão) ficam ocultos — esperado,
  não bug. O botão "Apagar todos os dados" (identidade) agora vive na seção de
  Identidade, sempre visível no welcome/login.

- **Erro de runtime na conexão de relays (`web/js/nostr_client.js`):** o SPA exibia
  `Relays Erro: Class constructor Ps cannot be invoked without 'new'` (`Ps` é o nome
  minificado pelo bundle esm.sh de `SimplePool`).
  - **Causa raiz:** em `nostr-tools@2.9.2`, `SimplePool` é uma **classe** —
    `nostr_client.js#connect()` chamava `SimplePool()` sem `new`. Como
    `nostr_client.js` não era importado por nenhum teste de `web/tests/*` (ele
    importa `https://esm.sh/...`, que o Node não resolve sem loader) e usava uma
    API de pool anterior, **quatro** mismatches v2.9.2 ficaram latentes juntos:
    `ensureRelay(url)` é `async` e já conecta internamente (o código não dava
    `await` e chamava `relay.connect()` sobre uma Promise → TypeError);
    `subscribe` não existe (o método é `subscribeMany(relays, [filter],
    {onevent})`, sem retorno `.subscribe()`); `publish` retorna um **array de
    Promises**, não um emitter `.subscribe()`; `close("str")` exige um **array de
    URLs** (uma string lança TypeError).
  - **Correção:** `new SimplePool()`; `await this.pool.ensureRelay(url,
    {connectionTimeout:5000})` (sem `connect` pós); `subscribeMany(relays,
    [filter], {eoseTimeout, onevent})` (a sub fica aberta após EOSE por
    padrão — não há `closeOnEose` na v2.9.2); `publish`→
    `Promise.allSettled` do array (resolve no primeiro ACK); `destroy()` no
    `disconnect()`. `getConversationKey(priv,pub)` e `finalizeEvent(event,sk)`
    (ordem já correta) foram mantidas.
  - **Prova empírica:** round-trip bidirecional cliente↔host através do
    **arquivo real** `js/nostr_client.js`, contra o `SimplePool` real v2.9.2
    (esm.sh remapeado para o pacote local via loader + `global.WebSocket` stubado
    com um relay em-processo que fala o wire protocol v2) — 8/8 asserções.
    **Teria falhado antes:** `SimplePool()` sem `new` lança "Class constructor
    Ps…"; `subscribe`/`publish.subscribe`/`close(string)` não existem na v2.9.2.
  - **Verde:** `node --check` em `app.js`, `js/nostr_client.js`, `js/nostr_auth.js`;
    `web/tests/*`: 71/71 (crypto 19 + relay 40 + session 12, não afetados — não
    importam `nostr_client.js`); round-trip real-`SimplePool` 8/8. Go
    (`internal/nostr`) não alterado.

## 2026-07-24

- Novo conceito `scaffolding` + gerador `scripts/new-screen.sh`: geração
  determinística e não-interativa de tela nova, já com i18n pt+en, tokens de
  `dl_concept`, `ConsumerWidget` e teste widget. Motivo: automatizar o
  componente repetitivo mais comum de forma otimizada para consumo por agente
  LLM — o ganho é eliminar variância e nascer dentro da "definição de
  concluído" (i18n/tema/teste), não velocidade de digitação. Verificado:
  saída passa `dart analyze --fatal-infos`, é no-op sob `dart format` e o
  teste gerado passa. Registrado como caminho preferencial em AGENTS.md.
- Conceito `scaffolding` ampliado para "Automação: geradores e gate de
  verificação" e novos scripts: `verify.sh` (gate único que espelha o CI —
  format+analyze+testes+segredos+anti-padrões+OKF+protocolo+Go), `new-repository.sh`
  (feature de dados: entidade+porta+impl. CRDT+teste, com field spec tipado),
  `new-concept.sh` (conceito OKF com frontmatter válido + registro no index) e
  `add-l10n.sh` (chave i18n simétrica nos dois `.arb`). Motivo: pesquisa de 2026
  aponta que o gargalo do agente é **verificação, não geração** — daí o gate
  `verify.sh` ser o item de maior alavancagem, complementado pelos geradores dos
  padrões repetitivos restantes. Verificados no Nix: Dart gerado passa
  analyze/format, testes passam, check-okf verde.

## 2026-07-11

- Bundle OKF criado junto com o scaffold inicial do template (fundação:
  `flake.nix`, app Flutter, CLI Go, protocolo compartilhado). Conceitos
  iniciais: `environment`, `architecture`, `data-model`, `sync`, `protocol`,
  `security`, `ui-adaptive`, `performance`. Motivo: registrar o "porquê" das
  decisões já tomadas em SPEC.md antes que o código cresça e o contexto se
  perca.
- Adicionados `theming` e `i18n` (SPEC §9.1/§9.2): sistema de temas
  (tokens, Material You via `dynamic_color`) e internacionalização
  (`flutter_localizations`/`intl`, `pt`+`en` desde o início) formalizados
  como requisitos de primeira classe, com wiring real em `app/lib/main.dart`,
  `app/lib/ui/router.dart` e nas telas existentes.
- Adicionado `testing`: convenção de onde cada camada de teste vive e a
  armadilha `pumpAndSettle()` × `CircularProgressIndicator` indeterminado,
  descoberta ao corrigir `app/test/widget/adaptive_nav_test.dart` (o teste
  travava por timeout, não por bug real de sincronização). Motivo: essa
  lição não é óbvia lendo só o código — vale documentar antes que alguém
  reintroduza `pumpAndSettle()` num teste futuro com spinner na árvore.

## 2026-07-19

- Bundle movido de `knowledge/` para `docs/okf/` (todas as referências em
  SPEC.md, AGENTS.md, README.md, CHANGELOG.md, `scripts/check-okf.sh`,
  `scripts/check-protocol-parity.sh`, `scripts/rename-template.sh` e
  `app/pubspec.yaml` atualizadas). Motivo: alinhar o caminho do bundle à
  convenção `docs/okf/` esperada pelo workflow de agente do projeto.
- Adicionado `tasks`: rastreamento de trabalho pendente em dois níveis —
  marcadores `TODO(fase-N)`/`"Fase N"` inline no código (granular) e um
  arquivo por fase em `docs/okf/tasks/` (`01-fundacao.md` … `06-polimento.md`
  + `index.md` com o resumo de progresso), amarrados às 6 fases do SPEC §17.
  Motivo: dar visão de progresso por fase sem perder o detalhe granular já
  coberto por `scripts/list-todos.sh`; os dois níveis devem ficar
  sincronizados ao fechar sub-tarefas.
- Tema e navegação adaptativa extraídos de `app/lib/ui/theme/` e
  `app/lib/ui/nav/` para o pacote reutilizável `packages/dl_concept/`
  (consumido pelo app via path dependency em `app/pubspec.yaml`), atualizando
  `theming.md`, `ui-adaptive.md` e `docs/okf/tasks/01-fundacao.md`. Motivo:
  permitir que outros projetos (instanciados deste template ou não)
  reaproveitem o design system sem copy-paste, via git dependency apontando
  pro subdiretório `packages/dl_concept`. Escopo v1 é só relocação do que já
  existia — sem componentes novos.

## 2026-07-22

- Atualizado `testing`: nova armadilha — `sqflite_common_ffi` (isolate real
  por trás de toda consulta) trava indefinidamente dentro de `testWidgets`,
  mesmo com `tester.runAsync()`, sem lançar exceção. Descoberta investigando
  um relato de "nenhum componente novo aparece na tela inicial": não havia
  bug — nenhum teste populava `ItemsScreen` com dados reais antes
  (`adaptive_nav_test.dart` só cobre a shell de navegação, com lista sempre
  vazia). Corrigido testando `ItemsScreen` contra um `ItemRepository` fake
  (`app/test/widget/items_screen_test.dart`), que prova a árvore renderiza
  `Card`/`AppDismissibleListItem` corretamente com dados — sem depender do
  banco real. Motivo: essa armadilha custou várias tentativas de diagnóstico
  (aumentar `pump()`, tentar `runAsync()`) antes de identificar que o
  problema era do binding de teste, não do código; vale documentar antes que
  alguém repita o mesmo caminho.

## 2026-07-24

- Atualizado `testing`: a armadilha `pumpAndSettle()` × spinner indeterminado
  agora cita `AppExpressiveLoadingIndicator` (não mais
  `CircularProgressIndicator`) como o widget indeterminado da
  `ShowcaseScreen` — o indicador nativo foi substituído (ver abaixo), mas a
  lição em si (nunca `pumpAndSettle()` numa árvore com spinner indeterminado)
  continua igual.
- `packages/dl_concept/`: adicionados `AppExpressiveButton`,
  `AppExpressiveFab`, `AppExpressiveCard`, `AppExpressiveChip` e
  `AppExpressiveLoadingIndicator` — identidade visual estilo M3 Expressive
  (forma que "morfa" por estado — pressionado/selecionado — em vez do raio
  único fixo do resto do tema) para os componentes equivalentes já temados
  via `*ThemeData`. Nasceram de uma tela de comparação
  (`ComponentGalleryScreen`, `app/lib/ui/screens/`) com 3+ variações
  numeradas por componente (M3 Expressive vs. alternativas não-M3:
  neumorphism, glassmorphism, gradiente, shimmer); o usuário escolheu a
  variação M3 Expressive para os 5 componentes e ela passou a ser usada de
  verdade na `ShowcaseScreen` (a página inicial), substituindo
  `FilledButton`/`Card`/`FilterChip`/`FloatingActionButton`/
  `CircularProgressIndicator` nas seções correspondentes. Motivo pra
  registrar: esses widgets fogem à regra geral do README do pacote
  ("prefira temar o widget nativo a envelopar") — a exceção documentada lá
  é que forma animada por estado não é expressável só com `*ThemeData`
  (`ButtonStyleButton`/`CardThemeData`/`ChipThemeData` não animam mudança de
  forma), então um widget próprio foi o único jeito de entregar o visual
  escolhido.

## Fase 12 — status de serviço confirmado por probe

O ponto verde do card de serviço passou a significar **observação**, não
configuração: antes ele vinha de `services[].websocket` (um flag do YAML), o
que fazia serviço desligado aparecer "Live" desde o primeiro segundo. Agora o
daemon roda `internal/health.Monitor` (dial TCP no `target`, a cada 30 s),
carimba `status` (`up`/`down`/`unknown`) em cada `ServiceInfo` no momento da
resposta Nostr, e a SPA só pinta `.dot-good` para `up`. Motivo de registrar: a
escolha de sondar **no host** (e não pela SPA, através do túnel) é o que evita
precisar de CORS no proxy, e o preço assumido é que o dashboard mostra o último
probe conhecido, não um stream ao vivo. Ver [tasks/12-service-health-status.md](tasks/12-service-health-status.md).

## Acesso dinâmico a serviços HTTP em loopback

O dashboard ganhou um campo de porta que abre `/local/<porta>/` usando a mesma
sessão Zero-Trust dos serviços configurados. O handler dedicado resolve o alvo
somente como `127.0.0.1`, remove credenciais internas antes do encaminhamento,
rejeita WebSocket e bloqueia portas privilegiadas, os listeners do daemon e a
denylist extensível `dynamicPorts.deniedPorts`. Motivo de registrar: permitir
uma porta arbitrária amplia a superfície de acesso do usuário autorizado; a
restrição de host, o bloqueio explícito e o isolamento de cookies são limites
de segurança deliberados, não detalhes de implementação.

## Correção — resumo de relays contava latência como desconexão

`updateRelaySummary` (`web/app.js`) filtrava por `r.ok && r.rttMs < 600` e
chamava o resultado de "relays conectados". Relay lento porém online saía da
contagem enquanto sua linha na lista mostrava badge colorido e RTT — o resumo
e a lista discordavam sobre o mesmo relay, e o usuário lia isso como "vários
offline". Passou a contar só `r.ok`, com os lentos reportados como sufixo
separado, e o limiar virou `SLOW_RELAY_MS`, único para resumo e badge. Motivo
de registrar: a regra geral é que **um rótulo de contagem tem que descrever
exatamente o predicado que ele conta** — misturar disponibilidade com
qualidade num só número foi a origem do bug. Ver
[tasks/07-relay-testing.md](tasks/07-relay-testing.md#correções-posteriores).

## Trilha de segurança — hardening de borda e autenticação avançada

Fases [s15](tasks/s15-security-hardening.md) e [s16](tasks/s16-security-auth-advanced.md),
implementadas juntas. Oito controles de borda (remoção de `Authorization` por
padrão, HSTS condicional, Permissions-Policy, cookie `Partitioned`, rate limit em
`/auth`, cache+rate limit de telemetria, `iframe` fora das navegações, IP
anonimizado no log) e três mudanças de fluxo (POST/header em vez de token na
URL, step-up opt-in, zeragem da chave em memória).

Três decisões que valem registrar porque contrariam o enunciado original das
tarefas:

1. **`Partitioned` é opt-in, não detectado por User-Agent.** A fase propunha
   ler a versão do Chrome/Firefox do `User-Agent` para decidir. UA é spoofável e
   é justamente o que um cliente não precisa fingir; um operador decidindo por
   config erra no máximo uma release, um cliente decidindo por UA erra em
   silêncio.

2. **O segredo do step-up é sorteado por processo, não derivado de
   `nostr.daemonKeypair`.** Essa chave não existe na config. Sorteio por
   processo é mais simples, igualmente sem estado em disco, e dá a invalidação
   correta no restart.

3. **A SPA não usa `mode: "cors"` para redencionar.** A SPA é servida de outra
   origem que o túnel efêmero e o daemon não emite headers CORS; um POST
   cross-origin legível seria um `preflight` que falha. O pedido é
   deliberadamente simples (form, sem headers customizados, `no-cors`) e o que
   importa é o efeito colateral: o `Set-Cookie` da resposta cria a sessão, e a
   navegação seguinte já a carrega. A URL aberta **não leva credencial
   alguma** — o token nunca aparece em histórico, log de acesso ou `Referer`.

A anonimização de IP altera o formato do log (`10.0.66.*`), então foi
documentada em [security.md](concepts/security.md#hardening-de-borda) e no
runbook antes de qualquer operador procurar por um endereço completo que não
mais aparece.

## 2026-10-03 — Uma única lista de serviços (remove a grade duplicada)

A fase `u19` (usabilidade) havia introduzido a lista compacta de serviços
dentro da Visão geral sem remover a grade de cartões que já existia: duas
seções intituladas "Serviços" na mesma coluna, alimentadas pelo mesmo
`state.services`, com Qual delas certo não era óbvio para quem usava a tela.

A **lista foi mantida** e a grade removida. Como a grade era a única dona de
várias funções, elas migraram para `#services-overview` em vez de sumirem:
os controles Adicionar/Atualizar/Limpar, a barra de saúde proporcional, o
formulário de serviço personalizado (com exportação YAML/Nix) e — por linha —
a descrição, os selos e o botão de excluir.

Registrado em
[web-frontend-layout.md](concepts/web-frontend-layout.md#uma-única-lista-de-serviços).
Três decisões que mudaram o resultado:

1. **A visibilidade do bloco passou a seguir a fase Live, não a contagem de
   serviços.** `renderServicesOverview()` escondia o contêiner quando a lista
   esvaziava — com a grade removida isso engoliria justamente o botão
   "Adicionar serviço", o único caminho para sair de zero serviços. A lista
   vazia virou uma linha de estado.
2. **`statusDot()` virou `serviceStatusMeta()`.** A lista já tinha sua própria
   cópia da tabela verde/vermelho/cinza para o texto de status; com a grade
   fora, a função antiga ficou órfã. Extrair o par `{status, cls, title}`
   remove a duplicação em vez de deixar duas tabelas de saúde divergirem.
3. **O CSS da grade foi apagado, não esquecido.** `.services-grid`,
   `.service-card*`, `.service-top`, `.service-link`, `.service-name`,
   `.service-desc`, `.service-custom-meta` e `.service-unprobed` saíram de
   `style.css` junto com o markup. Regra morta é dívida de tema: a próxima
   troca de paleta descobriria que metade das regras não tinha elemento.

Os testes de layout e de UI de serviços personalizados foram atualizados: os
dois afirmavam a existência da marcação da grade, então passaram a afirmar o
contrário — que a duplicação não volta.
