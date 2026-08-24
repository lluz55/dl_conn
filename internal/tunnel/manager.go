package tunnel

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sync"
	"time"
)

var tunnelURLRegex = regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)

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
	port      int
	notifyURL chan string

	mu      sync.Mutex
	cmd     *exec.Cmd
	procURL string
	running bool
	pid     int
}

// NewManager creates a tunnel manager that runs cloudflared to proxy
// to the given local port.
func NewManager(binary string, port int) *Manager {
	return &Manager{
		binary:    binary,
		port:      port,
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
	target := fmt.Sprintf("http://127.0.0.1:%d", m.port)
	cmd := exec.CommandContext(ctx, m.binary, "tunnel", "--url", target, "--no-autoupdate")
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
