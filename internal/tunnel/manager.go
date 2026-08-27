package tunnel

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sync"
	"time"
)

var tunnelURLRegex = regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)

// DefaultReadyTimeout bounds how long WaitReady waits for a freshly minted
// ephemeral URL to actually route traffic before giving up.
//
// Measured directly (dig @1.1.1.1 against a live quick-tunnel hostname,
// bypassing any local resolver): the record was still NXDOMAIN at Cloudflare's
// own authoritative resolver several minutes in, then resolved. This is
// Cloudflare's own DNS propagation for a brand-new *.trycloudflare.com
// hostname — not anything dl_conn controls, and not a local network/adblock
// issue (ruled out: curl and dig both fail identically to the Go client,
// and 1.1.1.1 itself doesn't have the record yet). Quick Tunnels are an
// unsupported, best-effort Cloudflare feature with no propagation-time SLA,
// so this errs generous rather than giving up on one that's merely slow.
const DefaultReadyTimeout = 5 * time.Minute

// readyPollInterval is how often WaitReady retries while waiting.
const readyPollInterval = 1 * time.Second

// WaitReady polls url until it gets a response with status below 500 (proof
// Cloudflare's edge is routing to the origin — even a 404 counts, this
// isn't checking the origin's own correctness) or ctx is done / timeout
// elapses. cloudflared printing the ephemeral hostname does not mean the
// edge has finished provisioning it: requests in that window fail outright
// (DNS not yet resolvable) or come back as Cloudflare's own error page, not
// anything the origin would ever send.
//
// onAttempt, if non-nil, is called after every attempt with the elapsed
// time and a short description of what happened (a network error, an HTTP
// status, ...) — without it, a long wait is silent and a failure carries no
// clue why, which is exactly what made the first version of this hard to
// debug.
func WaitReady(ctx context.Context, url string, timeout time.Duration, onAttempt func(elapsed time.Duration, detail string)) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	deadline := start.Add(timeout)
	for {
		ready, detail := probeOnce(ctx, client, url)
		if onAttempt != nil {
			onAttempt(time.Since(start), detail)
		}
		if ready {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(readyPollInterval):
		}
	}
}

// probeOnce performs a single reachability check. detail describes the
// outcome either way (a network error, or the HTTP status received) so
// callers can log it for diagnostics.
func probeOnce(ctx context.Context, client *http.Client, url string) (ready bool, detail string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, fmt.Sprintf("building request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Sprintf("request failed: %v", err)
	}
	defer resp.Body.Close()
	detail = fmt.Sprintf("status %d", resp.StatusCode)
	return resp.StatusCode < 500, detail
}

// Status represents the state of the tunnel process.
type Status struct {
	Running bool
	URL     string
	PID     int
}

// Manager orchestrates the cloudflared subprocess lifecycle:
// starting it, capturing the ephemeral URL, health checks, auto-restart,
// and graceful shutdown.
type Manager struct {
	binary    string
	target    string
	notifyURL chan string

	mu      sync.Mutex
	cmd     *exec.Cmd
	procURL string
	running bool
	pid     int
}

// NewManager creates a tunnel manager that runs cloudflared to proxy to the
// given target URL, e.g. "http://127.0.0.1:9099" for dl_conn's own server or
// "http://10.0.66.1:5000" to point a second, independent tunnel straight at
// a LAN service (see ServiceConfig.DirectTunnel).
func NewManager(binary, target string) *Manager {
	return &Manager{
		binary:    binary,
		target:    target,
		notifyURL: make(chan string, 1),
	}
}

// Start launches the cloudflared subprocess and begins streaming output.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return fmt.Errorf("tunnel already running")
	}
	cmd := exec.CommandContext(ctx, m.binary, "tunnel", "--url", m.target, "--no-autoupdate")
	m.cmd = cmd
	m.running = true
	m.mu.Unlock()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
		return fmt.Errorf("getting stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
		return fmt.Errorf("getting stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
		return fmt.Errorf("starting cloudflared: %w", err)
	}

	m.mu.Lock()
	m.pid = cmd.Process.Pid
	m.mu.Unlock()

	go m.scanOutput(ctx, stdout)
	go m.scanOutput(ctx, stderr)
	go m.healthCheck(ctx)
	go m.watchRestart(ctx)

	return nil
}

// scanOutput reads lines from r and scans for the ephemeral URL.
// When found, it emits the URL on the notifyURL channel once.
func (m *Manager) scanOutput(ctx context.Context, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		if match := tunnelURLRegex.FindString(line); match != "" {
			m.mu.Lock()
			if m.procURL == "" {
				m.procURL = match
				m.mu.Unlock()
				m.notifyURL <- match
			} else {
				m.mu.Unlock()
			}
		}
	}
}

// watchRestart restarts the tunnel with exponential backoff if the
// process exits unexpectedly.
func (m *Manager) watchRestart(ctx context.Context) {
	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd == nil {
		return
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()

	select {
	case <-ctx.Done():
		return
	case <-waitDone:
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()

		// Only auto-restart if context not cancelled
		select {
		case <-ctx.Done():
			return
		default:
		}

		backoff := 1 * time.Second
		maxBackoff := 30 * time.Second
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
				if err := m.Start(ctx); err == nil {
					return
				}
			}
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

// Wait blocks until the process exits.
func (m *Manager) Wait() error {
	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd == nil {
		return fmt.Errorf("not started")
	}
	return cmd.Wait()
}

// Shutdown gracefully terminates the cloudflared subprocess.
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	cmd := m.cmd
	m.running = false
	m.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}

	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		return fmt.Errorf("sending signal: %w", err)
	}

	done := make(chan struct{})
	go func() {
		cmd.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
	}
	return nil
}

// URL returns a channel that receives the ephemeral tunnel URL.
func (m *Manager) URL() <-chan string {
	return m.notifyURL
}

// Status returns the current tunnel status.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Status{
		Running: m.running,
		URL:     m.procURL,
		PID:     m.pid,
	}
}

// healthCheck periodically verifies the tunnel is responsive.
func (m *Manager) healthCheck(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			running := m.running
			m.mu.Unlock()
			if !running {
				return
			}
		}
	}
}
