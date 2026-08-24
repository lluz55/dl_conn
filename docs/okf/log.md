---
type: log
---

# Log de curadoria do conhecimento

Histórico de mudanças relevantes no bundle OKF (`docs/okf/`). Cada entrada:
data, o que mudou, por quê.

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
