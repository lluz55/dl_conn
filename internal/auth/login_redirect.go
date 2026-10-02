package auth

import (
	"net/http"
	"net/url"
	"strings"
)

// NextParam is the query parameter the SPA reads to learn where the browser
// was headed when it was bounced to the login page.
const NextParam = "next"

// LoginPath is dl_conn's own SPA, which is the login page: it holds the
// vault (unlock) and the Nostr identity that discovery — and therefore a
// fresh one-time token — depends on.
const LoginPath = "/"

// IsDocumentNavigation reports whether a request is a browser navigating to
// a page, as opposed to a sub-resource fetch, an API call, or a protocol
// upgrade.
//
// Only a navigation may be answered with a redirect to the login page: an
// XHR/fetch would follow the 302 transparently and hand the SPA's HTML to
// code expecting JSON, an <img>/<script> would render the login page as
// garbage, and a WebSocket handshake cannot follow a redirect at all. Those
// keep getting the machine-readable 401/403 they already got.
func IsDocumentNavigation(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	// Fetch metadata is authoritative when present (browsers set it on every
	// request and it cannot be forged by page script): only a top-level
	// navigation of a document is one.
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" {
		if !strings.EqualFold(mode, "navigate") {
			return false
		}
		// Dest must be "document" — the single top-level navigation of a
		// page. "iframe" is a nested browsing context, which is how dl_conn's
		// own login page (or any other page a user embeds) would ask for a
		// protected resource: the answer is supposed to be a framed
		// resource, and a redirect to the login page inside the frame is
		// useless to whoever framed it. The SPA's CSP already sets
		// frame-ancestors 'none', so this endpoint's own frame-denial is the
		// only half that reaches *other* services behind the same tunnel —
		// and an <iframe> is exactly the case where a login page would be
		// framed rather than shown.
		if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" && !strings.EqualFold(dest, "document") {
			return false
		}
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// LoginRedirect builds the URL an unauthenticated navigation is sent to:
// dl_conn's own SPA, carrying the path the browser was trying to reach so
// the SPA can return there once a fresh session exists.
//
// next is reduced by SafeRedirect first, so a link crafted by someone else
// can't turn the login page into an open redirect — the value survives a
// round trip through the SPA and comes back as /auth?redirect=…, which is
// exactly the parameter that has to stay same-origin.
func LoginRedirect(next string) string {
	target := SafeRedirect(next)
	if target == LoginPath {
		return LoginPath
	}
	return LoginPath + "?" + NextParam + "=" + url.QueryEscape(target)
}

// RequestTarget is the path+query a request was aiming at, in the form
// SafeRedirect accepts.
func RequestTarget(r *http.Request) string {
	target := r.URL.EscapedPath()
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	return target
}

// RedirectToLogin sends a browser navigation to the login page instead of
// answering with a bare authentication error. Callers must have established
// that the request is a document navigation (IsDocumentNavigation).
//
// 303 rather than 302: the browser must issue a plain GET for the login
// page regardless of the original method, and must not treat the answer as
// a cacheable substitute for the protected resource.
func RedirectToLogin(w http.ResponseWriter, r *http.Request, next string) {
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, LoginRedirect(next), http.StatusSeeOther)
}
