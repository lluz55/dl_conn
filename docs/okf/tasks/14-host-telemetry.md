---
type: task
title: "Fase 14 — Telemetria completa do host no dashboard"
status: done
---

# Fase 14 — Telemetria completa do host

- [x] `internal/sensors` (cpu, memory, disk, uptime, gpu, battery, collector)
- [x] `internal/store` SQLite persistence + prune
- [x] `internal/nostr.HostTelemetry` + optional field in ResponsePayload
- [x] `GET /api/host/telemetry` (session-auth)
- [x] `web/index.html` card Saúde do host + `web/style.css` grid
- [x] `web/app.js` polling + Nostr host_telemetry render
- [x] Auto-lock 1 e 3 minutos (web/index.html + web/app.js plural fix)
- [x] Config `telemetry.*` in `internal/config/config.go`
- [x] Concept `docs/okf/concepts/host-telemetry.md`

## Done when
- `go vet ./...` and `go test ./...` green; dashboard shows CPU/RAM/disk/GPU/battery/uptime; 1 and 3 min auto-lock works.
