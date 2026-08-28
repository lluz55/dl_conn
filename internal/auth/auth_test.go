package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTokenManager_IssuanceAndConsumption(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	token, ttl, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if ttl != 120*time.Second {
		t.Errorf("ttl = %v, want 120s", ttl)
	}
	if len(token) < 32 {
		t.Errorf("token too short: %d chars", len(token))
	}

	// consume once — should succeed
	if !tm.Consume(token) {
		t.Error("first consume should succeed")
	}

	// consume again — should fail (one-time use)
	if tm.Consume(token) {
		t.Error("second consume should fail (one-time use)")
	}
}

func TestTokenManager_InvalidToken(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	if tm.Consume("nonexistent") {
		t.Error("expected false for nonexistent token")
	}
}

func TestTokenManager_ExpiredToken(t *testing.T) {
	tm := NewTokenManager(100 * time.Millisecond)
	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if tm.Consume(token) {
		t.Error("expired token should be rejected")
	}
}

func TestTokenManager_Cleanup(t *testing.T) {
	tm := NewTokenManager(100 * time.Millisecond)
	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	tm.Cleanup()
	if tm.Consume(token) {
		t.Error("token should be cleaned up")
	}
}

func TestSessionManager_CreateAndValidate(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	req := httptest.NewRequest("GET", "/", nil)
	id := sm.CreateSession(req)
	if id == "" {
		t.Fatal("session ID should not be empty")
	}
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})
	if !sm.ValidateSession(req) {
		t.Error("session should be valid")
	}
}

func TestSessionManager_InvalidSession(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	if sm.ValidateSession(httptest.NewRequest("GET", "/", nil)) {
		t.Error("empty session should be invalid")
	}
	reqBogus := httptest.NewRequest("GET", "/", nil)
	reqBogus.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: "nonexistent"})
	if sm.ValidateSession(reqBogus) {
		t.Error("nonexistent session should be invalid")
	}
}

func TestSessionManager_IPMismatchDenied(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	createReq := httptest.NewRequest("GET", "/", nil)
	createReq.RemoteAddr = "203.0.113.10:5555"
	id := sm.CreateSession(createReq)

	sameIP := httptest.NewRequest("GET", "/", nil)
	sameIP.RemoteAddr = "203.0.113.10:9999" // port differs, host doesn't
	sameIP.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})
	if !sm.ValidateSession(sameIP) {
		t.Error("session should validate from the same client address")
	}

	otherIP := httptest.NewRequest("GET", "/", nil)
	otherIP.RemoteAddr = "198.51.100.20:5555"
	otherIP.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})
	if sm.ValidateSession(otherIP) {
		t.Error("session should be denied from a different client address")
	}
}

func TestSessionManager_Invalidate(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	req := httptest.NewRequest("GET", "/", nil)
	id := sm.CreateSession(req)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})
	if !sm.ValidateSession(req) {
		t.Fatal("session should be valid before logout")
	}

	sm.Invalidate(id)

	if sm.ValidateSession(req) {
		t.Error("session should be invalid after logout")
	}
}

func TestClientIP_PrefersCfConnectingIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:4321" // cloudflared, not the real visitor
	req.Header.Set("X-Forwarded-For", "10.0.0.1")
	req.Header.Set("Cf-Connecting-Ip", "203.0.113.55")

	if got := ClientIP(req); got != "203.0.113.55" {
		t.Errorf("ClientIP = %q, want Cf-Connecting-Ip value", got)
	}
}

func TestAuthHandler_Logout(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	req := httptest.NewRequest("GET", "/", nil)
	id := sm.CreateSession(req)
	req.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})

	logoutReq := httptest.NewRequest("POST", "/auth/logout", nil)
	logoutReq.AddCookie(&http.Cookie{Name: "dl_conn_session", Value: id})
	w := httptest.NewRecorder()
	ah.HandleLogout(w, logoutReq)

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
	}
	if sm.ValidateSession(req) {
		t.Error("session should be revoked after logout")
	}
}

func TestAuthHandler_LogoutRequiresPost(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	req := httptest.NewRequest("GET", "/auth/logout", nil)
	w := httptest.NewRecorder()
	ah.HandleLogout(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
	}
}

func TestSessionManager_SetCookie(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	w := httptest.NewRecorder()
	sm.SetSessionCookie(w, "session123")

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != "dl_conn_session" {
		t.Errorf("cookie name = %q, want dl_conn_session", c.Name)
	}
	if !c.HttpOnly {
		t.Error("cookie should be HttpOnly")
	}
	if !c.Secure {
		t.Error("cookie should be Secure")
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("cookie SameSite = %v, want Lax", c.SameSite)
	}
}

func TestAuthHandler_Success(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()

	req := httptest.NewRequest("GET", "/auth?token="+token+"&redirect=%2Ffrigate%2F", nil)
	w := httptest.NewRecorder()

	ah.HandleAuth(w, req)

	if w.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusFound)
	}
	if w.Header().Get("Location") != "/frigate/" {
		t.Errorf("redirect = %q, want /frigate/", w.Header().Get("Location"))
	}
	// session cookie should be set
	cookies := w.Result().Cookies()
	if len(cookies) == 0 {
		t.Error("expected session cookie")
	}
}

func TestAuthHandler_InvalidToken(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	req := httptest.NewRequest("GET", "/auth?token=bogus&redirect=/frigate/", nil)
	w := httptest.NewRecorder()

	ah.HandleAuth(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAuthHandler_TokenReuseFails(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()

	// first use — success
	req := httptest.NewRequest("GET", "/auth?token="+token+"&redirect=/frigate/", nil)
	w1 := httptest.NewRecorder()
	ah.HandleAuth(w1, req)
	if w1.Code != http.StatusFound {
		t.Fatalf("first use: status = %d, want %d", w1.Code, http.StatusFound)
	}

	// second use — should fail
	req2 := httptest.NewRequest("GET", "/auth?token="+token+"&redirect=/frigate/", nil)
	w2 := httptest.NewRecorder()
	ah.HandleAuth(w2, req2)
	if w2.Code != http.StatusUnauthorized {
		t.Errorf("second use: status = %d, want %d", w2.Code, http.StatusUnauthorized)
	}
}

func TestAuthHandler_NoRedirectDefaultsToRoot(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(4 * time.Hour)
	ah := NewAuthHandler(tm, sm)

	token, _, _ := tm.Issue()

	req := httptest.NewRequest("GET", "/auth?token="+token, nil)
	w := httptest.NewRecorder()

	ah.HandleAuth(w, req)

	if w.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", w.Code, http.StatusFound)
	}
	if w.Header().Get("Location") != "/" {
		t.Errorf("redirect = %q, want /", w.Header().Get("Location"))
	}
}

func TestSafeRedirect(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty defaults to root", "", "/"},
		{"plain path", "/frigate/", "/frigate/"},
		{"path with query", "/hass/?view=map", "/hass/?view=map"},
		{"double slash inside path is harmless", "/a//b", "/a//b"},

		// Every case below resolves to a foreign origin in a browser.
		{"protocol-relative", "//evil.com", "/"},
		{"protocol-relative with path", "//evil.com/pwn", "/"},
		{"absolute url", "https://evil.com", "/"},
		{"scheme-only", "javascript:alert(1)", "/"},
		{"backslash variant", `/\evil.com`, "/"},
		{"backslash pair", `\\evil.com`, "/"},
		{"relative path", "frigate/", "/"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := safeRedirect(tt.in); got != tt.want {
				t.Errorf("safeRedirect(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestAuthHandler_RejectsOpenRedirect(t *testing.T) {
	tm := NewTokenManager(120 * time.Second)
	sm := NewSessionManager(time.Hour)
	h := NewAuthHandler(tm, sm)

	token, _, err := tm.Issue()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/auth?token="+token+"&redirect=//evil.com", nil)
	w := httptest.NewRecorder()
	h.HandleAuth(w, req)

	if got := w.Header().Get("Location"); got != "/" {
		t.Errorf("Location = %q, want %q (off-origin redirect must not survive)", got, "/")
	}
}
