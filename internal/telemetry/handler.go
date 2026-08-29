package telemetry

import (
	"encoding/json"
	"net/http"

	"dl_conn/internal/auth"
	"dl_conn/internal/sensors"
)

// Handler serves GET /api/host/telemetry behind session auth.
type Handler struct {
	collector *sensors.Collector
	sessions  *auth.SessionManager
}

func NewHandler(c *sensors.Collector, sm *auth.SessionManager) *Handler {
	return &Handler{collector: c, sessions: sm}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.sessions.ValidateSession(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	snap := h.collector.Latest()
	if snap == nil {
		http.Error(w, "no telemetry yet", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}
