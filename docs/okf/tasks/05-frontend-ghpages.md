---
type: task
phase: 5
status: done
title: "Fase 5 — Frontend Estático (GitHub Pages SPA)"
description: "Single-Page Application estática em HTML/JS/CSS com nostr-tools, login NIP-07/nsec, descoberta dinâmica de serviços e deploy automatizado no GitHub Pages."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 5 — Frontend Estático (GitHub Pages SPA)

## Objetivo
Desenvolver a interface do usuário estática e responsiva em `web/`, projetada para rodar no **GitHub Pages**, que permite ao usuário autenticar com sua identidade Nostr, solicitar acesso ao daemon no host NixOS e renderizar dinamicamente o catálogo de serviços disponíveis.

## Sub-tarefas

- [x] **Scaffold da SPA Estática (`web/`):**
  - Estrutura estática pura: `index.html`, `style.css` (Tailwind CSS via CDN ou CSS modular moderno) e `app.js`.
  - Zero dependências de servidor (totalmente *client-side*).
  - Design adaptativo (otimizado para smartphones, tablets e desktop com suporte a tema dark/light).
- [x] **Módulo de Identidade Nostr no Browser (`web/js/nostr_auth.js`):**
  - Detecção e login automático com extensões NIP-07 (`window.nostr` — Alby, nos2x, Amber no Android).
  - Input seguro alternativo para inserção manual de `nsec` / chave privada Nostr para navegadores sem extensão.
  - Armazenamento opcional da chave em `sessionStorage` (limpo ao fechar a aba).
- [x] **Cliente de Sinalização & NIP-44 (`web/js/nostr_client.js`):**
  - Uso da biblioteca [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) no navegador.
  - Conexão com os relays configurados via WebSockets do navegador.
  - Encriptação de evento de requisição (`action: discover_services`) para o `npub` do host usando NIP-44.
  - Escuta e decriptação da resposta contendo a URL do túnel, o token de autenticação e os serviços.
- [x] **Renderização Dinâmica do Catálogo de Serviços:**
  - Exibição de cards de serviços (Home Assistant, Frigate, Zigbee2MQTT, etc.) com ícones, descrições e status.
  - Indicadores visuais: status da conexão Nostr, tempo restante do túnel e latência dos relays.
- [x] **Navegação com Magic Link & Redirecionamento Seguro:**
  - Botões de acesso nos cards apontando para: `https://[tunnel_url]/auth?token=[auth_token]&redirect=[service_path]`.
  - Abertura suave no mesmo navegador ou em nova aba, permitindo que o cookie de sessão seja configurado como *First-Party*.
- [x] **Workflow de CI/CD para GitHub Pages (`.github/workflows/deploy-pages.yml`):**
  - GitHub Action automatizada que publica o diretório `web/` no branch `gh-pages` ou no ambiente do GitHub Pages a cada push na branch principal.

## Onde isso vive no código
- `web/index.html`
- `web/style.css`
- `web/app.js`
- `web/js/nostr_auth.js`
- `web/js/nostr_client.js`
- `web/vendor/nostr-tools.js` (ou importação via ES Modules/CDN)
- `.github/workflows/deploy-pages.yml`

## Critérios de Aceite (Definition of Done)
1. ✅ A SPA abre no navegador sem erros de console.
2. ✅ Login com NIP-07 ou `nsec` funciona e envia mensagem cifrada com NIP-44 para o relay.
3. ✅ Resposta do daemon popula os cards dos serviços automaticamente.
4. ✅ Clicar no serviço abre a URL do túnel autenticando a sessão.
5. ✅ GitHub Action publica a SPA no GitHub Pages com sucesso.

## Verificação empítrica (pós-correção)

O DoC #2 foi marcado ✅, mas a validação só foi exercida de ponta a ponta após correção de regressões no cliente NIP-44 (que não tinham cobertura em `web/tests/`). Verificado via Node com `nostr-tools@2.9.2`:

- `loginNsec("nsec1gccfk4suf25m...srfn7kv")` decodifica para 32 bytes (sem
  "nsec deve decodificar para 32 bytes") e devolve `npub`/`sk` hex de 64 chars.
- Round-trip NIP-44: cliente assina+cifra requisição (`finalizeEvent` +
  `getConversationKey(clientPriv, hostPub)` + `nip44.encrypt`) → host decifra
  com `getConversationKey(hostPriv, clientPub)` (mesmo CK — ECDH simétrico,
  interoperável com o Go `GenerateConversationKey`) → host responde
  assinado+cifrado → cliente decifra via `subscribeToResponses`/`_decryptEvent`.
- `node --check` verde em `app.js`, `js/nostr_auth.js`, `js/nostr_client.js`;
  `web/tests/*`: 71/71.

- **`web/tests/*` nunca importam `js/nostr_client.js`** (este último importa
  `https://esm.sh/nostr-tools@2.9.2`, URL que o Node não resolve sem loader) —
  daí o cliente NIP-44 ficou sem cobertura de teste. A validação agora passa a
  usar o **`SimplePool` real da v2.9.2`** (esm.sh remapeado para o pacote local
  via loader + `global.WebSocket` stubado com um *relay* em-processo que fala o
  protocolo real: `new SimplePool`, `ensureRelay({connectionTimeout})`,
  `subscribeMany({onevent})` com entrega pós-EOSE, `publish`→array de Promises
  → `Promise.allSettled`, `destroy()`), exercitando o **arquivo real**
  `js/nostr_client.js` num round-trip bidirecional cliente↔host — 8/8. Teria
  falhado antes da correção: `SimplePool()` sem `new` → "Class constructor Ps
  cannot be invoked without 'new'"; e `subscribe`/`publish.subscribe`/`close(string)`
  não existem na v2.9.2.
