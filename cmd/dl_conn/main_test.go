package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// okHandler is the next handler behind securityHeaders: it writes a body so
// the response is complete, and records nothing — these tests are about the
// headers the wrapper adds on the way through.
func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

// TestSecurityHeadersHSTS pins the transport guarantee and, just as
// importantly, where it must not be sent. Over LAN HTTP the header is ignored
// by browsers, and sending it anyway would make a browser that cached it
// refuse the plain-HTTP origin later — the exact downgrade the header exists
// to prevent, caused by the daemon itself.
func TestSecurityHeadersHSTS(t *testing.T) {
	tests := []struct {
		name    string
		build   func() *http.Request
		wantSet bool
	}{
		{
			// r.TLS is the other way a request can arrive over TLS; set below,
			// because httptest.NewRequest only builds plain HTTP requests.
			name:    "direct TLS",
			build:   func() *http.Request { return httptest.NewRequest("GET", "/", nil) },
			wantSet: true,
		},
		{
			name: "tunnel (X-Forwarded-Proto)",
			build: func() *http.Request {
				r := httptest.NewRequest("GET", "/", nil)
				r.Header.Set("X-Forwarded-Proto", "https")
				return r
			},
			wantSet: true,
		},
		{
			name: "forwarded proto is compared case-insensitively",
			build: func() *http.Request {
				r := httptest.NewRequest("GET", "/", nil)
				r.Header.Set("X-Forwarded-Proto", "HTTPS")
				return r
			},
			wantSet: true,
		},
		{
			name: "plain LAN HTTP",
			build: func() *http.Request {
				r := httptest.NewRequest("GET", "/", nil)
				r.Header.Set("X-Forwarded-Proto", "http")
				return r
			},
			wantSet: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := tt.build()
			// r.TLS is the other way a request can arrive over TLS; cover it
			// explicitly since httptest cannot produce it for a plain request.
			if tt.name == "direct TLS" {
				req.TLS = &tls.ConnectionState{}
			}
			w := httptest.NewRecorder()
			securityHeaders(okHandler()).ServeHTTP(w, req)

			got := w.Header().Get("Strict-Transport-Security")
			if tt.wantSet {
				if got != hstsValue {
					t.Errorf("Strict-Transport-Security = %q, want %q", got, hstsValue)
				}
				return
			}
			if got != "" {
				t.Errorf("Strict-Transport-Security = %q, want it absent over plain HTTP", got)
			}
		})
	}
}

// TestSecurityHeadersPermissionsPolicy checks the policy is sent whole: a
// partial one is worse than none, because it reads as a decision rather than an
// oversight. camera=(self) has to survive — the QR scanner calls getUserMedia
// when the user asks to read an nsec.
func TestSecurityHeadersPermissionsPolicy(t *testing.T) {
	w := httptest.NewRecorder()
	securityHeaders(okHandler()).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))

	got := w.Header().Get("Permissions-Policy")
	if got != permissionsPolicy {
		t.Errorf("Permissions-Policy = %q, want %q", got, permissionsPolicy)
	}
	for _, feature := range []string{"camera=(self)", "microphone=()", "geolocation=()", "payment=()", "usb=()"} {
		if !strings.Contains(got, feature) {
			t.Errorf("Permissions-Policy is missing %q; got %q", feature, got)
		}
	}
}

// TestSecurityHeaders_ExistingPolicyIntact guards the headers that were already
// there: the point of the two new ones is to add to the policy, not to replace
// it with a subset.
func TestSecurityHeaders_ExistingPolicyIntact(t *testing.T) {
	w := httptest.NewRecorder()
	securityHeaders(okHandler()).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))

	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := w.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if csp := w.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("Content-Security-Policy lost frame-ancestors: %q", csp)
	}
}

// TestNewNostrClientWipesKeyBuffer checks the key buffer is zeroed after the
// client is built — including on the failure path, which is the one a
// misconfigured key takes and the one where a plain early return would have
// left the secret in a buffer nothing ever touches again.
func TestNewNostrClientWipesKeyBuffer(t *testing.T) {
	assertZeroed := func(t *testing.T, buf []byte) {
		t.Helper()
		for i, b := range buf {
			if b != 0 {
				t.Fatalf("key byte %d = %#x, want 0: the buffer still holds key material", i, b)
			}
		}
	}

	good := []byte("0000000000000000000000000000000000000000000000000000000000000001")
	if _, err := newNostrClient(good, []string{"wss://relay.example"}, nil, false); err != nil {
		t.Fatalf("building a client from a valid key: %v", err)
	}
	assertZeroed(t, good)

	bad := []byte("not-a-32-byte-hex-private-key")
	if _, err := newNostrClient(bad, []string{"wss://relay.example"}, nil, false); err == nil {
		t.Fatal("expected an error for an invalid key")
	}
	assertZeroed(t, bad)
}
