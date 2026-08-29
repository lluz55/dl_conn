package nostr

import (
	"encoding/json"
	"time"
)

// RequestMessage is the encrypted NIP-44 payload the client sends.
type RequestMessage struct {
	Action string `json:"action"`
}

// ServiceInfo is the public view of a service.
type ServiceInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description,omitempty"`
	Prefix      string `json:"prefix"`
	Websocket   bool   `json:"websocket"`
	// Status is "up", "down" or "unknown". The frontend only paints a service
	// green for "up" — an unprobed service is never a confirmed one.
	Status      string `json:"status"`
}

// HostTelemetry is an optional snapshot of the host's health included in the
// discovery response when telemetry.exposeViaNostr is true.
type HostTelemetry struct {
	SampledAt string  `json:"sampled_at"`
	CpuTempC  *float64 `json:"cpu_temp_c,omitempty"`
	CpuLoad1  float64 `json:"cpu_load1,omitempty"`
	CpuLoad5  float64 `json:"cpu_load5,omitempty"`
	CpuLoad15 float64 `json:"cpu_load15,omitempty"`
	CpuFreqMHz *float64 `json:"cpu_freq_mhz,omitempty"`
	RamUsedPct float64 `json:"ram_used_pct,omitempty"`
	RamUsedMB  int64   `json:"ram_used_mb,omitempty"`
	RamTotalMB int64   `json:"ram_total_mb,omitempty"`
	DiskUsedPct float64 `json:"disk_used_pct,omitempty"`
	DiskUsedMB  int64   `json:"disk_used_mb,omitempty"`
	DiskTotalMB int64   `json:"disk_total_mb,omitempty"`
	Mountpoint  string  `json:"mountpoint,omitempty"`
	GpuTempC   *float64 `json:"gpu_temp_c,omitempty"`
	GpuUtilPct *float64 `json:"gpu_util_pct,omitempty"`
	BattCapacityPct *int   `json:"batt_capacity_pct,omitempty"`
	BattStatus      string `json:"batt_status,omitempty"`
	UptimeSec  int64 `json:"uptime_s,omitempty"`
}

// ResponsePayload is the JSON encrypted with NIP-44 and sent back.
type ResponsePayload struct {
	Status           string         `json:"status"`
	TunnelURL        string         `json:"tunnel_url"`
	AuthToken        string         `json:"auth_token"`
	ExpiresInSeconds int            `json:"expires_in_seconds"`
	Services         []ServiceInfo  `json:"services"`
	HostTelemetry    *HostTelemetry `json:"host_telemetry,omitempty"`
}

// DiscoverRequest is the expected payload for the discover_services action.
const ActionDiscoverServices = "discover_services"

// MarshalRequest serializes a RequestMessage to JSON.
func MarshalRequest(r RequestMessage) ([]byte, error) {
	return json.Marshal(r)
}

// UnmarshalRequest deserializes a RequestMessage from JSON.
func UnmarshalRequest(data []byte) (RequestMessage, error) {
	var r RequestMessage
	err := json.Unmarshal(data, &r)
	return r, err
}

// MarshalResponse serializes a ResponsePayload to JSON.
func MarshalResponse(r ResponsePayload) ([]byte, error) {
	return json.Marshal(r)
}

// UnmarshalResponse deserializes a ResponsePayload from JSON.
func UnmarshalResponse(data []byte) (ResponsePayload, error) {
	var r ResponsePayload
	err := json.Unmarshal(data, &r)
	return r, err
}

// NewResponse constructs a ResponsePayload from tunnel URL, auth token, and services.
func NewResponse(tunnelURL, authToken string, ttl time.Duration, services []ServiceInfo) ResponsePayload {
	return ResponsePayload{
		Status:          "ok",
		TunnelURL:       tunnelURL,
		AuthToken:       authToken,
		ExpiresInSeconds: int(ttl.Seconds()),
		Services:        services,
	}
}
