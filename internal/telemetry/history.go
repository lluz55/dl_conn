package telemetry

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"dl_conn/internal/store"
)

// historyPathSuffix is the path this handler answers host history on. It is
// matched as a suffix rather than compared whole because the same Handler is
// mounted under both /api/host/telemetry and /api/host/history — one handler,
// one credential, one rate-limit budget, one set of CORS headers, instead of
// two endpoints that have to be kept identical by hand.
const historyPathSuffix = "/history"

// isHistoryPath reports whether this request wants host history rather than
// the point-in-time telemetry snapshot.
func isHistoryPath(path string) bool {
	return len(path) >= len(historyPathSuffix) &&
		path[len(path)-len(historyPathSuffix):] == historyPathSuffix
}

// hostHistory is the /api/host/history payload.
//
// Both fields are objects/arrays that are never null on the wire: a client
// that has to distinguish "no history" from "history failed" should get [] and
// {} for the former and a non-2xx for the latter.
type hostHistory struct {
	// Services maps a service ID to its probe series, oldest first. A service
	// absent from the map was never probed in the window.
	Services map[string][]store.ServiceHealthPoint `json:"services"`
	// Tunnel lists the incarnations overlapping the window, oldest first. The
	// current one has a null ended_at.
	Tunnel []store.TunnelIncarnation `json:"tunnel"`
	// From and To echo the window actually served, so a client that clamped
	// or defaulted its request can tell which one it got.
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

// serveHistory answers the host-history request.
//
// wantRange is honoured exactly as the snapshot range is: with neither ?from=
// nor ?to= there is no window to serve, and answering with "everything ever
// recorded" would be an unbounded response to a request that never asked for
// one. A history request without a window is therefore a 400, not a dump.
func (h *Handler) serveHistory(w http.ResponseWriter, from, to time.Time, points int, wantRange bool) {
	if h.store == nil {
		writeJSONError(w, http.StatusNotImplemented, "host history is not available")
		return
	}
	if !wantRange {
		writeJSONError(w, http.StatusBadRequest, `host history needs a window: pass "from" (and optionally "to")`)
		return
	}

	services, err := h.store.RangeServiceHealth(from, to, points)
	if err != nil {
		log.Printf("service health range query failed: from=%d to=%d points=%d err=%v",
			from.Unix(), to.Unix(), points, err)
		writeJSONError(w, http.StatusInternalServerError, "service health history unavailable")
		return
	}
	tunnel, err := h.store.RangeTunnelIncarnations(from, to, points)
	if err != nil {
		log.Printf("tunnel incarnation query failed: from=%d to=%d points=%d err=%v",
			from.Unix(), to.Unix(), points, err)
		writeJSONError(w, http.StatusInternalServerError, "tunnel history unavailable")
		return
	}

	if services == nil {
		services = map[string][]store.ServiceHealthPoint{}
	}
	if tunnel == nil {
		tunnel = []store.TunnelIncarnation{}
	}
	body, err := json.Marshal(hostHistory{
		Services: services,
		Tunnel:   tunnel,
		From:     from.Unix(),
		To:       to.Unix(),
	})
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "host history unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(body)
}