package proxy

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Hub maintains active WebSocket connections for streaming.
type Hub struct {
	mu      sync.Mutex
	conns   map[*Conn]bool
}

// Conn wraps an active WebSocket connection.
type Conn struct {
	conn *websocket.Conn
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		conns: make(map[*Conn]bool),
	}
}

// Register adds a connection to the hub.
func (h *Hub) Register(c *Conn) {
	h.mu.Lock()
	h.conns[c] = true
	h.mu.Unlock()
}

// Unregister removes a connection from the hub.
func (h *Hub) Unregister(c *Conn) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(message []byte) {
	h.mu.Lock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	for _, c := range conns {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			h.Unregister(c)
		}
	}
}

// FlushInterval returns the interval for flushing video stream chunks.
func FlushInterval() time.Duration {
	return 500 * time.Millisecond
}
