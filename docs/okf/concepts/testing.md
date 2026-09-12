---
type: testing
---

# Convenção de testes

## Decisão

Testes ficam ao lado do que testam, por camada — sem um diretório `integration/`
separado (quando houver testes de integração de fluxo, vivem junto do pacote).

| Camada | Onde | Convenção |
|--------|------|-----------|
| Daemon — pacotes `internal/*` | `internal/<pkg>/*_test.go` | `TestXxx` padrão Go; roda via `go test ./internal/...` |
| Daemon — entrypoint/CLI | `cmd/dl_conn/*_test.go` | `TestXxx`; cobre sinalização, allowlist, anti-replay, keygen |
| Web SPA | `web/tests/*.js` | scripts standalone rodados com `node` (ES modules); importam os módulos de `web/js/` diretamente |
| Paridade de protocolo | `internal/nostr` | `RequestMessage`/`ResponsePayload` testados contra os valores exatos em `protocol.go`; roda no CI via `go test` |

## Como rodar

```bash
# Go — todo o daemon
go test ./...

# Go — pacote específico
go test ./internal/nostr/... -run TestAllowlist

# Web — todos os testes JS
node web/tests/crypto_tests.js
node web/tests/session_tests.js
# ou em lote (shell):
for t in web/tests/*_tests.js; do node "$t"; done
```

## Armadilha: `cloudflared` e túnel em testes

O daemon depende do binário externo `cloudflared` para abrir o túnel. Em testes
de `internal/tunnel`, **não** chame o binário real: use um `TunnelManager`
fakenado/interface (ou ajuste o `CloudflaredPath` para um stub) para que o teste
não dependa de rede nem do binário. O mesmo vale para relays Nostr em
`internal/nostr`: injete um transporte fake (ou `go-nostr` relay em memória)
em vez de conectar a relays públicos.

## Onde isso vive no código

`scripts/` (se houver um gate de verificação agregando `go test`, `golangci-lint`
e os testes web) — ver [scaffolding.md](scaffolding.md). A lista de tarefas
ainda stub (`TODO(fase-N)`) é rastreada em [tasks.md](tasks.md).

Relacionado: [architecture.md](architecture.md), [performance.md](performance.md).
