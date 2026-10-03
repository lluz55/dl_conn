---
type: security
---

# Segurança: chaves, cifra e modelo de confiança

## Gestão de chaves (a decisão mais crítica)

A chave privada Nostr **é** a identidade **e** a chave de cifra. Vazou =
comprometeu tudo.

| Plataforma | Estratégia |
|------------|------------|
| Web (SPA `web/`) | A chave **nunca** é gravada em `localStorage`/`sessionStorage` em texto claro: vive em memória e o único formato em repouso é o cofre **AES-256-GCM** de `web/js/crypto_vault.js`. Opções de login: NIP-07 (extensão do navegador) ou NIP-46 (assinador remoto/bunker). |
| Daemon Go (`dl_conn`) | A nsec é injetada em runtime via `--nsec` / `--nsec-file` / `nostr.nsec` / `nostr.nsecFile` (SOPS) — **nunca** hardcoded nem versionada. |

A chave do daemon deriva de segredo injetado (SOPS/`nsecFile`), nunca em texto
plano no disco. NIP-46 é recomendado também em desktop/servidor.

## Cifra e integridade

- Todo payload de sinalização: NIP-44 v2 (ChaCha20 + Poly1305), auto-cifra.
- Assinatura Schnorr (secp256k1) verificada em todo evento recebido.
- O cofre do SPA e o canal NIP-44 protegem a chave/segredo em trânsito e em
  repouso no cliente; o daemon não persiste a nsec.

## Modelo de confiança

Relays não são confiáveis: não veem conteúdo (cifrado), não podem forjar
eventos (assinatura), no máximo omitem/atrasam. Mitigar com múltiplos
relays; preferir relays autenticados (NIP-42) para reduzir exposição de
metadados.

A cobertura de NIP-42 é **simétrica cliente↔daemon** desde S17: o cliente
responde via `relay._onauth` (commit `ae7e3e2`), o daemon responde via
`nostr.WithAuthHandler(c.signAuthEvent)` no `SimplePool`. Sem o lado do
daemon, relays que endureceram para `auth-required:` (ex.: `damus.io`,
`nostr.land`) fecham o subscribe na hora e o daemon fica surdo aos pedidos
de descoberta — sintoma idêntico ao "relay sumiu" do log de 2026-09-10,
mas com causa diferente (NIP-42, não SocketIdle).

## Allowlist de npubs do daemon (`dl_conn`)

Quem pode falar com o host é decidido por `nostr.authorizedNpubs`
(`config.yaml`). `NewClient` decodifica cada npub para hex e monta
`Client.authorized`, sempre incluindo a própria pubkey do host
(`internal/nostr/client.go`). DM de remetente fora da lista é **descartado em
silêncio** por `ParseEvent` — sem resposta e sem erro vazado, para não
confirmar a existência do host a quem sonda. O lado do cliente só percebe isso
como timeout (a SPA avisa após 30 s, ver [[10-nsec-session-start]]).

Regras que decorrem disso:

- A lista é **allowlist, nunca denylist**: um npub desconhecido não tem
  caminho de fallback.
- Assinatura Schnorr é verificada antes da checagem de autorização — o campo
  `PubKey` do evento sozinho não prova nada.
- Eventos com mais de 5 min (`maxEventAge`) são rejeitados: sem isso um relay
  poderia **repetir** um DM antigo de um remetente legítimo.
- Alterar a lista com o daemon rodando é a [[11-runtime-npub-authorization]] —
  a leitura de `Client.authorized` acontece na goroutine do `Serve`, então
  qualquer recarga precisa de lock, e a pubkey do host tem de sobreviver a ela.

## Onde isso vive no código

- Web: `web/js/crypto_vault.js` (cofre AES-256-GCM, em memória),
  `web/js/nostr_auth.js` / `web/js/nostr_client.js` (login NIP-07/46),
  `web/index.html` (CSP `script-src 'self'`; bibliotecas vendored em
  `web/vendor/`).
- Daemon Go: `internal/nostr/client.go` (allowlist, verificação de assinatura,
  janela anti-replay) e `internal/config/config.go` (`authorizedNpubs`,
  `GetNsec`).

## Proxy dinâmico de portas locais

A rota `/local/<porta>/` reutiliza a sessão Zero-Trust vinculada ao IP, mas
nunca aceita um host fornecido pelo cliente: o destino é construído pelo daemon
como `http://127.0.0.1:<porta>`. Portas privilegiadas (`<1024`), a porta HTTP
do próprio daemon, sua porta adjacente de diagnóstico e a denylist adicional
`dynamicPorts.deniedPorts` são bloqueadas. Upgrade de WebSocket não é suportado.
Antes de encaminhar, o proxy remove o cookie de sessão do `dl_conn`, o cookie
de contexto de serviço e credenciais `dsh-auth-*`/`dl_conn_launch_*`, evitando
entregá-los ao processo arbitrário escolhido pela porta. O recurso é habilitado
por padrão para usuários já autorizados; operadores devem acrescentar à
denylist qualquer porta sensível específica do host.

## Bootstrap de sessão de serviços internos

Serviços com uma segunda autenticação de lançamento, como `dsh web`, podem
configurar `launchTokenFile`. O arquivo contém a URL local impressa pelo
processo. Somente depois de validar a sessão Zero-Trust do `dl_conn`, o proxy
confere que a URL pertence exatamente ao `target`, resgata o token via loopback
e devolve apenas o cookie assinado com `Path=/`, necessário para APIs absolutas
como `/api/directoryPicker/list`, e reforçado com `Secure`, `HttpOnly` e
`SameSite=Lax`. O proxy remove cookies `dsh-auth-*` antes de encaminhar a outros
serviços; somente o serviço configurado recebe o cookie de sua autoridade.
Um marcador `HttpOnly` restrito ao prefixo identifica que o cookie raiz já foi
emitido pelo proxy; assim, cookies legados restritos a `/dsh/` não impedem a
migração automática no próximo acesso. Isso reduz exposição entre backends,
mas não isola aplicações que compartilham
a mesma origem no navegador. `Lax` permite a navegação GET
iniciada no frontend de outro domínio; `Strict` suprime o cookie nessa cadeia
de redirecionamentos e causa bootstrap repetido. O token não atravessa o túnel,
não entra no histórico do navegador e nunca é registrado pelo `dl_conn`.
Falhas de leitura, validação, resgate ou cookie fecham o acesso (`502`/`503`).

## Hardening de borda

Oito controles na fronteira do daemon, todos configuráveis e todos com teste.
Nenhum deles altera o protocolo Nostr.

1. **`Authorization` nunca chega ao backend por padrão**
   (`internal/proxy/router.go`). `Authorization: Bearer <sessionID>` é uma
   credencial que o próprio `dl_conn` emitiu — `GetSessionID` a aceita como
   alternativa ao cookie de sessão. Encaminhá-la entrega a uma sessão viva, de
   escopo túnel inteiro, ao processo que estiver atrás do prefixo, que pode
   reusá-la contra as próprias rotas protegidas. Um backend que de fato deve
   receber a credencial do chamador declara `forwardAuthorization: true`
   (`internal/config/config.go`); `/local/<porta>/` não tem como declarar nada
   e sempre remove o header, porque ali o backend é escolhido por porta e não
   por uma decisão de confiança do operador.

2. **`Strict-Transport-Security`** (`max-age=63072000; includeSubDomains`) em
   `cmd/dl_conn/main.go`, enviado **apenas** quando a requisição chegou por
   HTTPS (`r.TLS != nil` ou `X-Forwarded-Proto: https`). Em acesso LAN em
   HTTP o header é ignorado pelo browser, e enviá-lo assim faria o browser
   recusar a origem em texto claro depois — exatamente o downgrade que o header
   existe para impedir, causado pelo próprio daemon.

3. **`Permissions-Policy`** com tudo negado por padrão, exceto
   `camera=(self)`: é o que o `qr_scanner.js` precisa para `getUserMedia` quando
   o usuário opta por ler o nsec de um QR code.

4. **Cookie `Partitioned` (CHIPS)** opcional
   (`auth.partitionedCookies`, padrão `false`). Todos os túneis efêmeros vivem
   sob o mesmo domínio registrável (`trycloudflare.com`), então um cookie de
   sessão sem particionamento emitido por um túnel é oferecido a todos os
   outros que o usuário abrir. Ligado, o atributo vale para o cookie de
   sessão, o cookie de serviço e o cookie de bootstrap do `dsh` — a mesma
   decisão de confiança, aplicada em conjunto.

5. **Rate limit em `/auth`** por endereço de cliente
   (`Cf-Connecting-Ip`, com `RemoteAddr` como fallback — nunca
   `X-Forwarded-For`, que qualquer um que alcance o daemon em LAN poderia
   forjar). Padrão: 10 req/s, burst de 20 (`auth.rateLimitPerSec`,
   `auth.rateLimitBurst`). Resgate de token consome um token **e** cria uma
   sessão; sem teto, o endpoint é um oráculo de adivinhação que qualquer um
   alcançando o túnel pode martelar. `429` com `Retry-After: 1`; buckets
   inativos são reciclados a cada 5 min (`internal/auth/ratelimit.go`).

6. **Telemetria com cache de 1 s e rate limit por sessão**
   (`internal/telemetry/handler.go`). Vários dashboards consultando no mesmo
   segundo recebiam a mesma codificação JSON refeita cada vez; a segunda
   chamada dentro da janela devolve os mesmos bytes. O limite é por sessão
   (1 req/s, burst de 5) — o custo é atribuível a uma sessão, e um cliente
   pode legitimamente ter mais de uma sem que uma consuma o orçamento da outra.

7. **`Sec-Fetch-Dest: iframe` deixou de ser navegação**
   (`internal/auth/login_redirect.go`). Um contexto aninhado não é lugar para
   uma página de login: quem emoldurou a requisição receberia um quadro com o
   HTML de login de outra pessoa, e o usuário nunca veria uma página acionável.
   A resposta é o `403` que toda não-navegação já recebia. O CSP da SPA já
   traz `frame-ancestors 'none'`; o que faltava era a metade que alcança os
   *outros* serviços da mesma origem.

8. **Anonimização de IP nos logs** (`internal/auth/logip.go`, padrão ligado).
   IPv4 truncado no prefixo de rede (`10.0.66.*`) e IPv6 nos primeiros 48 bits
   (`2001:db8:1234:*`) — o suficiente para correlacionar as requisições de um
   cliente, insuficiente para localizá-lo, e isso importa porque `journalctl`
   costuma ser exportado para Loki/Datadog/Sentry. `auth.logIPs: false` grava
   `[redacted]`. Vale para auth, proxy, portas dinâmicas e telemetria, pela
   mesma função.

## Superfície do token de autenticação

Um token de uso único em uma URL é um token no histórico do navegador, no log
de acesso do `cloudflared` e do serviço de destino, e no `Referer` de tudo que a
página de chegada carregar. A migração é `GET → POST`:

- **`POST /auth`** aceita `application/x-www-form-urlencoded` ou JSON
  (`{"token": "...", "redirect": "..."}`). A bifurcação importa porque a
  redenção agora é uma navegação top-level (form submission), não um
  `fetch()`:
  - **Form-POST** (a SPA monta `<form method="POST">` e chama
    `form.submit()`, `Sec-Fetch-Mode: navigate` + `Dest: document`) →
    `303 See Other` para o destino. O `Set-Cookie` da resposta cai em
    contexto first-party — o que importa é a navegação em si: o
    Chrome moderno descarta o `Set-Cookie` cross-origin de um `fetch()`,
    e sem isso a sessão não é estabelecida e o clique no card volta
    para o login. O token continua no corpo, nunca na URL.
  - **fetch-POST** (`Sec-Fetch-Mode` ≠ `navigate`) → `200` com
    `{"redirect": "..."}`, para que `fetch()` saiba para onde ir sem
    seguir um `302` que lhe entregaria o shell da SPA.

  A SPA redenciona via `web/js/api_client.js` e o navegador termina em
  uma URL **sem credencial alguma**: o cookie emitido pelo resgate é
  o que autoriza, e o link pode ser favoritado, compartilhado ou
  aberto em nova aba sem carregar segredo.
- **`X-Dl-Conn-Token`** (qualquer método) atende clientes sem cookie jar —
  apps nativos, scripts. É credencial de portador, então só tem sentido sobre o
  TLS do túnel, e nunca é encaminhada para um serviço.
- **`GET /auth?token=…`** continua funcionando durante a janela de depreciação
  e responde `Sunset: Wed, 01 Jul 2026 00:00:00 GMT` e
  `Warning: 299 - "Use POST /auth or the X-Dl-Conn-Token header…"`. Quem não
  ler `Sunset` ainda assim fica sabendo.

Falha de redenção por POST não é beco sem saída: a SPA abre o destino mesmo
assim, e sem sessão o daemon leva o browser à página de login — exatamente onde
um clique não autenticado já levava.

## Step-up auth

Uma sessão roubada concede acesso de escopo túnel inteiro durante toda a janela
(`auth.sessionTTL`, 4 h por padrão). Para rotas que o operador considerar
sensíveis, `auth.stepUpProtected` acrescenta uma segunda prova, de vida curta:

- `POST /api/auth/stepup` emite a prova **para a sessão atual** (e apenas
  para ela; sem sessão, `401`; GET, `405` — emitir por GET deixaria um
  `<img>` de terceiros armar o privilégio com o cookie que o browser anexa).
- A prova é `HMAC-SHA256(sessionID ‖ segredo ‖ bucket de 5 min)`, comparada em
  tempo constante, e válida no bucket atual e no anterior — o grace period que
  evita um `401` por arredondamento de fronteira.
- O segredo é sorteado por processo e **nunca persistido**: um restart invalida
  as provas pendentes, que é o comportamento correto. (A fase 16 previa derivá-lo
  de `nostr.daemonKeypair`; essa opção não existe na config, e sorteio por
  processo é mais simples e igualmente sem estado em disco.)
- Cliente (`web/js/api_client.js`): a prova fica **só em memória**, some no
  lock/logout/troca de identidade, e é cunhada **sob demanda** — só após um
  `401`. Um operador que nunca ligou o step-up não paga uma requisição extra por
  poll, porque o `401` simplesmente nunca chega.

## Ciclo de vida da chave

A `nsec` decodificada é o único estado do processo que não deve sobreviver ao
seu uso. `cmd/dl_conn/main.go` copia o segredo decodificado para um buffer
próprio, entrega ao construtor do cliente e **zera esse buffer** na volta — no
caminho de erro inclusive, que é justamente o que uma chave mal configurada
toma. `nostr.DeriveKeyPair` instala um finalizador que descarta a referência à
chave privada quando o keypair se torna inalcançável.

**O que isso não é:** uma garantia. String em Go é imutável, então as cópias
que a config e a flag `--nsec` deixaram no heap permanecem até o GC, e zerar
memória exigiria `unsafe`. Contra quem tem `ptrace` nada disso vale — a chave é
legitimamente carregada em algum momento. O escopo honesto é "o daemon deixa de
segurar a chave depois do uso", não "a chave não pode ser lida de
`/proc/<pid>/mem`". O mesmo vale para o lado do browser: ver
[security.md do cofre](08-session-vault-auth.md) para o que é garantido lá.

## Onde isso vive no código

- `internal/auth/ratelimit.go`, `internal/auth/logip.go`,
  `internal/auth/stepup.go`, `internal/auth/handler.go`,
  `internal/auth/login_redirect.go`, `internal/auth/session.go`
- `internal/proxy/router.go` (remoção de `Authorization`), `internal/proxy/dynamic_ports.go`
- `internal/telemetry/handler.go` (cache + rate limit)
- `cmd/dl_conn/main.go` (headers, roteamento, zeragem da chave)
- `internal/nostr/crypto.go` (finalizador do keypair)
- `web/js/api_client.js` (redenção via POST, prova de step-up)

Relacionado: [sync.md](sync.md), [architecture.md](architecture.md),
[environment.md](environment.md) (reprodutibilidade de build como parte da
cadeia de suprimentos).
