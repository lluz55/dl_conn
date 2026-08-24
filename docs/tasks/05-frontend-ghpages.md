---
type: task
phase: 5
status: pending
title: "Fase 5 — Frontend Estático (GitHub Pages SPA)"
description: "Single-Page Application estática em HTML/JS/CSS com nostr-tools, login NIP-07/nsec, descoberta dinâmica de serviços e deploy automatizado no GitHub Pages."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 5 — Frontend Estático (GitHub Pages SPA)

## Objetivo
Desenvolver a interface do usuário estática e responsiva em `web/`, projetada para rodar no **GitHub Pages**, que permite ao usuário autenticar com sua identidade Nostr, solicitar acesso ao daemon no host NixOS e renderizar dinamicamente o catálogo de serviços disponíveis.

## Sub-tarefas

- [ ] **Scaffold da SPA Estática (`web/`):**
  - Estrutura estática pura: `index.html`, `style.css` (Tailwind CSS via CDN ou CSS modular moderno) e `app.js`.
  - Zero dependências de servidor (totalmente *client-side*).
  - Design adaptativo (otimizado para smartphones, tablets e desktop com suporte a tema dark/light).
- [ ] **Módulo de Identidade Nostr no Browser (`web/js/nostr_auth.js`):**
  - Detecção e login automático com extensões NIP-07 (`window.nostr` — Alby, nos2x, Amber no Android).
  - Input seguro alternativo para inserção manual de `nsec` / chave privada Nostr para navegadores sem extensão.
  - Armazenamento opcional da chave em `sessionStorage` (limpo ao fechar a aba).
- [ ] **Cliente de Sinalização & NIP-44 (`web/js/nostr_client.js`):**
  - Uso da biblioteca [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) no navegador.
  - Conexão com os relays configurados via WebSockets do navegador.
  - Encriptação de evento de requisição (`action: discover_services`) para o `npub` do host usando NIP-44.
  - Escuta e decriptação da resposta contendo a URL do túnel, o token de autenticação e os serviços.
- [ ] **Renderização Dinâmica do Catálogo de Serviços:**
  - Exibição de cards de serviços (Home Assistant, Frigate, Zigbee2MQTT, etc.) com ícones, descrições e status.
  - Indicadores visuais: status da conexão Nostr, tempo restante do túnel e latência dos relays.
- [ ] **Navegação com Magic Link & Redirecionamento Seguro:**
  - Botões de acesso nos cards apontando para: `https://[tunnel_url]/auth?token=[auth_token]&redirect=[service_path]`.
  - Abertura suave no mesmo navegador ou em nova aba, permitindo que o cookie de sessão seja configurado como *First-Party*.
- [ ] **Workflow de CI/CD para GitHub Pages (`.github/workflows/deploy-pages.yml`):**
  - GitHub Action automatizada que publica o diretório `web/` no branch `gh-pages` ou no ambiente do GitHub Pages a cada push na branch principal.

## Onde isso vive no código
- `web/index.html`
- `web/style.css`
- `web/app.js`
- `web/vendor/nostr-tools.js` (ou importação via ES Modules/CDN)
- `.github/workflows/deploy-pages.yml`

## Critérios de Aceite (Definition of Done)
1. A SPA abre no navegador sem erros de console.
2. Login com NIP-07 ou `nsec` funciona e envia mensagem cifrada com NIP-44 para o relay.
3. Resposta do daemon popula os cards dos serviços automaticamente.
4. Clicar no serviço abre a URL do túnel autenticando a sessão.
5. GitHub Action publica a SPA no GitHub Pages com sucesso.
