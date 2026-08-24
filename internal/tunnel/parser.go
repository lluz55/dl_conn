package tunnel

import (
	"testing"
)

func TestParseTunnelURL(t *testing.T) {
	tests := []struct {
		line string
		want string
	}{
		{"2024-01-01T00:00:00Z INF Cannot determine default configuration path. Defaulting to /home/user/.cloudflared/config.yml", ""},
		{"2024-01-01T00:00:00Z INF version 2024.2.3", ""},
		{"2024-01-01T00:00:00Z TUNNEL: https://abcd1234.trycloudflare.com", "https://abcd1234.trycloudflare.com"},
		{"2024-01-01T00:00:00Z 2024/01/01 00:00:00 https://my-tunnel-123.trycloudflare.com", "https://my-tunnel-123.trycloudflare.com"},
		{"no url here", ""},
	}

	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			got := tunnelURLRegex.FindString(tt.line)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}
