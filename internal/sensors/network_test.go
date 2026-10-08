package sensors

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeProcNetDev writes a minimal /proc/net/dev into a temp root and returns
// the root path. Two header rows precede the data so the parser can skip them.
func fakeProcNetDev(t *testing.T, lines string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "net"), 0o755); err != nil {
		t.Fatalf("mkdir net: %v", err)
	}
	body := "Inter-|   Receive                                                |  Transmit\n" +
		" face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n" +
		lines
	if err := os.WriteFile(filepath.Join(root, "net", "dev"), []byte(body), 0o644); err != nil {
		t.Fatalf("write dev: %v", err)
	}
	return root
}

func TestReadNetwork_BasicParse(t *testing.T) {
	root := fakeProcNetDev(t,
		"  eth0: 1000    10    0    0    0     0          0         0  2000    20    0    0    0     0       0          0\n"+
			"  wlan0: 500     5    0    0    0     0          0         0  1500    15    0    0    0     0       0          0\n",
	)
	snap, err := ReadNetwork(root)
	if err != nil {
		t.Fatalf("ReadNetwork: unexpected err: %v", err)
	}
	if snap == nil {
		t.Fatal("ReadNetwork: nil snapshot for valid /proc/net/dev")
	}
	if snap.TotalRxBytes != 1500 || snap.TotalTxBytes != 3500 {
		t.Fatalf("aggregate: got rx=%d tx=%d, want rx=1500 tx=3500", snap.TotalRxBytes, snap.TotalTxBytes)
	}
	if len(snap.Ifaces) != 2 {
		t.Fatalf("ifaces: got %d, want 2", len(snap.Ifaces))
	}
	if snap.Ifaces[0].Name != "eth0" || snap.Ifaces[0].RxBytes != 1000 || snap.Ifaces[0].TxBytes != 2000 {
		t.Fatalf("eth0 entry: got %+v", snap.Ifaces[0])
	}
	if snap.RxBps != nil || snap.TxBps != nil {
		t.Fatalf("rates must be nil when only one sample exists: got rx=%v tx=%v", snap.RxBps, snap.TxBps)
	}
}

func TestReadNetwork_FiltersLoopbackAndAliases(t *testing.T) {
	root := fakeProcNetDev(t,
		"    lo: 9999    99    0    0    0     0          0         0  9999    99    0    0    0     0       0          0\n"+
			"  eth0: 1000    10    0    0    0     0          0         0  2000    20    0    0    0     0       0          0\n"+
			"eth0:1: 500     5    0    0    0     0          0         0   500     5    0    0    0     0       0          0\n"+
			"veth1234@if5: 800 8 0 0 0 0 0 0 400 4 0 0 0 0 0 0\n",
	)
	snap, err := ReadNetwork(root)
	if err != nil {
		t.Fatalf("ReadNetwork: %v", err)
	}
	if snap == nil {
		t.Fatal("snapshot should not be nil when a real interface exists")
	}
	// Only eth0 should be counted: lo and the alias/veth are filtered.
	if snap.TotalRxBytes != 1000 || snap.TotalTxBytes != 2000 {
		t.Fatalf("aggregate after filter: rx=%d tx=%d, want rx=1000 tx=2000", snap.TotalRxBytes, snap.TotalTxBytes)
	}
	if len(snap.Ifaces) != 1 || snap.Ifaces[0].Name != "eth0" {
		t.Fatalf("ifaces: got %+v, want only eth0", snap.Ifaces)
	}
}

func TestReadNetwork_EmptyAndMalformed(t *testing.T) {
	// Header only — no interface rows.
	root := fakeProcNetDev(t, "")
	snap, err := ReadNetwork(root)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil snapshot when only headers exist, got %+v", snap)
	}

	// A short line (fewer than 9 fields after the colon) is skipped, not fatal.
	root = fakeProcNetDev(t, "  eth0: 1 2 3\n")
	snap, err = ReadNetwork(root)
	if err != nil {
		t.Fatalf("err on short line: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil for malformed-only input, got %+v", snap)
	}

	// Missing file == "host does not report it", not an error.
	noFile := t.TempDir()
	snap, err = ReadNetwork(noFile)
	if err != nil {
		t.Fatalf("err on missing /proc/net/dev: %v", err)
	}
	if snap != nil {
		t.Fatalf("expected nil for missing file, got %+v", snap)
	}
}

// TestNetworkRate_DeltaAcrossSamples exercises the collector's netPrev
// bookkeeping by hand: two snapshots at different total counters, different
// sampled_at times, must produce rates equal to delta-bytes / delta-seconds.
func TestNetworkRate_DeltaAcrossSamples(t *testing.T) {
	root := fakeProcNetDev(t,
		"  eth0: 1000    10    0    0    0     0          0         0  2000    20    0    0    0     0       0          0\n",
	)
	c := NewCollector(time.Second)
	c.WithRoots("", root)

	first := c.CollectOnce()
	prev := first.Network
	if prev == nil {
		t.Fatal("first snapshot must carry a network reading")
	}
	if prev.RxBps != nil || prev.TxBps != nil {
		t.Fatalf("first sample: rates must be nil, got rx=%v tx=%v", prev.RxBps, prev.TxBps)
	}

	// Mutate the file so the second reading sees higher counters. The file
	// rewrite simulates one second of traffic.
	if err := os.WriteFile(filepath.Join(root, "net", "dev"), []byte(
		"Inter-|   Receive                                                |  Transmit\n"+
			" face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"+
			"  eth0: 5000    50    0    0    0     0          0         0  8000    80    0    0    0     0       0          0\n",
	), 0o644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	// Force a second-sample timestamp one second after the first so the rate
	// is unambiguous and not "almost zero because of clock skew".
	c.latest.SampledAt = c.latest.SampledAt.Add(-time.Second)
	second := c.CollectOnce()
	if second.Network == nil {
		t.Fatal("second snapshot must carry a network reading")
	}
	if second.Network.RxBps == nil || second.Network.TxBps == nil {
		t.Fatalf("second sample: rates must be set, got rx=%v tx=%v", second.Network.RxBps, second.Network.TxBps)
	}
	// 4000 RX bytes and 6000 TX bytes over a 2-second wall clock = 2000/3000 Bps.
	if got := *second.Network.RxBps; got != 2000 {
		t.Errorf("rx_bps: got %v, want 2000", got)
	}
	if got := *second.Network.TxBps; got != 3000 {
		t.Errorf("tx_bps: got %v, want 3000", got)
	}
}

// silence unused-import lint when only some tests run.
var _ = bufio.NewScanner
var _ = strings.TrimSpace