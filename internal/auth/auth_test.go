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
	id := sm.CreateSession()
	if id == "" {
		t.Fatal("session ID should not be empty")
	}
	if !sm.ValidateSession(id) {
		t.Error("session should be valid")
	}
}

func TestSessionManager_InvalidSession(t *testing.T) {
	sm := NewSessionManager(4 * time.Hour)
	if sm.ValidateSession("") {
		t.Error("empty session should be invalid")
	}
	if sm.ValidateSession("nonexistent") {
		t.Error("nonexistent session should be invalid")
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
