package sensors

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// NetworkSnapshot reports per-interface RX/TX byte counters and the
// delta-derived aggregate rate.
//
// TotalRxBytes / TotalTxBytes are cumulative since boot (mirroring /proc/net/dev
// semantics), so two readings of the same host at different times give
// monotonic integers and the rate is the delta divided by the elapsed wall
// clock.
//
// RxBps / TxBps are aggregate bytes-per-second across all counted interfaces.
// They are nil until the collector has a previous reading to subtract; a
// snapshot whose only sample has no rate is not a broken sensor, it is a
// freshly-started daemon.
//
// Ifaces is the per-interface breakdown exposed for the "qual interface está
// carregando" use case; summing Ifaces[*].RxBytes must equal TotalRxBytes.
//
// Loopback, virtual and discarded interfaces are filtered out of the
// aggregate so the rate reflects the actual link the host is serving on.
type NetworkSnapshot struct {
	TotalRxBytes uint64          `json:"total_rx_bytes"`
	TotalTxBytes uint64          `json:"total_tx_bytes"`
	RxBps        *float64        `json:"rx_bps,omitempty"`
	TxBps        *float64        `json:"tx_bps,omitempty"`
	Ifaces       []NetworkIface  `json:"ifaces,omitempty"`
	// SampledAt is the wall clock at which the byte counters were read.
	// It travels with the struct only so the collector can compute the
	// next delta — it is never serialized, because the snapshot itself
	// already carries its own SampledAt at the top level.
	SampledAt time.Time `json:"-"`
}

// NetworkIface is one entry from /proc/net/dev. Name is the kernel interface
// name ("eth0", "wlan0", "br-lan", …). The rest are the cumulative byte
// counters at sample time.
type NetworkIface struct {
	Name    string `json:"name"`
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

// ReadNetwork reads /proc/net/dev and returns the cumulative byte counters per
// physical interface. The aggregate rate is left nil here — it is the
// collector's job to compute it from two snapshots, the same way it does for
// GPU utilization (see collector.netPrev).
//
// Interfaces whose names start with "lo" are excluded from the aggregate
// because loopback traffic is between two sockets on the same host and does not
// reflect the link's saturation. Interfaces containing a colon (e.g. "eth0:1",
// "vethXYZ@if5") are aliases / virtual pairs and are filtered for the same
// reason: their counters alias the underlying device and counting them twice
// would inflate the rate.
//
// A malformed line, an unreadable /proc/net/dev or a file that only has the
// header rows returns (nil, nil): a snapshot without a network reading is the
// existing convention for "this host does not report it", not an error.
func ReadNetwork(procRoot string) (*NetworkSnapshot, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	f, err := os.Open(filepath.Join(procRoot, "net", "dev"))
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// /proc lines are short; the default 64 KiB token cap is more than enough.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var snap *NetworkSnapshot
	// ifaceNameRE matches the interface name column in /proc/net/dev:
	// a non-greedy run of printable characters terminated by the field
	// separator (a colon followed by whitespace and a digit). Using a
	// regex keeps the parser correct in the face of aliases like
	// "eth0:1" (whose name itself contains a colon) and veth peers like
	// "veth1234@if5" (whose name contains an at-sign). The previous
	// implementation split on the first colon, which mis-parsed both.
	var ifaceNameRE = regexp.MustCompile(`^\s*(?P<name>[\w@:.-]+):\s+\d`)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		// Skip the two header lines ("Inter-|   Receive ...", " face |bytes ...")
		// — neither starts with a printable interface name.
		m := ifaceNameRE.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		name := m[ifaceNameRE.SubexpIndex("name")]
		if shouldExcludeIface(name) {
			continue
		}
		// Slice the line at the separator colon so the field tokenizer
		// sees the standard /proc/net/dev payload (receive bytes first).
		colon := strings.Index(line, name+":")
		fields := strings.Fields(line[colon+len(name)+1:])
		// /proc/net/dev layout: receive bytes is field 0, transmit bytes is
		// field 8 (after packets/errs/drops/fifo/frame/compressed).
		if len(fields) < 9 {
			continue
		}
		rx, errRX := strconv.ParseUint(fields[0], 10, 64)
		tx, errTX := strconv.ParseUint(fields[8], 10, 64)
		if errRX != nil || errTX != nil {
			continue
		}
		if snap == nil {
			snap = &NetworkSnapshot{}
		}
		snap.TotalRxBytes += rx
		snap.TotalTxBytes += tx
		snap.Ifaces = append(snap.Ifaces, NetworkIface{Name: name, RxBytes: rx, TxBytes: tx})
	}
	if err := scanner.Err(); err != nil {
		return nil, nil
	}
	if snap == nil || len(snap.Ifaces) == 0 {
		return nil, nil
	}
	return snap, nil
}
// shouldExcludeIface filters interfaces whose counters either belong to
// loopback traffic, alias a real device, or belong to a virtual peer that
// only exists inside the host's own network namespace. All three add noise
// to the aggregate rate without telling the user anything about the host's
// real link.
func shouldExcludeIface(name string) bool {
	if name == "lo" || strings.HasPrefix(name, "lo:") {
		return true
	}
	// IP aliases like "eth0:1" — they alias the parent's byte counters and
	// counting them twice would inflate the aggregate.
	if strings.Contains(name, ":") {
		return true
	}
	// veth peers are written by the kernel as "veth<id>@if<idx>"; the
	// counters belong to traffic inside the host's namespaces (bridges,
	// containers, WireGuard) and are not a host link.
	if strings.Contains(name, "@") {
		return true
	}
	return false
}
