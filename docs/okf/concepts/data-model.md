---
type: data-model
---

# Modelo de dados e persistência local

## Decisão

O daemon é **essencialmente sem estado**: a configuração vem de `config.yaml`
(mais nsec injetada via `--nsec`/`--nsec-file` ou SOPS) e o túnel/sessões são
efêmeros. A **única** persistência local é a **telemetria do host**, em SQLite
via `modernc.org/sqlite` (`internal/store`).

- Sem SQLCipher: a telemetria é dado operacional local, não segredo — o disco
  em repouso não precisa de cifra.
- Sem CRDT / sem sincronização: não há conflito entre dispositivos; cada daemon
  escreve a própria telemetria. Snapshots são append-only com timestamp.
- **Retenção:** amostras antigas são podadas periodicamente (uma vez por hora)
  segundo `telemetry.retentionDays`.

## Esquema (telemetria)

Tabela de amostras (`internal/store/telemetry.go`), uma linha por coleta:

| Coluna | Tipo | Origem |
|--------|------|--------|
| `sampled_at` | TEXT (RFC3339) | momento da coleta |
| `cpu_temp_c` / `cpu_load1/5/15` / `cpu_freq_mhz` | REAL | `/sys`/`/proc` |
| `ram_used_pct` / `ram_used_mb` / `ram_total_mb` | REAL/INT | `/proc/meminfo` |
| `disk_*` | REAL/INT | `/proc/mounts` + statfs |
| `gpu_temp_c` / `gpu_util_pct` | REAL | `nvidia-smi` (fail-soft) |
| `batt_capacity_pct` / `batt_status` | INT/TEXT | `/sys/class/power_supply` |
| `uptime_s` | INT | `/proc/uptime` |

As unidades são estáveis (MiB, °C, %) para facilitar teste e para o SPA
converter para a unidade legível no cliente (ver
[host-telemetry.md](host-telemetry.md)).

## Quando trocar de estratégia

Se no futuro o daemon precisar de estado compartilhado entre réplicas ou de
histórico longo, migrar a telemetria para o mesmo SQLite com índices por
`sampled_at` + particionamento por retention — manter simples: single writer,
append, prune. Não introduzir CRDT nem cifra em repouso sem um caso de uso
explícito (ver [security.md](security.md) para o que **é** secreto: a nsec).

## Onde isso vive no código

`internal/store` (SQLite via `modernc.org/sqlite`, `Prune` periódico),
`internal/sensors` (coletor) e `internal/telemetry` (handler
`GET /api/host/telemetry`). Consumido no SPA por `web/app.js`
(`startTelemetryPolling`).

Relacionado: [host-telemetry.md](host-telemetry.md),
[security.md](security.md) (o que é secreto vs. operacional).
