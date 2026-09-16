package proxy

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	"dl_conn/internal/auth"
)

const dynamicPortPrefix = "/local/"

// DynamicPortProxy exposes authenticated HTTP services bound to host loopback
// as /local/<port>/. It never accepts a caller-controlled host, so it cannot
// be used to pivot into the LAN or the public network.
type DynamicPortProxy struct {
	sessions *auth.SessionManager
	denied   map[int]struct{}
}

// NewDynamicPortProxy builds the loopback-only dynamic proxy. listenPort and
// its adjacent diagnostics port are always denied, in addition to privileged
// ports and the operator denylist.
func NewDynamicPortProxy(sessions *auth.SessionManager, listenPort int, deniedPorts []int) *DynamicPortProxy {
	denied := make(map[int]struct{}, len(deniedPorts)+2)
	for _, port := range deniedPorts {
		denied[port] = struct{}{}
	}
	denied[listenPort] = struct{}{}
	if listenPort < 65535 {
		denied[listenPort+1] = struct{}{}
	}
	return &DynamicPortProxy{sessions: sessions, denied: denied}
}

func (p *DynamicPortProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if p.sessions == nil || !p.sessions.ValidateSession(r) {
		writeDynamicPortError(w, http.StatusForbidden, "forbidden: authenticate at /auth")
		return
	}
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		writeDynamicPortError(w, http.StatusBadRequest, "websocket upgrades are not supported")
		return
	}

	port, upstreamPath, ok := parseDynamicPortPath(r.URL.Path)
	if !ok {
		writeDynamicPortError(w, http.StatusNotFound, "invalid local service path")
		return
	}
	if port < 1024 {
		writeDynamicPortError(w, http.StatusForbidden, "local port is denied")
		return
	}
	if _, denied := p.denied[port]; denied {
		writeDynamicPortError(w, http.StatusForbidden, "local port is denied")
		return
	}

	target, _ := url.Parse("http://127.0.0.1:" + strconv.Itoa(port))
	proxy := &httputil.ReverseProxy{}
	proxy.Rewrite = func(req *httputil.ProxyRequest) {
		req.SetURL(target)
		req.Out.URL.Path = upstreamPath
		req.Out.Host = target.Host
		req.Out.Header.Set("Host", target.Host)
		req.Out.Header.Set("X-Forwarded-Proto", "https")
		req.Out.Header.Set("X-Ingress-Path", dynamicPortPrefix+strconv.Itoa(port))
		req.Out.Header.Del("Origin")
		req.Out.Header.Del("Sec-Fetch-Site")
		req.SetXForwarded()

		// Proxy authentication and configured-service credentials belong to
		// dl_conn, not to an arbitrary process selected by port. GetSessionID
		// accepts "Authorization: Bearer <sessionID>" as an alternative to the
		// session cookie (see internal/auth/session.go), so a caller who
		// authenticated that way would otherwise have dl_conn's own live
		// session ID forwarded verbatim to the loopback backend, which could
		// replay it against dl_conn's protected routes.
		req.Out.Header.Del("Authorization")
		cookies := req.Out.Cookies()
		req.Out.Header.Del("Cookie")
		for _, cookie := range cookies {
			if cookie.Name == "dl_conn_session" || cookie.Name == serviceCookieName ||
				strings.HasPrefix(cookie.Name, "dsh-auth-") ||
				strings.HasPrefix(cookie.Name, "dl_conn_launch_") {
				continue
			}
			req.Out.AddCookie(cookie)
		}
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		relocateRedirect(resp, dynamicPortPrefix+strconv.Itoa(port))
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		log.Printf("dynamic proxy error: port=%d path=%q remote=%s reason=%v", port, req.URL.Path, req.RemoteAddr, err)
		writeDynamicPortError(w, http.StatusBadGateway, "upstream service unavailable")
	}
	proxy.ServeHTTP(w, r)
}

func parseDynamicPortPath(path string) (port int, upstreamPath string, ok bool) {
	if !strings.HasPrefix(path, dynamicPortPrefix) {
		return 0, "", false
	}
	rest := strings.TrimPrefix(path, dynamicPortPrefix)
	portPart, suffix, found := strings.Cut(rest, "/")
	if !found || portPart == "" {
		return 0, "", false
	}
	port, err := strconv.Atoi(portPart)
	if err != nil || port < 1 || port > 65535 {
		return 0, "", false
	}
	return port, "/" + suffix, true
}

func writeDynamicPortError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":%q}`, message)
}
