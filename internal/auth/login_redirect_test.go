package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestIsDocumentNavigation(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		headers map[string]string
		want    bool
	}{
		{"html navigation", "GET", map[string]string{"Accept": "text/html,application/xhtml+xml"}, true},
		{"head navigation", "HEAD", map[string]string{"Accept": "text/html"}, true},
		{"xhr asking for json", "GET", map[string]string{"Accept": "application/json"}, false},
		{"post form", "POST", map[string]string{"Accept": "text/html"}, false},
		{"websocket upgrade", "GET", map[string]string{"Accept": "text/html", "Upgrade": "websocket"}, false},

		// Fetch metadata wins over Accept: a fetch() can ask for text/html
		// while being anything but a navigation, and answering it with a
		// redirect to the login page hands HTML to code expecting data.
		{"fetch with html accept", "GET", map[string]string{
			"Accept": "text/html", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"}, false},
		{"script sub-resource", "GET", map[string]string{
			"Accept": "*/*", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script"}, false},
		{"real navigation", "GET", map[string]string{
			"Accept": "text/html", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/frigate/", nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			if got := IsDocumentNavigation(req); got != tt.want {
				t.Errorf("IsDocumentNavigation() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestLoginRedirect(t *testing.T) {
	tests := []struct {
		name string
		next string
		want string
	}{
		{"service path", "/frigate/", "/?next=%2Ffrigate%2F"},
		{"path with query", "/hass/?view=map", "/?next=%2Fhass%2F%3Fview%3Dmap"},
		{"empty next is plain login", "", "/"},
		{"root next is plain login", "/", "/"},
		// The value survives to /auth?redirect=… later, so an off-origin
		// target must not make it into the login URL in the first place.
		{"off-origin target dropped", "//evil.com", "/"},
		{"absolute url dropped", "https://evil.com/pwn", "/"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := LoginRedirect(tt.next); got != tt.want {
				t.Errorf("LoginRedirect(%q) = %q, want %q", tt.next, got, tt.want)
			}
		})
	}
}

func TestRequestTarget(t *testing.T) {
	req := httptest.NewRequest("GET", "/frigate/events?camera=front", nil)
	if got, want := RequestTarget(req), "/frigate/events?camera=front"; got != want {
		t.Errorf("RequestTarget() = %q, want %q", got, want)
	}
}

// An expired one-time token in a shared link is the ordinary case, not an
// attack: the browser should land on the login page still knowing where it
// was going, instead of on a raw 401.
func TestHandleAuth_ExpiredTokenNavigationGoesToLogin(t *testing.T) {
	tm := NewTokenManager(time.Nanosecond)
	sm := NewSessionManager(time.Hour)
	h := NewAuthHandler(tm, sm)

	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond) // past the TTL

	req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token)+"&redirect=%2Ffrigate%2F", nil)
	req.Header.Set("Accept", "text/html")
	w := httptest.NewRecorder()
	h.HandleAuth(w, req)

	if w.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusSeeOther)
	}
	if got, want := w.Header().Get("Location"), "/?next=%2Ffrigate%2F"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store (the login bounce must not be cached in place of the service)", got)
	}
}

// Same failure reached by a non-navigation keeps the machine-readable 401:
// a redirect there would feed the SPA's HTML to a JSON caller.
func TestHandleAuth_ExpiredTokenXHRStays401(t *testing.T) {
	tm := NewTokenManager(time.Nanosecond)
	sm := NewSessionManager(time.Hour)
	h := NewAuthHandler(tm, sm)

	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)

	req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token)+"&redirect=%2Ffrigate%2F", nil)
	req.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()
	h.HandleAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// A link whose token was already spent by another tab, opened by a browser
// with no session at all, is the same story as an expiry.
func TestHandleAuth_ReusedTokenNavigationGoesToLogin(t *testing.T) {
	tm := NewTokenManager(time.Hour)
	sm := NewSessionManager(time.Hour)
	h := NewAuthHandler(tm, sm)

	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if !tm.Consume(token) {
		t.Fatal("setup: first consume should succeed")
	}

	req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token)+"&redirect=%2Ffrigate%2F", nil)
	req.Header.Set("Accept", "text/html")
	w := httptest.NewRecorder()
	h.HandleAuth(w, req)

	if w.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusSeeOther)
	}
	if got, want := w.Header().Get("Location"), "/?next=%2Ffrigate%2F"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

// An off-origin redirect parameter must not survive the bounce either: the
// login page reads `next` back and turns it into /auth?redirect=…, so
// laundering it through the login URL would reopen the open redirect.
func TestHandleAuth_LoginBounceRejectsOpenRedirect(t *testing.T) {
	tm := NewTokenManager(time.Hour)
	sm := NewSessionManager(time.Hour)
	h := NewAuthHandler(tm, sm)

	req := httptest.NewRequest("GET", "/auth?token=bogus&redirect=https%3A%2F%2Fevil.com", nil)
	req.Header.Set("Accept", "text/html")
	w := httptest.NewRecorder()
	h.HandleAuth(w, req)

	if got := w.Header().Get("Location"); got != "/" {
		t.Errorf("Location = %q, want %q", got, "/")
	}
}
