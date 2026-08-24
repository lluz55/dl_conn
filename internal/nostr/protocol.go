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
	Prefix      string `json:"prefix"`
	Websocket   bool   `json:"websocket"`
}

// ResponsePayload is the JSON encrypted with NIP-44 and sent back.
type ResponsePayload struct {
	Status          string        `json:"status"`
	TunnelURL       string        `json:"tunnel_url"`
	AuthToken       string        `json:"auth_token"`
	ExpiresInSeconds int          `json:"expires_in_seconds"`
	Services        []ServiceInfo `json:"services"`
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
