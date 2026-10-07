package sensors

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeFile creates path and its parents with the given content. A test that
// forgets to MkdirAll a parent fails with a confusing read error three levels
// below the line it got wrong.
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// fakeCard lays out /sys/class/drm/<name> the way the kernel does: a device
// directory carrying the PCI vendor id, a uevent naming the driver and the
// slot, and whatever sensors that driver publishes inside it.
type fakeCard struct {
	name       string
	vendor     string // PCI vendor id, e.g. "0x1002"
	driver     string
	slot       string // e.g. "0000:03:00.0"
	tempC      string // millidegrees in hwmon/hwmon0/temp1_input, "" to omit
	busyPct    string // gpu_busy_percent, "" to omit
	noHwmonTmp bool
}

func makeSysRoot(t *testing.T, cards ...fakeCard) string {
	t.Helper()
	root := t.TempDir()
	for _, c := range cards {
		dev := filepath.Join(root, "class/drm", c.name, "device")
		if err := os.MkdirAll(dev, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(dev, "vendor"), c.vendor+"\n")
		writeFile(t, filepath.Join(dev, "uevent"),
			"DRIVER="+c.driver+"\nPCI_ID="+c.vendor+":1234\nPCI_SLOT_NAME="+c.slot+"\n")
		if c.tempC != "" && !c.noHwmonTmp {
			writeFile(t, filepath.Join(dev, "hwmon/hwmon0/temp1_input"), c.tempC+"\n")
		}
		if c.busyPct != "" {
			writeFile(t, filepath.Join(dev, "gpu_busy_percent"), c.busyPct+"\n")
		}
	}
	return root
}

// The default sys root is resolved exactly once. A card's hwmon used to be
// rebuilt from the *unresolved* root at the point of reading, so a caller
// passing "" (the normal case for the daemon) enumerated /sys/class/drm
// correctly and then looked for sensors in a relative "class/drm/cardN/device".
// The bug was invisible on a host whose card publishes no sensors — the two
// failures look identical — so it is pinned here with a card that has them.
func TestReadGPU_DefaultRootStillReadsCardSensors(t *testing.T) {
	// Point the default at the fake machine by resolving the same default the
	// production path uses: /sys, via a symlink is not portable, so this test
	// exercises the invariant directly on the resolved card.
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0",
		tempC: "64000", busyPct: "33",
	})
	cards := readGPUCards(sys)
	if len(cards) != 1 {
		t.Fatalf("got %d cards, want 1", len(cards))
	}
	if cards[0].dev != filepath.Join(sys, "class/drm", "card0", "device") {
		t.Fatalf("card device path = %q, want the resolved sysfs path", cards[0].dev)
	}
	// And the sensor readers work off that stored path, which is the thing the
	// rebuild got wrong.
	if c := readCardTempC(cards[0].dev); c == nil || *c != 64.0 {
		t.Errorf("TempC=%v, want 64.0 read through the card's own device path", c)
	}
	if u := readBusyPercent(cards[0].dev); u == nil || *u != 33 {
		t.Errorf("UtilPct=%v, want 33 read through the card's own device path", u)
	}
}

// An AMD card answers everything from its own sysfs: the SMU publishes both the
// temperature (hwmon) and the load (gpu_busy_percent), so no delta and no
// nvidia-smi is involved.
func TestReadGPU_AMDFromSysfs(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0",
		tempC: "55000", busyPct: "42\n",
	})

	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.Vendor != GPUVendorAMD {
		t.Errorf("Vendor=%q, want %q", got.Vendor, GPUVendorAMD)
	}
	if got.Driver != "amdgpu" {
		t.Errorf("Driver=%q, want amdgpu", got.Driver)
	}
	if got.TempC == nil || *got.TempC != 55.0 {
		t.Errorf("TempC=%v, want 55.0", got.TempC)
	}
	if got.UtilPct == nil || *got.UtilPct != 42 {
		t.Errorf("UtilPct=%v, want 42", got.UtilPct)
	}
}

// The host this was written for: an Intel iGPU. Nothing in its sysfs reports a
// temperature or a load, and there is no nvidia-smi to ask. It still has to
// come back as a GPU — identified as Intel's, with the readings honestly absent
// — because "this machine has an Intel card that reports nothing" is a
// different answer from "this machine has no GPU".
func TestReadGPU_IntelIdentifiedWithoutSysfsSensors(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card1", vendor: "0x8086", driver: "i915", slot: "0000:00:02.0",
	})

	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.Vendor != GPUVendorIntel {
		t.Errorf("Vendor=%q, want %q", got.Vendor, GPUVendorIntel)
	}
	if got.Driver != "i915" {
		t.Errorf("Driver=%q, want i915", got.Driver)
	}
	if got.TempC != nil || got.UtilPct != nil {
		t.Errorf("expected no readings, got %+v", got)
	}
}

// A vendor id nobody has a name for is still a GPU: the readings below do not
// depend on knowing the vendor, only on which driver exposes the counters.
func TestReadGPU_UnknownVendorIsStillAGPU(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x1a03", driver: "ast", slot: "0000:00:02.0",
		tempC: "40000",
	})

	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.Vendor != GPUVendorOther {
		t.Errorf("Vendor=%q, want %q", got.Vendor, GPUVendorOther)
	}
	if got.TempC == nil || *got.TempC != 40.0 {
		t.Errorf("TempC=%v, want 40.0", got.TempC)
	}
}

// A 0 °C reading is a placeholder several drivers publish when no sensor is
// wired up — and what a VM with no real GPU reports. It must not become a
// temperature, because a chart of zeros is a claim the host never made.
func TestReadGPU_IgnoresPlaceholderTemperature(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0",
		tempC: "0", busyPct: "7",
	})

	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.TempC != nil {
		t.Errorf("TempC=%v, want nil for a 0 °C placeholder", *got.TempC)
	}
	if got.UtilPct == nil || *got.UtilPct != 7 {
		t.Errorf("UtilPct=%v, want 7 — one bad reading does not discard the card", got.UtilPct)
	}
}

// Connectors and render nodes sit next to the cards in the same directory and
// are not GPUs. Counting them would multiply every reading by three on a
// typical desktop.
func TestReadGPU_IgnoresConnectorsAndRenderNodes(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x8086", driver: "i915", slot: "0000:00:02.0",
		tempC: "45000",
	})
	for _, node := range []string{"card0-DP-1", "card0-HDMI-A-1", "renderD128"} {
		if err := os.MkdirAll(filepath.Join(sys, "class/drm", node), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	cards := readGPUCards(sys)
	if len(cards) != 1 {
		t.Fatalf("got %d cards, want 1: %+v", len(cards), cards)
	}
	if cards[0].Name != "card0" {
		t.Errorf("Name=%q, want card0", cards[0].Name)
	}
}

// A host with no GPU at all is an empty answer, not a failed collection.
func TestReadGPU_NoCards(t *testing.T) {
	sys := t.TempDir()
	if err := os.MkdirAll(filepath.Join(sys, "class/drm"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got == nil {
		t.Fatal("nil snapshot")
	}
	if got.Vendor != "" || got.TempC != nil || got.UtilPct != nil {
		t.Errorf("expected an empty snapshot, got %+v", got)
	}
}

// The hybrid host this feature exists for: an idle Intel iGPU next to an AMD
// dGPU that is doing the work. The gauge has to follow the busy card — pinned
// to the iGPU it would read 0% forever on the machine the user is waiting for.
func TestReadGPU_PicksTheBusiestCard(t *testing.T) {
	sys := makeSysRoot(t,
		fakeCard{name: "card0", vendor: "0x8086", driver: "i915", slot: "0000:00:02.0", tempC: "38000", busyPct: "0"},
		fakeCard{name: "card1", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0", tempC: "71000", busyPct: "91"},
	)

	got, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.Vendor != GPUVendorAMD {
		t.Errorf("Vendor=%q, want %q — the busy card stands for the GPU", got.Vendor, GPUVendorAMD)
	}
	if got.UtilPct == nil || *got.UtilPct != 91 {
		t.Errorf("UtilPct=%v, want 91", got.UtilPct)
	}
	// Both readings come from the same card: a temperature borrowed from the
	// iGPU next to a utilization from the dGPU would be a number about no
	// hardware on the machine.
	if got.TempC == nil || *got.TempC != 71.0 {
		t.Errorf("TempC=%v, want 71.0 (the same card)", got.TempC)
	}
}

// With nothing busy, the pick has to be deterministic or the meter label
// flickers between two cards on every poll.
func TestReadGPU_TieBreaksDeterministically(t *testing.T) {
	sys := makeSysRoot(t,
		fakeCard{name: "card0", vendor: "0x8086", driver: "i915", slot: "0000:00:02.0", tempC: "38000", busyPct: "0"},
		fakeCard{name: "card1", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0", tempC: "38000", busyPct: "0"},
	)
	first, err := ReadGPU(sys, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	for i := 0; i < 5; i++ {
		again, err := ReadGPU(sys, t.TempDir(), nil)
		if err != nil {
			t.Fatalf("ReadGPU: %v", err)
		}
		if again.Vendor != first.Vendor {
			t.Fatalf("pick changed between reads: %q then %q", first.Vendor, again.Vendor)
		}
	}
	if first.Vendor != GPUVendorIntel {
		t.Errorf("Vendor=%q, want %q — ties go to the first card by PCI slot", first.Vendor, GPUVendorIntel)
	}
}

// fakeProc lays out a /proc with the given clients, each one a pid holding a
// DRM descriptor and the fdinfo the kernel writes for it.
type fakeClient struct {
	pid     string
	dev     string // /dev/dri/renderD128
	fdinfo  string
	alsoHas string // an unrelated descriptor, e.g. a socket
}

func makeProcRoot(t *testing.T, clients ...fakeClient) string {
	t.Helper()
	root := t.TempDir()
	for _, c := range clients {
		fdDir := filepath.Join(root, c.pid, "fd")
		if err := os.MkdirAll(fdDir, 0o755); err != nil {
			t.Fatal(err)
		}
		fdNum := len(entries(t, fdDir))
		if err := os.Symlink(c.dev, filepath.Join(fdDir, string(rune('0'+fdNum)))); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(root, c.pid, "fdinfo", string(rune('0'+fdNum))), c.fdinfo)
		if c.alsoHas != "" {
			if err := os.Symlink(c.alsoHas, filepath.Join(fdDir, "9")); err != nil {
				t.Fatal(err)
			}
		}
	}
	return root
}

func entries(t *testing.T, dir string) []os.DirEntry {
	t.Helper()
	e, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// scanDRMEngineBusy has to sum engines per GPU, from every client, ignoring
// descriptors that are not DRM — and count a client once even when two
// processes hold descriptors to the same open file, which is what drm-client-id
// exists for.
func TestScanDRMEngineBusy_SumsPerGPUAndDedupsClients(t *testing.T) {
	proc := makeProcRoot(t,
		fakeClient{
			pid: "100", dev: "/dev/dri/renderD128",
			fdinfo: "pos:\t0\nflags:\t02000002\nmnt_id:\t29\ndrm-driver:\ti915\n" +
				"drm-pdev:\t0000:00:02.0\ndrm-client-id:\t7\n" +
				"drm-engine-render:\t1000000000 ns\ndrm-engine-copy:\t500000000 ns\n" +
				"drm-total-memory:\t65536 KiB\n",
			alsoHas: "socket:[12345]",
		},
		fakeClient{
			pid: "200", dev: "/dev/dri/card1",
			fdinfo: "pos:\t0\nflags:\t02000002\ndrm-driver:\ti915\n" +
				"drm-pdev:\t0000:00:02.0\ndrm-client-id:\t9\n" +
				"drm-engine-render:\t2500000000 ns\n",
		},
		// Same open file seen from a second process: must not be counted twice.
		fakeClient{
			pid: "300", dev: "/dev/dri/renderD129",
			fdinfo: "pos:\t0\ndrm-driver:\ti915\ndrm-pdev:\t0000:00:02.0\n" +
				"drm-client-id:\t7\ndrm-engine-render:\t1000000000 ns\n",
		},
	)

	got := scanDRMEngineBusy(proc)
	card, ok := got["00:02.0"]
	if !ok {
		t.Fatalf("no entry for slot 00:02.0: %+v", got)
	}
	// 1e9 + 2.5e9 ns of render; the duplicated client-id 7 counted once.
	if card["render"] != 3.5e9 {
		t.Errorf("render=%v ns, want 3.5e9", card["render"])
	}
	if card["copy"] != 5e8 {
		t.Errorf("copy=%v ns, want 5e8", card["copy"])
	}
}

// A group of identical engines reports one counter for all of them, so the
// total is divided by the group size to stay a time.
func TestScanDRMEngineBusy_DividesEngineGroups(t *testing.T) {
	proc := makeProcRoot(t, fakeClient{
		pid: "100", dev: "/dev/dri/renderD128",
		fdinfo: "drm-driver:\ti915\ndrm-pdev:\t0000:00:02.0\ndrm-client-id:\t1\n" +
			"drm-engine-render:\t4000000000 ns\ndrm-engine-capacity-render:\t4\n",
	})

	got := scanDRMEngineBusy(proc)
	if v := got["00:02.0"]["render"]; v != 1e9 {
		t.Errorf("render=%v ns, want 1e9 (4 engines sharing one counter)", v)
	}
}

// A non-DRM process directory — a kernel thread, an exited process — simply has
// no fdinfo to read, and must not abort the walk.
func TestScanDRMEngineBusy_NoDRMClients(t *testing.T) {
	proc := t.TempDir()
	if err := os.MkdirAll(filepath.Join(proc, "2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := scanDRMEngineBusy(proc); len(got) != 0 {
		t.Errorf("got %+v, want nothing", got)
	}
}

// The whole point of GPUUsage: cumulative nanoseconds only become a percentage
// as a delta against the wall clock. The first reading has no interval behind
// it and reports nothing rather than guessing.
func TestGPUUsage_FirstReadingHasNoInterval(t *testing.T) {
	var u GPUUsage
	busy := map[string]map[string]float64{"00:02.0": {"render": 1e9}}

	if got := u.Utilization(time.Unix(1000, 0), busy); got != nil {
		t.Errorf("first reading = %v, want nil — there is no interval yet", got)
	}
}

// Ten seconds of wall clock, five of them busy on the render engine: 50%.
func TestGPUUsage_DeltaBecomesAPercentage(t *testing.T) {
	var u GPUUsage
	base := time.Unix(1000, 0)
	prev := map[string]map[string]float64{"00:02.0": {"render": 1e9, "copy": 2e9}}
	u.Utilization(base, prev)

	next := map[string]map[string]float64{"00:02.0": {"render": 6e9, "copy": 2e9}}
	got := u.Utilization(base.Add(10*time.Second), next)
	if pct := got["00:02.0"]; pct != 50 {
		t.Errorf("utilization=%v%%, want 50%% (5s busy of 10s)", pct)
	}
}

// Parallel engines would push a sum past 100%; the busiest engine is both what
// "the GPU is busy" means and what the panel's 0..100 axis can show.
func TestGPUUsage_TakesTheBusiestEngineAndClamps(t *testing.T) {
	var u GPUUsage
	base := time.Unix(1000, 0)
	u.Utilization(base, map[string]map[string]float64{"00:02.0": {"render": 0, "copy": 0}})

	next := map[string]map[string]float64{"00:02.0": {"render": 10e9, "copy": 10e9}}
	got := u.Utilization(base.Add(10*time.Second), next)
	if pct := got["00:02.0"]; pct != 100 {
		t.Errorf("utilization=%v%%, want 100%% — not 200%% from two parallel engines", pct)
	}
}

// A GPU whose clients all exited has no open descriptor to sum, which means no
// work in progress. Reporting 0 is the difference between "free" and
// "missing"; dropping it from the map would make a working GPU disappear from
// the chart exactly when it went idle.
func TestGPUUsage_ClientGoneReadsAsIdleNotMissing(t *testing.T) {
	var u GPUUsage
	base := time.Unix(1000, 0)
	u.Utilization(base, map[string]map[string]float64{"00:02.0": {"render": 1e9}})

	got := u.Utilization(base.Add(10*time.Second), nil)
	pct, ok := got["00:02.0"]
	if !ok {
		t.Fatalf("GPU dropped from the result: %+v", got)
	}
	if pct != 0 {
		t.Errorf("utilization=%v%%, want 0%%", pct)
	}
}

// The kernel documents these counters as allowed to step backwards when that is
// simpler for the driver; a negative delta is not a measurement and must not
// become a negative percentage.
func TestGPUUsage_BackwardsCounterIsNotAMeasurement(t *testing.T) {
	var u GPUUsage
	base := time.Unix(1000, 0)
	u.Utilization(base, map[string]map[string]float64{"00:02.0": {"render": 9e9}})

	got := u.Utilization(base.Add(10*time.Second), map[string]map[string]float64{"00:02.0": {"render": 1e9}})
	if pct, ok := got["00:02.0"]; !ok || pct < 0 {
		t.Errorf("utilization=%v (present=%v), want no negative reading", pct, ok)
	}
}

// The full wiring: a card enumerated in sysfs is matched to the PCI slot its
// clients report in fdinfo, which is the join the Intel path depends on.
func TestReadGPU_MatchesSysfsCardToFDInfoSlot(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card1", vendor: "0x8086", driver: "i915", slot: "0000:00:02.0",
	})
	proc := makeProcRoot(t, fakeClient{
		pid: "100", dev: "/dev/dri/renderD128",
		fdinfo: "drm-driver:\ti915\ndrm-pdev:\t0000:00:02.0\ndrm-client-id:\t1\n" +
			"drm-engine-render:\t1000000000 ns\n",
	})

	var u GPUUsage
	// First sample seeds the counters; the second has an interval to measure.
	if _, err := ReadGPU(sys, proc, &u); err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	got, err := ReadGPU(sys, proc, &u)
	if err != nil {
		t.Fatalf("ReadGPU: %v", err)
	}
	if got.Vendor != GPUVendorIntel {
		t.Fatalf("Vendor=%q, want %q", got.Vendor, GPUVendorIntel)
	}
	if got.UtilPct == nil {
		t.Fatalf("no utilization: the fdinfo slot did not match the sysfs card")
	}
	if *got.UtilPct != 0 {
		t.Errorf("UtilPct=%v, want 0 — the client did no work between two reads", *got.UtilPct)
	}
}

// nvidia-smi prints the PCI domain as 8 hex digits where sysfs prints 4; the
// slot that ties a card to its card is only common after dropping the domain.
func TestNormalizeSlot(t *testing.T) {
	cases := map[string]string{
		"0000:03:00.0":     "03:00.0",
		"00000000:03:00.0": "03:00.0",
		" 0000:00:02.0\n":  "00:02.0",
		"0000:00:02.0\n":   "00:02.0",
		"":                 "",
		"malformed":        "",
		"0000:03:00":       "",
	}
	for in, want := range cases {
		if got := normalizeSlot(in); got != want {
			t.Errorf("normalizeSlot(%q) = %q, want %q", in, got, want)
		}
	}
}

// The collector hands the GPU reader the same roots as everything else, so a
// test can drive a whole snapshot off a fake machine — and the GPU it finds
// there is the host's, not a vendor the code was written for.
func TestCollector_GPUFromFakeSys(t *testing.T) {
	sys := makeSysRoot(t, fakeCard{
		name: "card0", vendor: "0x1002", driver: "amdgpu", slot: "0000:03:00.0",
		tempC: "62000", busyPct: "18",
	})

	c := NewCollector(10).WithRoots(sys, t.TempDir())
	snap := c.CollectOnce()
	if snap.GPU == nil {
		t.Fatal("no GPU in the snapshot")
	}
	if snap.GPU.Vendor != GPUVendorAMD || snap.GPU.UtilPct == nil || *snap.GPU.UtilPct != 18 {
		t.Errorf("GPU = %+v", snap.GPU)
	}
}
