package sensors

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		// Skip the two header lines ("Inter-|   Receive ...", " face |bytes ...")
		// — neither starts with a printable interface name.
		if !strings.Contains(line, ":") {
			continue
		}
		colon := strings.Index(line, ":")
		name := strings.TrimSpace(line[:colon])
		if name == "" {
			continue
		}
		if shouldExcludeIface(name) {
			continue
		}
		fields := strings.Fields(line[colon+1:])
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
// loopback traffic or alias a real device. Both add noise to the aggregate
// rate without telling the user anything about the host's real link.
func shouldExcludeIface(name string) bool {
	if name == "lo" || strings.HasPrefix(name, "lo:") {
		return true
	}
	// Aliases (eth0:1) and veth peers (vethXYZ@if5) — both have a colon in
	// the name and report the same physical traffic as the parent.
	if strings.Contains(name, ":") {
		return true
	}
	return false
}