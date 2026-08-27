package proxy

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	"dl_conn/internal/auth"
	"dl_conn/internal/config"
)

// Router multiplexes requests to configured services with Zero-Trust auth.
type Router struct {
	services  []config.ServiceConfig
	sessions  *auth.SessionManager
	proxies   map[string]*httputil.ReverseProxy
}

// NewRouter creates a new reverse proxy router.
func NewRouter(services []config.ServiceConfig, sessions *auth.SessionManager) *Router {
	rt := &Router{
		services: services,
		sessions: sessions,
		proxies:  make(map[string]*httputil.ReverseProxy),
	}
	for i := range services {
		rt.buildProxy(i)
	}
	return rt
}

// buildProxy creates or rebuilds the reverse proxy for service at index i.
func (rt *Router) buildProxy(i int) {
	svc := &rt.services[i]
	target, _ := url.Parse(svc.Target)
	proxy := httputil.NewSingleHostReverseProxy(target)
	origDir := proxy.Director
	prefix := svc.Prefix
	stripPrefix := svc.StripPrefix
	rootPaths := svc.RootPaths
	forwardedFor := svc.SendsForwardedFor()
	svcID := svc.ID
	proxy.Director = func(req *http.Request) {
		origDir(req)
		// X-Forwarded-For is deliberately not set here: ReverseProxy
		// appends the client IP itself after the Director runs, and doing
		// it here too produced "127.0.0.1:50586, 127.0.0.1" — RemoteAddr
		// carries a port, which makes the whole header unparseable. Home
		// Assistant answers 400 Bad Request to a malformed one.
		//
		// A nil map entry is how ReverseProxy is told to leave the header
		// off entirely (net/http/httputil, issue 38079); assigning it here
		// also drops any X-Forwarded-For the client sent us. See
		// ServiceConfig.ForwardedFor for when a backend needs that.
		if !forwardedFor {
			req.Header["X-Forwarded-For"] = nil
		}
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", req.Host)
		// De-facto standard header (used by Frigate, Home Assistant
		// ingress, etc.) telling an app-aware backend what public
		// prefix it's mounted under, so it can generate correct
		// asset/API/WebSocket URLs itself instead of assuming root.
		// Backends that don't recognize it just ignore it.
		if prefix != "" {
			req.Header.Set("X-Ingress-Path", prefix)
		}
		if stripPrefix {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, prefix)
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
		req.URL.Path = liftRootPath(req.URL.Path, rootPaths)
		// Rewritten responses below assume uncompressed bodies; ask the
		// upstream not to compress so ModifyResponse doesn't have to
		// gunzip/brotli-decode before patching asset paths.
		req.Header.Del("Accept-Encoding")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		if prefix == "" || !isRewritableContentType(resp.Header.Get("Content-Type")) {
			return nil
		}
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		resp.Body.Close()
		rewritten := rewriteAssetPaths(body, prefix)
		resp.Body = io.NopCloser(bytes.NewReader(rewritten))
		resp.ContentLength = int64(len(rewritten))
		resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		log.Printf("proxy error: service=%s target=%s path=%q remote=%s reason=%v",
			svcID, target, req.URL.Path, req.RemoteAddr, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"error":"upstream service unavailable"}`))
	}
	rt.proxies[svc.ID] = proxy
}

// rebuildProxy is used in tests to update a service's target.
func (rt *Router) rebuildProxy(i int) {
	rt.buildProxy(i)
}

// serviceCookieName holds the id of the service a browser is currently
// using — see matchService, step 4.
const serviceCookieName = "dl_conn_svc"

// isSPAPath reports whether a path belongs to dl_conn's own frontend rather
// than to any proxied service.
func isSPAPath(path string) bool {
	return strings.HasPrefix(path, "/_static/") ||
		path == "/" || path == "/index.html" ||
		strings.HasPrefix(path, "/app.js") ||
		strings.HasPrefix(path, "/style.css")
}

// RootFallback handles everything that didn't match a service prefix
// outright. Registering the SPA file server on "/" alone is not enough: a
// proxied SPA mounted under a prefix still asks for some sub-resources at
// the origin root (see matchService), and those requests would be answered
// with the file server's 404 without ever reaching the proxy.
//
// files is the same filesystem static serves from, consulted first: dl_conn's
// own frontend owns every path it actually has a file for, and nothing a
// proxied service does can take those over. Only what the SPA has no answer
// for is offered to the router.
func RootFallback(rt *Router, static http.Handler, files http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isSPAPath(r.URL.Path) && !servesFile(files, r.URL.Path) && rt.matchService(r) != nil {
			rt.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}

// servesFile reports whether the SPA filesystem has a regular file at path.
func servesFile(files http.FileSystem, path string) bool {
	if files == nil {
		return false
	}
	f, err := files.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	return err == nil && !st.IsDir()
}

// ServeHTTP routes requests through the Zero-Trust proxy.
func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /auth endpoint bypasses auth middleware
	if r.URL.Path == "/auth" || strings.HasPrefix(r.URL.Path, "/auth?") {
		return // handled by AuthHandler
	}

	// Static files and SPA shell
	if isSPAPath(r.URL.Path) {
		return // handled by static file server
	}

	// Zero-Trust: every other request requires a valid session
	if rt.sessions == nil || !rt.sessions.ValidateSession(rt.sessions.GetSessionID(r)) {
		log.Printf("auth denied: path=%q remote=%s reason=missing or invalid session",
			r.URL.Path, r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"forbidden: authenticate at /auth"}`))
		return
	}

	// Route to service based on prefix
	svc := rt.matchService(r)
	if svc == nil {
		log.Printf("route not found: path=%q remote=%s reason=no configured service prefix matches",
			r.URL.Path, r.RemoteAddr)
		http.NotFound(w, r)
		return
	}

	// Remember what the browser is looking at before answering, so both the
	// redirect below and the page it lands on carry the cookie.
	if isDocumentNavigation(r) && !svc.Hidden && strings.HasPrefix(r.URL.Path, svc.Prefix) {
		rt.setServiceCookie(w, svc.ID)
	}

	if target := trailingSlashRedirect(r, svc); target != "" {
		http.Redirect(w, r, target, http.StatusFound)
		return
	}

	proxy := rt.proxies[svc.ID]
	if proxy == nil {
		log.Printf("proxy not initialized: service=%s path=%q remote=%s",
			svc.ID, r.URL.Path, r.RemoteAddr)
		http.Error(w, "proxy not initialized", http.StatusInternalServerError)
		return
	}

	proxy.ServeHTTP(w, r)
}

// matchService decides which service a request belongs to. A request under a
// service's own prefix is unambiguous; everything else is a root-absolute
// sub-resource from a proxied frontend that doesn't know it's mounted under
// one ("/assets/…", "/static/…", "/onboarding.html", "/favicon.ico"), and has
// to be attributed by context:
//
//  1. a visible service's prefix — explicit, always wins;
//  2. the Referer, when the browser sends one: the page that issued the
//     request names its own service;
//  3. a declared root directory (see ServiceConfig.RootPaths);
//  4. the service this browser is currently using (see serviceCookieName),
//     which is what carries a backend that serves its whole frontend from
//     the origin root and suppresses Referer — Home Assistant does both;
//  5. a hidden service's prefix, the borrowed root-level route of some other
//     service's frontend. Last, because the browser's current service is the
//     better answer when both could claim the path: "/api/…" belongs to
//     Frigate's hidden route by default, but to Home Assistant while that is
//     what the browser is looking at.
func (rt *Router) matchService(r *http.Request) *config.ServiceConfig {
	if svc := rt.matchPrefix(r.URL.Path, false); svc != nil {
		return svc
	}
	if ref := r.Referer(); ref != "" {
		if refURL, err := url.Parse(ref); err == nil {
			if svc := rt.matchPrefix(refURL.Path, false); svc != nil {
				return svc
			}
		}
	}
	if svc := rt.matchRootPath(r.URL.Path); svc != nil {
		return svc
	}
	if svc := rt.matchServiceCookie(r); svc != nil {
		return svc
	}
	return rt.matchPrefix(r.URL.Path, true)
}

// matchServiceCookie resolves the service a browser is currently using, as
// recorded by setServiceCookie.
func (rt *Router) matchServiceCookie(r *http.Request) *config.ServiceConfig {
	c, err := r.Cookie(serviceCookieName)
	if err != nil || c.Value == "" {
		return nil
	}
	for i := range rt.services {
		if rt.services[i].ID == c.Value && !rt.services[i].Hidden {
			return &rt.services[i]
		}
	}
	return nil
}

// setServiceCookie records which service the browser is now looking at, so
// the root-absolute requests its page is about to make can be attributed to
// it. Written on document navigations only — a sub-resource fetch doesn't
// change which app the user is in — and never for a hidden service, which is
// plumbing rather than something to be "in".
func (rt *Router) setServiceCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     serviceCookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// isDocumentNavigation reports whether a request is a browser navigating to a
// page, as opposed to a sub-resource fetch, an API call, or a protocol
// upgrade. Only a navigation says anything about which app the user is in,
// and only a navigation can be answered with a redirect.
func isDocumentNavigation(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// trailingSlashRedirect returns the URL a document request for a service's
// bare prefix should be sent to, or "" when the request should be proxied as
// is. A mount prefix is a directory, and the browser has to know that:
// everything a proxied SPA resolves against the document path — its relative
// sub-resource URLs, and its client-side router's basename — loses the last
// segment without the trailing slash. Frigate's is a hard failure rather
// than a degradation: served at "/frigate" it sets basename "/frigate/",
// React Router's invariant that the location starts with the basename
// throws, and the page renders blank with an empty #root. The same redirect
// nginx issues for a directory fixes it for any client, including links
// built elsewhere.
//
// Only document navigations are redirected: an API root or a WebSocket
// handshake on a bare prefix means that exact path (a browser can't follow
// a redirect on an upgrade request at all), and hidden services are
// plumbing, never something a user navigates to.
func trailingSlashRedirect(r *http.Request, svc *config.ServiceConfig) string {
	if svc.Hidden || r.URL.Path != svc.Prefix || !isDocumentNavigation(r) {
		return ""
	}
	target := svc.Prefix + "/"
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	return target
}

// matchRootPath finds the service declaring a RootPaths entry that path
// starts with.
func (rt *Router) matchRootPath(path string) *config.ServiceConfig {
	for i := range rt.services {
		for _, rp := range rt.services[i].RootPaths {
			if strings.HasPrefix(path, rp) {
				return &rt.services[i]
			}
		}
	}
	return nil
}

// liftRootPath moves a declared root directory (see ServiceConfig.RootPaths)
// back to the root of the upstream path: "/settings/locales/en/common.json"
// -> "/locales/en/common.json". A frontend resolving a document-relative
// sub-resource URL against its current SPA route asks for the directory at
// whatever depth that route happens to have, and the backend only serves it
// at the root. The last occurrence wins, so a route segment that repeats the
// directory name can't strand the real one.
func liftRootPath(path string, rootPaths []string) string {
	for _, rp := range rootPaths {
		if i := strings.LastIndex(path, rp); i > 0 {
			return path[i:]
		}
	}
	return path
}

// isRewritableContentType reports whether a response body is text-based
// markup/style/script where a root-absolute "/assets/…" reference could
// plausibly appear and need rewriting. Deliberately excludes JSON/binary
// content types so API payloads and images are never touched.
func isRewritableContentType(contentType string) bool {
	ct := strings.ToLower(contentType)
	for _, prefix := range []string{"text/html", "text/css", "text/javascript", "application/javascript", "application/manifest+json"} {
		if strings.HasPrefix(ct, prefix) {
			return true
		}
	}
	return false
}

// rootPathFamilies are well-known root-absolute directories SPAs reference
// as literal strings — a Vite build's own asset imports ("/assets/…") and,
// separately, i18next-http-backend's default loadPath template
// ("/locales/{{lng}}/{{ns}}.json") are both plain string constants baked
// into the bundle, not runtime-computed like the WebSocket URL was. Add
// more here if another literal root reference turns up.
var rootPathFamilies = []string{"/assets/", "/locales/"}

// rewriteAssetPaths patches root-absolute references (see rootPathFamilies)
// emitted by SPAs that don't know they're mounted under a prefix (Vite-built
// frontends like Frigate's are the common case):
// "/assets/main.js" -> "/frigate/assets/main.js". Only rewrites occurrences
// preceded by a quote or CSS url() paren, so it can't mangle unrelated text
// that merely contains one of these substrings.
func rewriteAssetPaths(body []byte, prefix string) []byte {
	for _, family := range rootPathFamilies {
		replacement := []byte(prefix + family)
		for _, q := range []string{`"`, `'`, "`", "("} {
			delim := []byte(q + family)
			body = bytes.ReplaceAll(body, delim, append([]byte(q), replacement...))
		}
	}
	return body
}

// matchPrefix finds the first service whose Prefix the path starts with,
// among the services whose Hidden flag matches the one asked for.
func (rt *Router) matchPrefix(path string, hidden bool) *config.ServiceConfig {
	for i := range rt.services {
		if rt.services[i].Hidden == hidden && strings.HasPrefix(path, rt.services[i].Prefix) {
			return &rt.services[i]
		}
	}
	return nil
}

// RequireAuth middleware for protected routes.
func (rt *Router) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rt.sessions.ValidateSession(rt.sessions.GetSessionID(r)) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"forbidden"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NewContext returns a background context for the proxy.
func (rt *Router) NewContext() context.Context {
	return context.Background()
}
