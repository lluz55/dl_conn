---
type: architecture-decision
---

# Arquitetura em camadas

## Decisão

O sistema é um **daemon Go** (`dl_conn`) que expõe serviços locais para a
internet através de um túnel efêmero da Cloudflare, com **Nostr (NIP-44)** como
canal de sinalização e um **proxy reverso com controle de acesso Zero-Trust**.
O cliente é um **SPA web em JavaScript puro** (`web/`), sem framework. Camadas,
de fora para dentro:

1. **SPA web (`web/`):** roda no navegador do cliente. Fala com o daemon **só**
   via HTTP (endpoints `/auth`, `/api/host/telemetry`, arquivos estáticos) e com
   a Nostr **só** para sinalização (DM cifrada pedindo descoberta). Nunca toca
   os serviços locais diretamente — o proxy do daemon é o único caminho.
2. **Proxy reverso + acesso Zero-Trust (`internal/proxy`, `internal/auth`):**
   recebe as requisições tuneladas, valida a sessão/token e encaminha para o
   serviço local alvo (Home Assistant, Frigate, Zigbee2MQTT). Serviços fixos
   suportam upgrade de WebSocket e cookies de launch. A rota dinâmica
   `/local/<porta>/` encaminha HTTP exclusivamente para `127.0.0.1`, sem
   WebSocket, e aplica uma política de portas bloqueadas.
3. **Sinalização Nostr (`internal/nostr`):** cliente Nostr (go-nostr) que
   assina/envia DMs NIP-44 (pedido de descoberta) e processa a resposta do
   daemon (URL do túnel, token de auth, lista de serviços). Relays são
   não confiáveis.
4. **Túnel (`internal/tunnel`):** gerencia o `cloudflared`, obtém a URL
   efêmera `trycloudflare.com`, aguarda prontidão e rotaciona a URL se o
   processo reiniciar.
5. **Config (`internal/config`) + estado (`internal/store`, `internal/sensors`,
   `internal/telemetry`, `internal/health`):** configuração YAML (inclui
   resolução da nsec), persistência SQLite de telemetria, coleta de métricas do
   host e sondas de saúde dos serviços.

## Por quê

- **Resposta imediata e offline do ponto de vista do serviço:** o daemon é o
  dono do túnel e da sessão; o SPA só consome o que o daemon já tem pronto.
- **Testabilidade:** `internal/proxy`, `internal/auth`, `internal/nostr` e
  `internal/tunnel` são testáveis isoladamente (`*_test.go`), sem rede real
  (ver [testing.md](testing.md)).
- **Troca de transporte isolada:** a sinalização Nostr fica em `internal/nostr`;
  trocar o mecanismo de descoberta não mexe no proxy nem no SPA.

## Onde isso vive no código

`cmd/dl_conn` (bootstrap do servidor) e `internal/{proxy,auth,nostr,tunnel,
config,store,sensors,telemetry,health}`. O SPA está em `web/`
(`index.html`, `style.css`, `app.js`, módulos em `web/js/`). O handshake de
descoberta é exercitado de ponta a ponta em
[tasks/03-nostr-signaling.md](../tasks/03-nostr-signaling.md) e
[tasks/04-auth-proxy.md](../tasks/04-auth-proxy.md).

Relacionado: [environment.md](environment.md), [sync.md](sync.md),
[protocol.md](protocol.md), [security.md](security.md).
