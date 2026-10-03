---
type: architecture-decision
title: Host Telemetry
---

# Host Telemetry

Collect host health (CPU temp/load/freq, RAM, disk, uptime, GPU, battery) on the Linux daemon via `/sys` and `/proc` (and `nvidia-smi` optionally). Persist locally in SQLite (without SQLCipher) with retention; expose to the SPA via authenticated `GET /api/host/telemetry` (same-origin, session cookie) and optionally via the Nostr discovery response (`host_telemetry` field, opt-in).

## Why
Users running dl_conn locally want to diagnose "why is my service slow" without SSH. Local-only by default; Nostr exposure is opt-in (`telemetry.exposeViaNostr=false` by default) because relays see kind/created_at/size.

## What
- CPU: temp from `/sys/class/thermal/thermal_zone*/temp` + hwmon fallback, load from `/proc/loadavg`, freq from `/proc/cpuinfo` / sysfs.
- RAM: `/proc/meminfo`.
- Disk: `/proc/mounts` + statfs for ext4/btrfs/xfs.
- Uptime: `/proc/uptime`.
- GPU: `nvidia-smi` (2s timeout, fail-soft).
- Battery: `/sys/class/power_supply/BAT*/capacity`.

## How
- `internal/sensors.Collector` with 10s ticker (configurable).
- `internal/store` SQLite via `modernc.org/sqlite`, single writer, `Prune` hourly.
- `internal/telemetry.Handler` at `GET /api/host/telemetry` (requires ValidSession).
- `internal/nostr.HostTelemetry` optional field in `ResponsePayload` when `telemetry.exposeViaNostr=true`.

## Frontend rendering (web/app.js)

- Capacity is formatted client-side by formatCapacity(mb): the daemon keeps
  emitting raw total_mb / used_mb (MiB), and the SPA converts to the most
  readable binary unit - MB, GB, TB, PB, base 1024 - so the protocol stays
  byte-stable and easy to test. Do not move unit conversion into the Go API
  or the Nostr host_telemetry field; keep the daemon emitting MiB.
- All snap.disks get their **own row** in the Armazenamento block, not one
  averaged number: averaging hides exactly the volume that is filling up.
- Continuous refresh: startTelemetryPolling() reveals the card immediately,
  polls /api/host/telemetry every 2s, and drives a 1s liveTicker that
  updates an "ao vivo / ha Xs" badge (ids tel-live / tel-updated). A failed
  fetch keeps the last snapshot on screen and flags the badge is-stale
  ("indisponivel") instead of leaving a frozen-looking value. The
  visibilitychange handler is registered exactly once to avoid leaking
  listeners or duplicate intervals.

## Consulta de intervalo (histórico)

`telemetry_samples` já era criada com `CREATE INDEX telemetry_samples_ts ON
telemetry_samples(ts)`, mas só existia `Latest()` — não havia como ler um
intervalo, e por isso as sparklines do frontend eram um ring buffer client-side
que **zerava a cada reload**. Agora:

- `internal/store`: `Store.Range(from, to time.Time) ([]sensors.Snapshot, error)`
  — varredura indexada, inclusiva nos dois limites, ordenada por `ts ASC`.
  Retorna slice **não-nil** e vazio quando não há linhas (JSON `[]`, não
  `null`); `from` posterior a `to` também é vazio, não erro.
- `internal/telemetry`: `WithStore(*store.Store)` (opt-in, espelha `WithStepUp`),
  mais `?from=`/`?to=` em **Unix seconds**. Sem os dois params o comportamento
  é byte-a-byte o de antes: um único snapshot. Com qualquer um deles, a
  resposta é um **array** ordenado por `ts`. Valor presente e não parseável →
  `400` com corpo JSON; não cai silenciosamente para "latest".
- `cmd/dl_conn/main.go` chama `WithStore(telStore)`. Sem essa linha o handler
  responde `501` a um pedido de intervalo — a telemetria é opt-in, então o
  store pode ser legitimamente `nil`.
- Bounds parciais: falta `from` → últimas 1h (`defaultHistoryWindow`); falta
  `to` → agora. É uma escolha, não uma dedução: o default de 1h mantém um
  pedido parcial limitado em vez de despejar a retenção inteira.
- O pedido de intervalo passa pelo **rate limiter existente** (1/s, burst 5,
  compartilhado com o poll de 2s). Mais seguro que uma superfície de banco
  nova e desprotegida, mas significa que a SPA deve pedir poucas janelas por
  carga de página.

**Decisão de carga:** `Snapshot.NumCPU` (`num_cpu`, `runtime.NumCPU()`) é
emitido porque *load average* só se interpreta relativo ao número de núcleos —
0.42 é ocioso num host de 4 e carregado num de 64. Sem ele o frontend não tem
como mostrar **percentual** de CPU, que é a única forma de o número significar
algo num painel. Sem `num_cpu` o cliente mostra a carga bruta e nenhuma barra,
em vez de inventar um percentual.

## Security / Platform
- Endpoint bound to same origin, no CORS, session-IP binding.
- `/sys`/`/proc` readable under NixOS `DynamicUser` + `ProtectSystem=strict`.
- VMs may report 0 temp → mark unavailable.
