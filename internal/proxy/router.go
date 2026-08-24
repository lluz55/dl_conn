package proxy

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"forbidden: authenticate at /auth"}`))
		return
	}

	// Route to service based on prefix
	svc := rt.matchService(r.URL.Path)
	if svc == nil {
		http.NotFound(w, r)
		return
	}

	proxy := rt.proxies[svc.ID]
	if proxy == nil {
		http.Error(w, "proxy not initialized", http.StatusInternalServerError)
		return
	}

	proxy.ServeHTTP(w, r)
}

// matchService finds the service matching the request path prefix.
func (rt *Router) matchService(path string) *config.ServiceConfig {
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
