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
	svcID := svc.ID
	proxy.Director = func(req *http.Request) {
		origDir(req)
		req.Header.Set("X-Forwarded-For", req.RemoteAddr)
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", req.Host)
		if stripPrefix {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, prefix)
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
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

// ServeHTTP routes requests through the Zero-Trust proxy.
func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /auth endpoint bypasses auth middleware
	if r.URL.Path == "/auth" || strings.HasPrefix(r.URL.Path, "/auth?") {
		return // handled by AuthHandler
	}

	// Static files and SPA shell
	if strings.HasPrefix(r.URL.Path, "/_static/") ||
		r.URL.Path == "/" || r.URL.Path == "/index.html" ||
		strings.HasPrefix(r.URL.Path, "/app.js") ||
		strings.HasPrefix(r.URL.Path, "/style.css") {
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

	proxy := rt.proxies[svc.ID]
	if proxy == nil {
		log.Printf("proxy not initialized: service=%s path=%q remote=%s",
			svc.ID, r.URL.Path, r.RemoteAddr)
		http.Error(w, "proxy not initialized", http.StatusInternalServerError)
		return
	}

	proxy.ServeHTTP(w, r)
}

// matchService finds the service matching the request path prefix. Proxied
// SPAs (Frigate, etc.) commonly emit root-absolute asset URLs ("/assets/…",
// "/main-*.js", "/favicon.ico") that have no idea they're mounted under a
// prefix like "/frigate" — the browser requests those at the origin root.
// When no prefix matches directly, fall back to the Referer header: if the
// page that issued the sub-resource request lives under a configured
// prefix, route the request to that same service.
func (rt *Router) matchService(r *http.Request) *config.ServiceConfig {
	if svc := rt.matchPrefix(r.URL.Path); svc != nil {
		return svc
	}
	if ref := r.Referer(); ref != "" {
		if refURL, err := url.Parse(ref); err == nil {
			return rt.matchPrefix(refURL.Path)
		}
	}
	return nil
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

// rewriteAssetPaths patches root-absolute "/assets/…" references emitted by
// SPAs that don't know they're mounted under a prefix (Vite-built frontends
// like Frigate's are the common case): "/assets/main.js" -> "/frigate/assets/main.js".
// Only rewrites occurrences preceded by a quote or CSS url() paren, so it
// can't mangle unrelated text that merely contains the substring "/assets/".
func rewriteAssetPaths(body []byte, prefix string) []byte {
	replacement := []byte(prefix + "/assets/")
	for _, delim := range [][]byte{[]byte(`"/assets/`), []byte(`'/assets/`), []byte("`/assets/"), []byte("(/assets/")} {
		quote := delim[:1]
		body = bytes.ReplaceAll(body, delim, append(append([]byte{}, quote...), replacement...))
	}
	return body
}

func (rt *Router) matchPrefix(path string) *config.ServiceConfig {
	for i := range rt.services {
		if strings.HasPrefix(path, rt.services[i].Prefix) {
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
