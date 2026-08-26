// Package health probes the local targets of the configured services so the
// daemon only ever advertises a service as active after it has answered.
package health

import (
	"context"
	"net"
	"net/url"
	"sync"
	"time"

	"dl_conn/internal/config"
)

// Status values carried in the Nostr response payload.
const (
	// StatusUnknown means the target has not been probed yet. The frontend
	// must not paint it green — an unprobed service is not a confirmed one.
	StatusUnknown = "unknown"
	StatusUp      = "up"
	StatusDown    = "down"
)

// DefaultInterval is how often every target is re-probed.
const DefaultInterval = 30 * time.Second

// DefaultTimeout bounds a single probe.
const DefaultTimeout = 3 * time.Second

// Monitor keeps the last observed status of every configured service.
type Monitor struct {
	services []config.ServiceConfig
	interval time.Duration
	timeout  time.Duration

	mu     sync.RWMutex
	status map[string]string
}

// New creates a Monitor for the given services. Every service starts as
// StatusUnknown until the first probe completes.
func New(services []config.ServiceConfig) *Monitor {
	m := &Monitor{
		services: services,
		interval: DefaultInterval,
		timeout:  DefaultTimeout,
		status:   make(map[string]string, len(services)),
	}
	for _, s := range services {
		m.status[s.ID] = StatusUnknown
	}
	return m
}

// Status returns the last observed status for a service ID. Unknown IDs read
// as StatusUnknown rather than as an error: callers render, they don't branch.
func (m *Monitor) Status(id string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.status[id]; ok {
		return s
	}
	return StatusUnknown
}

// Run probes every target once immediately and then on each interval tick,
// until ctx is cancelled.
func (m *Monitor) Run(ctx context.Context) {
	m.probeAll(ctx)
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.probeAll(ctx)
		}
	}
}

func (m *Monitor) ProbeAll(ctx context.Context) {
	m.probeAll(ctx)
}

func (m *Monitor) probeAll(ctx context.Context) {
	var wg sync.WaitGroup
	for _, svc := range m.services {
		wg.Add(1)
		go func(svc config.ServiceConfig) {
			defer wg.Done()
			st := StatusDown
			if m.probe(ctx, svc.Target) {
				st = StatusUp
			}
			m.mu.Lock()
			m.status[svc.ID] = st
			m.mu.Unlock()
		}(svc)
	}
	wg.Wait()
}

// probe opens a TCP connection to the target's host:port. A dial is used
// rather than an HTTP request because targets may be non-HTTP or answer 401/404
// on "/" while being perfectly alive — reachability is the question here.
func (m *Monitor) probe(ctx context.Context, target string) bool {
	addr := hostPort(target)
	if addr == "" {
		return false
	}
	d := net.Dialer{Timeout: m.timeout}
	ctx, cancel := context.WithTimeout(ctx, m.timeout)
	defer cancel()
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// hostPort extracts host:port from a target URL, filling in the scheme's
// default port when the URL omits it.
func hostPort(target string) string {
	u, err := url.Parse(target)
	if err != nil || u.Host == "" {
		return ""
	}
	if u.Port() != "" {
		return u.Host
	}
	switch u.Scheme {
	case "https", "wss":
		return net.JoinHostPort(u.Hostname(), "443")
	default:
		return net.JoinHostPort(u.Hostname(), "80")
	}
}
