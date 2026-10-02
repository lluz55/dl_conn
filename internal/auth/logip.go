package auth

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

// redactedIP is what the log carries when the operator asked for no address
// at all.
const redactedIP = "[redacted]"

// Anonymize reduces a client address to something safe to ship to a log
// aggregator while still being useful for reading a single session's history.
//
// IPv4 keeps its network part and loses the host part ("10.0.66.*"): the
// /24 is what identifies the network a client sits on, which is the part an
// operator correlates on, and it is far too coarse to locate a person.
// IPv6 keeps the first 48 bits, which is the routing prefix a site is
// assigned ("2001:db8:1234:*") — the remaining 80 bits are the subnet id and
// interface id, i.e. the identifying part. Anything unparseable is passed
// through unchanged: it cannot have come from net/http's own addressing, and
// echoing it back is more useful than hiding a string that never held an
// address in the first place.
func Anonymize(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return ""
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.*", v4[0], v4[1], v4[2])
	}
	// The first three 16-bit groups, formatted by hand rather than by masking
	// a net.IP: the canonical form collapses those groups into "::" when they
	// are all zero, which would render a loopback address indistinguishably
	// from a truncated one.
	v6 := parsed.To16()
	if v6 == nil {
		return ip
	}
	// Offsets are in bytes: group n of a v6 address starts at byte 2n.
	return fmt.Sprintf("%x:%x:%x:*", be16(v6, 0), be16(v6, 2), be16(v6, 4))
}

// be16 reads the 16-bit group starting at offset.
func be16(b []byte, offset int) uint16 {
	return uint16(b[offset])<<8 | uint16(b[offset+1])
}

// logIP renders a client address for the daemon log under the operator's
// configured policy. Anonymization is the default: the value is useful for
// correlating one client's requests and useless as a location. A caller that
// wants no address in the log at all gets a fixed marker instead, which stays
// greppable in a way an empty field does not.
func (sm *SessionManager) logIP(ip string) string {
	if !sm.anonymizeLogs {
		return redactedIP
	}
	return Anonymize(ip)
}

// logRequestIP is logIP for a live request.
func (sm *SessionManager) logRequestIP(r *http.Request) string {
	return sm.logIP(ClientIP(r))
}

// IPForLog renders r's client address under this manager's log policy. Exported
// so the proxy and telemetry handlers log addresses under the same policy the
// auth package applies to its own decisions, rather than each re-deriving it.
func (sm *SessionManager) IPForLog(r *http.Request) string {
	return sm.logRequestIP(r)
}
