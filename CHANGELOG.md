# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
as versões seguem [SemVer](https://semver.org/lang/pt-BR/).

A versão é fonte única em [`dl-conn.nix`](dl-conn.nix) (`version = "…"`); este
arquivo não é lido por nenhum código.

## [Não publicado]

### Adicionado

- Categoria de **temperatura** no gráfico de histórico do painel de saúde do
  host, com a unidade `°C`, o eixo em 0..100 °C e a linha de alerta em 80 °C.
  Lê o sensor da CPU (que todo host x86/ARM expõe) e usa a GPU apenas quando o
  host não tem sensor de CPU, dizendo na legenda qual das duas está sendo
  lida. Nenhuma mudança de backend: a temperatura já era capturada e
  persistida por amostra, o que faltava era poder mostrá-la. O seletor de
  métrica deixou de ser uma lista de chaves e virou uma tabela de
  descritores — chave, unidade, domínio do eixo, limiar — porque uma
  temperatura desenhada no domínio percentual é um número errado, e não só um
  rótulo errado.

### Corrigido

- O painel **Aparência** abria, desenhava os três eixos e não alterava nada:
  tema, paleta e densidade eram inalteráveis pela interface, sem nenhum erro no
  console. O handler montava o seletor concatenando a chave do `dataset` —
  `closest("[data-" + attr + "]")` com `attr = "themeChoice"`, o que produz
  `[data-themeChoice]`, enquanto o atributo no markup é `data-theme-choice`. O
  seletor não casa com nada, o clique era engolido por um early return e nem o
  `localStorage` era escrito. Os tokens e os blocos de paleta em `style.css`
  estavam corretos: o defeito era só o nome do atributo, o que explica o
  sintoma de "mostra o visual, sem efeito real". O seletor agora é derivado da
  mesma chave que o `dataset` lê, e `web/tests/appearance_tests.js` executa o
  painel de produção contra um DOM falso para provar que o clique persiste e
  re-aplica.

- O painel listava **um disco três vezes**. `ReadDisks` deduplicava por ponto
  de montagem, que é a chave errada: `/`, `/nix/store` e o overlay de
  containers são o mesmo volume ext4, com o mesmo id de filesystem e os mesmos
  números. A deduplicação passou a usar o id do filesystem, com queda para
  tamanho/espaço livre quando não há id. Bind mounts e subvolumes btrfs agora
  colapsam em uma linha, que é o correto — `statfs` num subvolume já reporta
  o número do filesystem inteiro.

- O histórico do painel avisava "indisponível" quando o motivo real era o
  **daemon em execução ser anterior à consulta de intervalo**: um build como o
  `0.2.0` ignora `?from=`/`?to=` e responde com um objeto onde o front espera
  um array, e nenhuma versão do front conserta isso. A resposta agora é
  nomeada como o que é — um fato de deployment — dizendo o que fazer, em vez
  de um erro genérico que mandava procurar bug no lugar errado.

- Os gráficos de CPU, memória, disco e GPU do painel de saúde do host não
  carregavam. `GET /api/host/telemetry?from=&to=` respondia com **todas** as
  amostras gravadas na janela, e a janela padrão do painel é 7 dias com coleta
  a cada 10 s — cerca de 60 mil amostras, **25,3 MB** por carregamento e 1,06 s
  de leitura, que travavam a aba por ~200 ms no `JSON.parse` e ainda
  bloqueavam o `INSERT` do coletor por 820 ms (o store tem uma única conexão).
  Agora a resposta é limitada: `Store.RangeBucketed` corta a janela em buckets
  e devolve a amostra mais nova de cada um, e `?points=N` (limitado a 720)
  deixa o cliente pedir exatamente o que desenha. A mesma janela responde com
  **0,10 MB** em 118 ms. No cliente, `fetchHistory` parou de repetir a
  requisição de janela inteira a cada tick do poll de 2 s quando uma carga
  falhava, passou a recarregar a série a cada 5 min (o gráfico não congela mais
  no carregamento da página) e deixou de apagar o desenho quando uma
  atualização falha. Os quatro estados vazios foram separados — carregando,
  erro do daemon, host sem a métrica e janela sem amostras —, então uma GPU
  ausente agora explica que a coleta usa `nvidia-smi` em vez de dizer "sem
  amostras".

- Páginas de serviço em branco ao clicar em "Abrir" depois de um login por nsec
  bem-sucedido. A aba nova abria em `about:blank` e o token nunca era resgatado:
  `redeemToken` pré-abria a janela com `noopener`, e o Chromium não registra uma
  janela aberta com `noopener` no mapa de nomes, então o `form.target` não
  resolvia, o popup blocker descartava a submissão e não havia sessão nem
  página. O pré-open não pede mais `noopener`/`noreferrer`; o isolamento é
  garantido cortando `opener` no proxy da janela. Se o popup for bloqueado, a
  redenção cai para a aba atual em vez de não ter efeito.

## [0.2.0] — 2026-10-03

Primeira release com tag. A `0.1.0` nunca foi publicada: era o valor inicial
do pacote Nix, escrito no commit `62806bb` junto com o flake, e 111 commits de
funcionalidade se acumularam sobre ele sem bump. O que segue é o intervalo
completo desde aquele commit.

### Adicionado

**Telemetria e diagnóstico**

- Coleta de telemetria do host (`internal/sensors`) exposta à SPA: CPU, memória,
  disco e carga, com card no dashboard, badge ao vivo e unidades de capacidade
  adaptativas.
- Snapshot de diagnóstico em `/debug`, restrito a loopback, com o histórico de
  rotação da URL do túnel e o resultado das requisições Nostr.
- `internal/health` sonda cada `target` por TCP a cada 30 s e carimba
  `status` (`up`/`down`/`unknown`) no momento da resposta Nostr — o ponto verde
  do card passou a significar observação, não o flag `websocket` do YAML.

**Acesso a serviços**

- Roteamento dinâmico de portas em `/local/<porta>/`, atrás da sessão
  Zero-Trust existente. O alvo resolve somente `127.0.0.1`, `Authorization` é
  removido antes do encaminhamento, WebSocket é rejeitado, portas `<1024`, a
  porta do daemon e a de diagnóstico são bloqueadas, e `dynamicPorts.deniedPorts`
  estende a lista.
- Túnel efêmero dedicado por serviço (`DirectTunnel`), com a URL só anunciada
  depois de alcançabilidade real.
- Proxy das rotas de raiz do Frigate (API e WebSocket) por serviços ocultos.
- `X-Ingress-Path` no encaminhamento, para backends que se autocorrijam por
  subpath, e `originHost` para backends que fazem *fencing* de API pelo `Host`.
- Rewrite de assets com caminho absoluto (`/assets/`, `/locales/`) no
  HTML/CSS/JS proxied, com fallback por `Referer`.
- Serviços personalizados pelo dashboard, com schema local versionado
  (`dl_conn_custom_services_v1`) e exportação de configuração validada.
- Launcher de porta local e visão geral de serviços no dashboard.

**Autenticação e acesso**

- Step-up authentication: rotas em `auth.stepUpProtected` exigem uma prova além
  da sessão. O segredo é sorteado por processo (sem estado em disco), vale 5
  minutos e morre com o restart.
- Resgate de token por `POST /auth` e por header `X-Dl-Conn-Token`; a forma antiga
  `GET /auth?token=…` segue respondendo com `Sunset` e `Warning: 299`.
- `GET /auth/logout` e revogação da sessão no servidor ao travar a tela.
- Sessões do proxy vinculadas ao IP do cliente, tolerando rotação de endereço de
  privacidade IPv6.
- Redirect de sessão expirada para o login, com faixa de retorno ao serviço de
  origem.
- NIP-42 `AUTH` respondido pelo próprio daemon nos desafios dos relays.

**CLI e operação**

- `dl_conn npubs add` autoriza npubs com o daemon em execução: valida e
  normaliza (bech32 ou hex), edita o YAML preservando comentários, escreve
  atomicamente e envia `SIGHUP` — a allowlist recarrega sem derrubar o túnel.
- `dl_conn keygen files` grava `npub` e `nsec` em arquivos separados, com
  `0644` e `0600`.
- `keygen` exibe o par completo em texto ao lado do QR code.
- Varredura de QR do `nsec` para auto-preenchimento no login.
- Serviço de exemplo de terminal web via Zellij em `config.example.yaml`.

**Configuração**

- `auth.partitionedCookies` (CHIPS), `auth.stepUpProtected`, `auth.logIPs`,
  `auth.rateLimitPerSec` / `auth.rateLimitBurst`, `dynamicPorts.deniedPorts`,
  e `forwardAuthorization: true` por serviço como única forma de um backend
  receber o `Authorization` do chamador.

**SPA**

- Redesign definitivo adotado como UI de produção: cards de KPI, sparklines e
  barra de saúde.
- Console de depuração e recuperação automática de relay morto.
- Auto-lock com opções de 1 e 3 minutos, além do padrão.
- Backend de sessão do upstream inicializado com segurança, e sessões de
  navegador do upstream reaproveitadas.
- Freshness de saúde do host a cada 2 s.

### Segurança

- Chave privada Nostr que estava commitada no repositório foi removida.
- `nostr-tools` e `jsQR` vendorizados em `web/vendor/`: a SPA não carrega código
  de terceiros em runtime, com CSP `script-src 'self'`.
- Chave privada do cliente e PIN biométrico fora de `localStorage` /
  `sessionStorage` em texto claro — a única forma em repouso é o cofre
  AES-256-GCM.
- Assinatura verificada em todo evento recebido (`CheckSignature`) e DM com mais
  de 5 min rejeitada, contra replay.
- Endurecimento de borda: remoção de `Authorization` por padrão, HSTS condicional,
  `Permissions-Policy`, cookie `Partitioned`, rate limit em `/auth`, cache e rate
  limit na telemetria, `iframe` fora das navegações, e IP anonimizado no log
  (IPv4 truncado ao prefixo de rede, IPv6 nos primeiros 48 bits;
  `auth.logIPs: false` grava `[redacted]`).
- Redirect off-origin rejeitado em `/auth`.
- Prefixos de rota reservados rejeitados no acesso dinâmico.
- CSP espelhando `font-src` e media type `woff2` registrado.
- Linhas de relay construídas via DOM em vez de `innerHTML`.

### Corrigido

- **Startup travado:** a limpeza de auth e telemetria rodava em linha no
  bootstrap; movida para goroutines.
- **SPA 404:** `web/` não era empacotado, então o dashboard não acompanhava o
  binário em `nixos-rebuild switch`. Agora o pacote traz `web/` em
  `$out/share/web`.
- Resumo de relays contava latência como desconexão: relay lento porém online
  saía da contagem e o usuário lia isso como "vários offline". Passou a contar
  só disponibilidade, com os lentos como sufixo separado (`SLOW_RELAY_MS`).
- Respostas de descoberta mais antigas que a já aplicada eram aceitas, sobrescrevendo
  a URL vigente.
- Resubscribe aos relays depois de conexão derrubada.
- Sessões de navegador do upstream e cookies de sessão escopados para acesso à
  API pela raiz.
- `nsec` / `nsecFile` não são mais exigidos dentro do YAML.
- Identidade do cliente armazenada como npub bech32, e cofres salvos antes da
  correção do bech32 migrados (inclusive `host_npub` truncado).
- Timeout de prontidão do túnel elevado para 5 min, com o motivo de cada falha
  registrado.
- Módulos ES do app invalidados em cache; links de serviço e sintaxe do app
  reparados; `config.example.yaml` deixou de ser ignorado pelo git.
- Lista de serviços e overview exibidos como lista vertical; valores longos de
  KPI clipados em uma linha; barra de tom ancorada na borda do card com
  `inset-inline-start`; foco automático no campo do PIN.

### Mudado

- A versão é fonte única em `dl-conn.nix`. `flake.nix` e `nixos/module.nix` não
  carregam número de versão, então não há outro lugar para sincronizar.
- `ResponsePayload` continua retrocompatível: os campos novos (`description`,
  `host_telemetry`) são `omitempty` e entram no fim. Nenhum campo foi removido
  ou renomeado, então nenhum bump maior é exigido por esta release.

### Conhecido

- `golangci-lint run` reporta 42 avisos pré-existentes (35 `errcheck`, 7
  `staticcheck`) em código que não mudou nesta release. Nenhum é erro de
  compilação e `go vet ./...` passa limpo; ver [0.2.0 — Notas](#notas-de-verificação).
- Fases de performance e usabilidade permanecem pendentes: P17 (binário Go e
  bundle web), P18 (hot path do proxy e polling), U19 (feedback de descoberta) e
  U20 (mobile flow e biometria PRF).

<a id="notas-de-verificação"></a>
### Notas de verificação

Executado em `nix develop` sobre `984fa9e`:

| Checagem | Resultado |
|----------|-----------|
| `go test ./...` | ok — 10 pacotes, `cmd/dl_conn` + 9 internos |
| `go vet ./...` | sem saída |
| `node web/tests/*.js` | 12 suítes, todas passando |
| `golangci-lint run` | 42 avisos pré-existentes (errcheck/staticcheck) |

[Não publicado]: https://github.com/lluz55/dl_conn/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lluz55/dl_conn/releases/tag/v0.2.0
