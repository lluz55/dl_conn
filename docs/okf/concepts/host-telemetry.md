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

## Security / Platform
- Endpoint bound to same origin, no CORS, session-IP binding.
- `/sys`/`/proc` readable under NixOS `DynamicUser` + `ProtectSystem=strict`.
- VMs may report 0 temp → mark unavailable.
