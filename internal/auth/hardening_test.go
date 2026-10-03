package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// TestSessionCookiePartitioned covers the CHIPS attribute both ways: present
// when the operator opts in, absent by default. Every ephemeral tunnel lives
// under the same registrable domain (trycloudflare.com), so an unpartitioned
// session cookie set by one tunnel is offered to every other one a user opens.
func TestSessionCookiePartitioned(t *testing.T) {
	tests := []struct {
		name string
		opts Options
		want bool
	}{
		{"default is unpartitioned", Options{AnonymizeLogs: true}, false},
		{"opted in", Options{AnonymizeLogs: true, Partitioned: true}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sm := NewSessionManagerWithOptions(4*time.Hour, tt.opts)
			w := httptest.NewRecorder()
			sm.SetSessionCookie(w, "session123")

			cookies := w.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("expected 1 cookie, got %d", len(cookies))
			}
			if got := cookies[0].Partitioned; got != tt.want {
				t.Errorf("cookie Partitioned = %v, want %v", got, tt.want)
			}

			// The expiring cookie that /auth/logout writes has to carry the
			// same attribute, or the browser keeps the original one.
			clearRec := httptest.NewRecorder()
			sm.ClearSessionCookie(clearRec)
			cleared := clearRec.Result().Cookies()
			if len(cleared) != 1 {
				t.Fatalf("expected 1 cleared cookie, got %d", len(cleared))
			}
			if got := cleared[0].Partitioned; got != tt.want {
				t.Errorf("cleared cookie Partitioned = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestAuthRateLimit fires far more redemptions than the configured ceiling in
// a fraction of a second and expects at least one refusal: without a limiter,
// /auth is a token-guessing oracle that anyone who can reach the tunnel can
// hammer.
func TestAuthRateLimit(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	// 1/s sustained with a burst of 2: far below the flood below, far above
	// any real login.
	ah := NewAuthHandlerWithRateLimit(tm, sm, 1, 2)

	throttled := 0
	for i := 0; i < 30; i++ {
		token, _, _ := tm.Issue()
		req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token), nil)
		req.Header.Set("Cf-Connecting-Ip", "203.0.113.7")
		w := httptest.NewRecorder()
		ah.HandleAuth(w, req)

		switch w.Code {
		case http.StatusTooManyRequests:
			throttled++
			if got := w.Header().Get("Retry-After"); got != "1" {
				t.Errorf("Retry-After = %q, want 1", got)
			}
		case http.StatusFound:
		default:
			t.Fatalf("unexpected status %d", w.Code)
		}
	}

	if throttled == 0 {
		t.Fatal("no request was throttled; the rate limit is not being applied")
	}
}

// TestAuthRateLimit_PerClientAddress makes sure the bucket is per address:
// cloudflared connects over loopback, so keying on RemoteAddr alone would put
// every caller in the world behind one shared limit.
func TestAuthRateLimit_PerClientAddress(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandlerWithRateLimit(tm, sm, 1, 1)

	fire := func(ip string) int {
		token, _, _ := tm.Issue()
		req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token), nil)
		req.Header.Set("Cf-Connecting-Ip", ip)
		w := httptest.NewRecorder()
		ah.HandleAuth(w, req)
		return w.Code
	}

	// Each address gets its own bucket, so the first request from a fresh
	// address is never throttled no matter what another one did.
	for _, ip := range []string{"198.51.100.1", "198.51.100.2", "198.51.100.3"} {
		if code := fire(ip); code != http.StatusFound {
			t.Errorf("first request from %s = %d, want %d (its bucket should be fresh)", ip, code, http.StatusFound)
		}
	}
}

// TestAuthPostFlow_Valid covers the body form: a token in a body never reaches
// browser history, an access log, or the Referer of whatever the landing page
// loads — which is the whole reason it exists.
func TestAuthPostFlow_Valid(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()
	form := url.Values{"token": {token}, "redirect": {"/frigate/"}}
	req := httptest.NewRequest("POST", "/auth", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
	}
	var payload struct {
		Redirect string `json:"redirect"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decoding response: %v (body: %s)", err, w.Body.String())
	}
	if payload.Redirect != "/frigate/" {
		t.Errorf("redirect = %q, want /frigate/", payload.Redirect)
	}
	// A fetch() caller still needs the session cookie, so the redemption has
	// to be a real one.
	if len(w.Result().Cookies()) == 0 {
		t.Error("no session cookie issued on a successful POST")
	}
}

func TestAuthPostFlow_JSON(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()
	body, _ := json.Marshal(map[string]string{"token": token, "redirect": "/hass/"})
	req := httptest.NewRequest("POST", "/auth", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "/hass/") {
		t.Errorf("body = %s, want the redirect target", w.Body.String())
	}
}

// A top-level form POST is a real browser navigation, not a fetch(): the
// /auth response has to be a redirect so the Set-Cookie on it lands in a
// first-party context (the SPA on a non-tunnel origin cannot store a
// cross-origin Set-Cookie from a fetch() at all in modern Chrome). The
// destination is the same place GET would have gone to.
func TestAuthPostFlow_FormSubmissionRedirects(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()
	form := url.Values{"token": {token}, "redirect": {"/hass/"}}
	req := httptest.NewRequest("POST", "/auth", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Dest", "document")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusSeeOther, w.Body.String())
	}
	if got, want := w.Header().Get("Location"), "/hass/"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
	if len(w.Result().Cookies()) == 0 {
		t.Error("no session cookie issued on a successful POST")
	}
}

// An invalid-token POST that is a top-level form submission is a navigation
// the same way an expired GET is: the browser should land on the login page
// carrying its destination, not on a JSON 401 the browser can't render.
func TestAuthPostFlow_InvalidTokenFormSubmissionGoesToLogin(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	form := url.Values{"token": {"not-a-real-token"}, "redirect": {"/hass/"}}
	req := httptest.NewRequest("POST", "/auth", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Dest", "document")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d (body: %s)", w.Code, http.StatusSeeOther, w.Body.String())
	}
	if got, want := w.Header().Get("Location"), "/?next=%2Fhass%2F"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

// TestAuthPostFlow_Invalid keeps the GET semantics: a bad token is an
// authentication failure, not a navigation, so there is no login redirect to
// answer with.
func TestAuthPostFlow_Invalid(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	form := url.Values{"token": {"not-a-real-token"}}
	req := httptest.NewRequest("POST", "/auth", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// TestAuthGetDeprecation pins the compatibility window: GET keeps working, and
// says so, rather than being removed under callers that never read Sunset.
func TestAuthGetDeprecation(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()
	req := httptest.NewRequest("GET", "/auth?token="+url.QueryEscape(token)+"&redirect=/hass/", nil)
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d (GET must keep working during deprecation)", w.Code, http.StatusFound)
	}
	if got := w.Header().Get("Warning"); !strings.HasPrefix(got, "299") {
		t.Errorf("Warning = %q, want a 299 deprecation notice", got)
	}
	if got := w.Header().Get("Sunset"); got != getTokenSunset {
		t.Errorf("Sunset = %q, want %q", got, getTokenSunset)
	}
}

// TestAuthHeaderToken covers the browserless form: a native client with no
// cookie jar can redeem a token without ever putting it in a URL.
func TestAuthHeaderToken(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()
	req := httptest.NewRequest("GET", "/auth?redirect=/hass/", nil)
	req.Header.Set(TokenHeader, token)
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusFound)
	}
	if loc := w.Header().Get("Location"); loc != "/hass/" {
		t.Errorf("Location = %q, want /hass/", loc)
	}
}

// TestAuthPostBodyTooLarge keeps the body read bounded: /auth is reachable
// without any credential, so an unbounded read here is a free way to make the
// daemon allocate.
func TestAuthPostBodyTooLarge(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	req := httptest.NewRequest("POST", "/auth", strings.NewReader(strings.Repeat("a", 16<<10)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	ah.HandleAuth(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestStepUpEndToEnd walks the whole path a frontend takes: mint a proof with
// the session, present it, get through; then the two ways it must not — no
// proof, and a proof minted for a different session.
func TestStepUpEndToEnd(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	stepUp := NewStepUpWithSecret([]byte("test-secret-that-is-not-used-anywhere-else"))
	handler := NewStepUpHandler(sm, stepUp)

	sessionID := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	sessionReq := func() *http.Request {
		req := httptest.NewRequest("POST", StepUpPath, nil)
		req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
		return req
	}

	// Mint.
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, sessionReq())
	if w.Code != http.StatusOK {
		t.Fatalf("step-up mint = %d, want %d (body: %s)", w.Code, http.StatusOK, w.Body.String())
	}
	var issued struct {
		Header string `json:"header"`
		Value  string `json:"value"`
		TTLSec int    `json:"ttlSec"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &issued); err != nil {
		t.Fatalf("decoding step-up response: %v", err)
	}
	if issued.Header != StepUpHeader {
		t.Errorf("header = %q, want %q", issued.Header, StepUpHeader)
	}
	if issued.TTLSec != int(StepUpWindow.Seconds()) {
		t.Errorf("ttlSec = %d, want %d", issued.TTLSec, int(StepUpWindow.Seconds()))
	}

	// Accept: a valid, in-window proof passes.
	enforceRec := httptest.NewRecorder()
	if !stepUp.Enforce(enforceRec, sessionID, issued.Value) {
		t.Errorf("a freshly issued proof was rejected (%d)", enforceRec.Code)
	}

	// Refuse: no proof at all.
	enforceRec = httptest.NewRecorder()
	if stepUp.Enforce(enforceRec, sessionID, "") {
		t.Error("a missing proof was accepted")
	}
	if enforceRec.Code != http.StatusUnauthorized {
		t.Errorf("missing proof = %d, want %d", enforceRec.Code, http.StatusUnauthorized)
	}

	// Refuse: a proof that is real but belongs to another session.
	otherSession := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	enforceRec = httptest.NewRecorder()
	if stepUp.Enforce(enforceRec, otherSession, issued.Value) {
		t.Error("a proof issued for one session was accepted for another")
	}
}

// TestStepUp_ProofExpires walks the window itself: a proof stops verifying once
// the clock leaves its bucket (and the one before it).
func TestStepUp_ProofExpires(t *testing.T) {
	stepUp := NewStepUpWithSecret([]byte("another-test-secret-not-used-in-production"))
	sessionID := "session-for-expiry"

	issued := time.Now()
	proof := stepUp.Issue(sessionID, issued)

	if !stepUp.Verify(sessionID, proof, issued) {
		t.Fatal("a proof must verify in the bucket it was issued in")
	}
	// The previous bucket stays valid so a client that just missed a boundary
	// isn't refused for a rounding error.
	if !stepUp.Verify(sessionID, proof, issued.Add(StepUpWindow-time.Second)) {
		t.Error("a proof must survive into the bucket before expiry")
	}
	if stepUp.Verify(sessionID, proof, issued.Add(2*StepUpWindow+time.Second)) {
		t.Error("a proof must stop verifying once its window has passed")
	}
}

// TestStepUp_MintRequiresSession: the endpoint is not a way to bootstrap access
// — it only re-arms a privilege for someone who already has one.
func TestStepUp_MintRequiresSession(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	handler := NewStepUpHandler(sm, NewStepUpWithSecret([]byte("secret-for-the-mint-guard-test")))

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", StepUpPath, nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d without a session", w.Code, http.StatusUnauthorized)
	}

	// A GET would let any cross-site <img> arm the privilege with the cookie
	// the browser attaches; the method is the part that makes it checkable.
	w = httptest.NewRecorder()
	req := httptest.NewRequest("POST", StepUpPath, nil)
	sessionID := sm.CreateSession(httptest.NewRequest("GET", "/", nil))
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	getReq := httptest.NewRequest("GET", StepUpPath, nil)
	getReq.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: sessionID})
	handler.ServeHTTP(w, getReq)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
	}
}

// TestLogIPAnonymize covers the truncation rules and the two inputs that are
// not addresses at all. The log is what gets shipped off-host, so the shape of
// what lands in it is the feature.
func TestLogIPAnonymize(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"ipv4 keeps its network", "10.0.66.42", "10.0.66.*"},
		{"ipv4 loopback", "127.0.0.1", "127.0.0.*"},
		{"ipv6 keeps its routing prefix", "2001:db8:1234:5678:9abc:def0:1234:5678", "2001:db8:1234:*"},
		{"ipv6 loopback", "::1", "0:0:0:*"},
		{"ipv4-mapped ipv6 is treated as ipv4", "::ffff:10.0.66.42", "10.0.66.*"},
		{"empty stays empty", "", ""},
		{"not an address is echoed", "::not-an-ip", "::not-an-ip"},
		{"host:port is not an address", "10.0.66.42:50586", "10.0.66.42:50586"},
	}
	for _, tt := range tests {
		if got := Anonymize(tt.in); got != tt.want {
			t.Errorf("%s: Anonymize(%q) = %q, want %q", tt.name, tt.in, got, tt.want)
		}
	}
}

// TestLogIPPolicy checks the two configured policies: anonymized by default,
// and fully redacted when the operator asks for no address at all.
func TestLogIPPolicy(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Cf-Connecting-Ip", "10.0.66.42")

	anonymized := NewSessionManagerWithOptions(time.Hour, Options{AnonymizeLogs: true})
	if got := anonymized.IPForLog(req); got != "10.0.66.*" {
		t.Errorf("anonymized policy = %q, want 10.0.66.*", got)
	}

	redacted := NewSessionManagerWithOptions(time.Hour, Options{AnonymizeLogs: false})
	if got := redacted.IPForLog(req); got != "[redacted]" {
		t.Errorf("redacted policy = %q, want [redacted]", got)
	}
}
