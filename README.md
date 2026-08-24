# dl_conn

Daemon Go que expõe serviços locais (Home Assistant, Frigate, Zigbee2MQTT) através de um túnel efêmero da Cloudflare, com sinalização via Nostr (NIP-44) e controle de acesso Zero-Trust.

## Arquitetura

```
[Cliente Web] → [Cloudflare Tunnel] → [dl_conn:9099]
     ↑                                ↓
   Nostr DM (NIP-44)          [Reverse Proxy] → [HASS:8123]
     ↓                            [Frigate:5000]
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
- `services` — lista de serviços expostos (prefixo, target, WebSocket)

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
- Relays não são confiáveis por definição; assinaturas são verificadas.

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


