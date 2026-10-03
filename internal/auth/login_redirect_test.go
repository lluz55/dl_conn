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
		// POST is no longer a document navigation by default: a top-level
		// form POST is its own class (see IsFormSubmission), and a fetch()
		// POST must not be answered with a redirect.
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

// IsFormSubmission distinguishes a real top-level form POST (a browser
// navigation to /auth) from a fetch()/XHR POST, so /auth can answer each
// the right way: a redirect for form (which puts the cookie in a first-
// party context — the whole reason this exists), JSON for fetch.
func TestIsFormSubmission(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		headers map[string]string
		want    bool
	}{
		// A GET is not a form submission regardless of headers: the method
		// is what makes the redirect-vs-JSON split.
		{"get navigation is not a form", "GET", map[string]string{
			"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"}, false},

		// Real top-level form POST: Sec-Fetch-Mode: navigate + Dest: document.
		{"form submission with metadata", "POST", map[string]string{
			"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document",
			"Accept": "text/html", "Content-Type": "application/x-www-form-urlencoded"}, true},
		// Same without metadata: Accept: text/html is the legacy fallback.
		{"form submission via accept header", "POST", map[string]string{
			"Accept": "text/html,application/xhtml+xml",
			"Content-Type": "application/x-www-form-urlencoded"}, true},

		// fetch() POSTs: mode is no-cors / cors, not navigate.
		{"fetch no-cors", "POST", map[string]string{
			"Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "empty",
			"Accept": "*/*", "Content-Type": "application/x-www-form-urlencoded"}, false},
		{"fetch cors", "POST", map[string]string{
			"Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
			"Accept": "application/json", "Content-Type": "application/json"}, false},

		// An iframe POST: even though it's a navigation request, the
		// destination is wrong — a redirect to the login page inside a
		// frame is useless to whoever framed it.
		{"framed post", "POST", map[string]string{
			"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe"}, false},

		// WebSocket upgrade on POST is not a form submission either.
		{"websocket upgrade", "POST", map[string]string{
			"Upgrade": "websocket", "Accept": "text/html"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/auth", nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			if got := IsFormSubmission(req); got != tt.want {
				t.Errorf("IsFormSubmission() = %v, want %v", got, tt.want)
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


// TestIframeIsNotDocumentNavigation is the unit behind the frame refusal: a
// nested browsing context is not a place to put a login page. Whoever framed
// the request gets a frame full of someone else's login HTML, and the user
// never sees a page they can act on — so the destination must be "document"
// and nothing else.
func TestIframeIsNotDocumentNavigation(t *testing.T) {
	framed := httptest.NewRequest("GET", "/frigate/", nil)
	framed.Header.Set("Sec-Fetch-Mode", "navigate")
	framed.Header.Set("Sec-Fetch-Dest", "iframe")
	framed.Header.Set("Accept", "text/html")

	if IsDocumentNavigation(framed) {
		t.Error("a framed request was classified as a document navigation")
	}

	// A top-level navigation of the same shape is still a document: the
	// distinction is the destination, not the mode.
	top := httptest.NewRequest("GET", "/frigate/", nil)
	top.Header.Set("Sec-Fetch-Mode", "navigate")
	top.Header.Set("Sec-Fetch-Dest", "document")
	if !IsDocumentNavigation(top) {
		t.Error("a top-level navigation stopped being a document navigation")
	}
}
