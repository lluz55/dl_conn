# dl_conn

Daemon Go que expõe serviços locais (Frigate, Zigbee2MQTT, Agent of Empires) através de um túnel efêmero da Cloudflare, com sinalização via Nostr (NIP-44) e controle de acesso Zero-Trust.

## Arquitetura

```
[Cliente Web] → [Cloudflare Tunnel] → [dl_conn:9099]
     ↑                                ↓
   Nostr DM (NIP-44)          [Reverse Proxy] → [Frigate:5000]
     ↓                            [Agent of Empires:25809]
[Daemon no host]              [Zigbee2MQTT:8080]
```

**Fluxo:** o daemon inicia um túnel `trycloudflare.com` (`cloudflared`), publica a URL do túnel via DM criptografada no Nostr para *pubkeys* autorizadas. O cliente web acessa os serviços por trás do proxy reverso com autenticação baseada em sessão.

## Requisitos

- **Nix** (com flakes) — ambiente de desenvolvimento e build
- `cloudflared` (incluso no flake)
- Nostr *nsec* configurada (ver [Operação de chave](#chaves-nostr))

## Desenvolvimento

```bash
nix develop          # shell com Go, cloudflared, golangci-lint
go build ./cmd/dl_conn
go test ./internal/...
```

## Execução

```bash
dl_conn --config config.yaml
```

O daemon escuta em `localhost` por padrão (porta configurável); o túnel da Cloudflare o expõe publicamente.

## Configuração

Copie `config.example.yaml` para `config.yaml` e ajuste:

- `nostr.nsec` / `nostr.nsecFile` — chave privada Nostr (**nunca versionar**)
- `nostr.relays` — relays de sinalização
- `nostr.authorizedNpubs` — *pubkeys* autorizadas a receber o túnel
- `tunnel.listenPort` — porta do proxy local
- `auth.tokenTTL` / `auth.sessionTTL` — expiração de tokens e sessões
- `auth.rateLimitPerSec` / `auth.rateLimitBurst` — teto de requisições a `/auth` por endereço de cliente (padrões 10/s e 20)
- `auth.logIPs` — `false` grava `[redacted]` em vez do endereço anonimizado (padrão: anonimizado)
- `auth.partitionedCookies` — adiciona o atributo CHIPS `Partitioned` aos cookies emitidos
- `auth.stepUpProtected` — rotas que exigem prova de step-up além da sessão (vazio = desabilitado)
- `services` — lista de serviços expostos (prefixo, target, WebSocket); `forwardAuthorization: true` em um serviço é a única forma de ele receber o `Authorization` do chamador
- `servicesDir` — diretório drop-in de serviços (`*.yaml`); monitorado para recarga a quente sem root e sem restart do daemon
- `dynamicPorts.deniedPorts` — portas adicionais bloqueadas no acesso dinâmico `/local/<porta>/`; o alvo é sempre `127.0.0.1`, e portas `<1024`, a porta do daemon e a de diagnóstico já são bloqueadas

## Instalação como serviço NixOS

```nix
services.dl-conn.enable = true;
services.dl-conn.settings = { ... };  # equivalente ao config.yaml
```

Veja `nixos/module.nix`.

## Segurança

- Todos os DMs Nostr usam NIP-44 (criptografia).
- Nenhum *payload* não criptografado é publicado.
- A *nsec* e o binário destino devem ser injetados via SOPS/`nsecFile`, nunca hardcoded.
- Relays não são confiáveis por definição: a assinatura de cada evento recebido é
  verificada (`CheckSignature`) e eventos fora da janela de 5 min são descartados
  para impedir replay.
- O proxy dinâmico `/local/<porta>/` exige a sessão Zero-Trust existente, aceita somente HTTP em `127.0.0.1`, rejeita WebSocket e bloqueia portas privilegiadas/sensíveis.
- O SPA não carrega código de terceiros em runtime — `nostr-tools` e `jsQR` são
  *vendorizados* em `web/vendor/` e a página aplica CSP `script-src 'self'`.
  Ao atualizar essas bibliotecas, baixe o *bundle* e atualize o arquivo local;
  não reintroduza `import` de CDN, pois a CSP o bloqueia.
- A chave privada do cliente nunca é gravada em `localStorage`/`sessionStorage`
  em texto claro: vive em memória, e o único formato em repouso é o cofre
  AES-256-GCM de `crypto_vault.js`.
- O header `Authorization` é removido antes do encaminhamento, exceto para
  serviços que declarem `forwardAuthorization: true`; `/local/<porta>/` sempre o
  remove. Addresses de cliente entram no log anonimizados (IPv4 truncado no
  prefixo de rede, IPv6 nos primeiros 48 bits) — veja
  [docs/okf/concepts/security.md](docs/okf/concepts/security.md#hardening-de-borda).

### Operação: superfície de autenticação HTTP

| Rota                     | Método   | Finalidade                                                                     |
|--------------------------|----------|--------------------------------------------------------------------------------|
| `/auth`                  | `POST`   | Resgata um token de uso único no corpo (form ou JSON); responde `200 {"redirect": …}`. **Forma preferida.** |
| `/auth`                  | `GET`    | Legado: `?token=…`. Ainda funciona, com `Sunset`/`Warning: 299` avisando a depreciação. |
| `/auth`                  | qualquer | `X-Dl-Conn-Token: <token>` — para clientes sem cookie jar. TLS-only; nunca é encaminhado a um serviço. |
| `/auth/logout`           | `POST`   | Revoga a sessão do lado do servidor.                                            |
| `/api/auth/stepup`       | `POST`   | Emite a prova de step-up (HMAC, 5 min) para a sessão atual. Só é exigida nas rotas listadas em `auth.stepUpProtected`; sem ela, uma rota protegida responde `401 {"error":"step-up required"}`. |

A chave `auth.stepUpProtected` é **opt-in e vazia por padrão** — enabling
`["/api/host/telemetry"]` faz a telemetria exigir `X-Dl-Conn-StepUp` além da
sessão; a SPA cunha a prova sozinha, sob demanda, após um `401`.

Consulte [docs/runbook.md](docs/runbook.md) para operação e rotação de chaves.

## Estrutura

| Diretório     | Descrição                                              |
|---------------|--------------------------------------------------------|
| `cmd/dl_conn` | Entrypoint do daemon                                   |
| `internal/`   | Módulos: `tunnel`, `nostr`, `auth`, `proxy`, `config`  |
| `web/`        | SPA cliente (HTML/CSS/JS)                              |
| `nixos/`      | Módulo NixOS                                           |
| `flake.nix`   | Build, devShell e publicação                           |
| `docs/`       | Runbook e documentação OKF                             |


