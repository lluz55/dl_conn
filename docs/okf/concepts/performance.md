---
type: architecture-decision
---

# Orçamento e checagens de performance

## Decisão

Local-first: UI só lê/escreve no store local (resposta imediata); sync em
background. Cripto e verificação de assinatura rodam fora da UI thread
(isolates). Mutações são agrupadas/debounced antes de virar changeset.
Snapshots periódicos limitam o replay de deltas no bootstrap.

| Métrica | Alvo |
|---------|------|
| Abertura a cargo (dados locais) | < 1s |
| Latência de mutação (UI → store) | < 16ms (1 frame) |
| Aplicar changeset recebido | sem jank (off-thread) |
| Bundle web (first load, gzip) | orçamento no CI (`WEB_BUDGET_KB`) |

## Onde isso vive no código

`scripts/perf-check.sh` orquestra: `check-flutter.sh` (lints de
performance), `check-antipatterns.sh` (I/O/JSON/cripto síncronos na UI
thread), `check-web-bundle.sh`, `check-apk-size.sh`, `check-go.sh`
(benchmarks + tamanho do binário), `check-okf.sh` (conformidade deste
bundle). Orçamentos configuráveis via env (`WEB_BUDGET_KB`, `APK_BUDGET_MB`,
`CLI_BUDGET_MB`) para não travar o desenvolvimento local.

Relacionado: [architecture.md](architecture.md).
