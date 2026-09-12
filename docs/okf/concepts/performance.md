---
type: architecture-decision
---

# Orçamento e checagens de performance

## Decisão

Local-first: o SPA só lê/escreve contra o daemon (resposta imediata); a
sinalização Nostr roda em segundo plano. Cripto (NIP-44) e verificação de
assinatura são feitas no daemon. Mutações/coletas são agrupadas e debounced
antes de virarem payload. Relays múltiplos limitam a exposição de metadados.

| Métrica | Alvo |
|---------|------|
| Abertura a serviço (descoberta Nostr → túnel pronto) | < 5 s na maioria dos casos |
| Latência de proxy (req → upstream local) | < 16 ms (1 frame) para respostas locais |
| Aplicar telemetria recebida no SPA | sem jank (render fora do caminho crítico) |
| Binário Go (`dl_conn`) | orçamento no CI (`CLI_BUDGET_MB`) |
| Bundle web (first load, gzip) | orçamento no CI (`WEB_BUDGET_KB`) |

## Onde isso vive no código

Os checks de performance devem cobrir:

- `go build` e tamanho do binário resultante (`CLI_BUDGET_MB`) — o `buildGoModule`
  em `dl-conn.nix` produz o binário; meça o tamanho do resultado.
- `golangci-lint run` + `go vet ./...` (qualidade/lint que afeta manutenção).
- `go test ./...` (corretude; testes de performance/benchmarks quando houver).
- Tamanho do `web/` servido (HTML + CSS + JS + `vendor/`): `WEB_BUDGET_KB`.
  O SPA não tem bundler — o conteúdo de `web/` é servido direto, então o
  orçamento é sobre o tamanho dos arquivos estáticos servidos.
- `scripts/check-okf.sh` (conformidade deste bundle).

Orçamentos configuráveis via env para não travar o desenvolvimento local.

Relacionado: [architecture.md](architecture.md), [testing.md](testing.md).
