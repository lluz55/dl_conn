package sensors

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Vendor codes published as the snapshot's `gpu.vendor`. They are stable and
// machine-readable on purpose: the frontend names the chip in the user's
// language (see docs/okf/concepts/i18n.md) instead of the daemon shipping a
// translated string over the wire.
const (
	GPUVendorAMD    = "amd"
	GPUVendorIntel  = "intel"
	GPUVendorNVIDIA = "nvidia"
	GPUVendorOther  = "other"
)

// pciVendorCodes maps the PCI vendor id the kernel publishes in
// /sys/class/drm/cardN/device/vendor to a vendor code. Anything missing from
// the table is GPUVendorOther: the reading below does not depend on knowing
// the vendor, only on which drivers expose the counters.
var pciVendorCodes = map[string]string{
	"0x1002": GPUVendorAMD,
	"0x1022": GPUVendorAMD,
	"0x10de": GPUVendorNVIDIA,
	"0x8086": GPUVendorIntel,
}

// gpuCard is one DRM card, keyed by the PCI slot the kernel bound it to.
//
// The slot is the identity that ties the three sources together: sysfs names
// the card by directory, DRM fdinfo names it by `drm-pdev`, and nvidia-smi
// names it by `pci.bus_id`. Only the slot appears in all three.
type gpuCard struct {
	Name    string // "card0"
	Slot    string // "03:00.0", or Name when the card is not on PCI
	Vendor  string
	Driver  string
	TempC   *float64
	UtilPct *float64

	// dev is the card's device directory, resolved where the sys root was
	// already resolved. Recomputing it from the root at each use would mean
	// resolving that default twice, and the two answers could disagree.
	dev string
}

// gpuReading is what nvidia-smi reports for one card.
type gpuReading struct {
	temp *float64
	util *float64
}

// ReadGPU reports the host's GPU: whichever card the kernel enumerated, by
// whichever driver is bound to it. Which card that is comes from
// /sys/class/drm/card*, so it is the host's own answer — amdgpu, i915, xe,
// nouveau, nvidia or a vendor nobody has a name for — rather than an
// assumption that the machine has an NVIDIA one.
//
// Three sources are consulted per card, cheapest and most specific first:
//
//   - the card's own sysfs: hwmon temperature (amdgpu, nouveau, the open
//     NVIDIA driver) and `gpu_busy_percent`, the SMU's own load number that
//     amdgpu publishes;
//   - DRM client usage stats, the cumulative per-engine busy counters every
//     DRM driver publishes in /proc/<pid>/fdinfo. This is the only utilization
//     source that works on an Intel card, where nothing in sysfs reports load;
//   - nvidia-smi, kept for the proprietary NVIDIA driver, which is both more
//     accurate than a delta of raw engine counters and the only source on a
//     card whose hwmon the closed driver does not publish.
//
// `usage` holds the cross-sample state the engine counters need. Pass the same
// one on every call; pass nil to skip that source. A fresh GPUUsage reports no
// utilization on its first reading, because a cumulative counter with no
// previous reading has no interval behind it — that first sample is unknown,
// not zero.
//
// Returns an empty snapshot (no error) when the host exposes no DRM card: a
// machine without a GPU is not a collection failure.
func ReadGPU(sysRoot, procRoot string, usage *GPUUsage) (*GPUSnapshot, error) {
	cards := readGPUCards(sysRoot)
	if len(cards) == 0 {
		return &GPUSnapshot{}, nil
	}

	// Only shells out when the host actually has an NVIDIA card to ask about.
	var smi map[string]gpuReading
	for _, c := range cards {
		if c.Vendor != GPUVendorNVIDIA {
			continue
		}
		smi = readNvidia()
		break
	}

	var enginePct map[string]float64
	if usage != nil {
		enginePct = usage.Utilization(time.Now(), scanDRMEngineBusy(procRoot))
	}

	for i := range cards {
		cards[i].TempC = readCardTempC(cards[i].dev)
		cards[i].UtilPct = readBusyPercent(cards[i].dev)
		if cards[i].UtilPct == nil {
			if pct, ok := enginePct[cards[i].Slot]; ok {
				cards[i].UtilPct = &pct
			}
		}
		// nvidia-smi outranks both: it aggregates the engines itself, so on a
		// NVIDIA card it is the better answer wherever it answers at all.
		if r, ok := smi[cards[i].Slot]; ok {
			if r.util != nil {
				cards[i].UtilPct = r.util
			}
			if r.temp != nil {
				cards[i].TempC = r.temp
			}
		}
	}

	primary := primaryCard(cards)
	if primary == nil {
		return &GPUSnapshot{}, nil
	}
	snap := &GPUSnapshot{
		Vendor:  primary.Vendor,
		Driver:  primary.Driver,
		TempC:   primary.TempC,
		UtilPct: primary.UtilPct,
	}
	return snap, nil
}

// readGPUCards enumerates the DRM cards the kernel bound, ordered by PCI slot
// so the enumeration order does not depend on directory order.
func readGPUCards(sysRoot string) []gpuCard {
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	entries, err := os.ReadDir(filepath.Join(sysRoot, "class/drm"))
	if err != nil {
		return nil
	}
	var cards []gpuCard
	for _, e := range entries {
		name := e.Name()
		// "card0" is a GPU node; "card0-DP-1" and "card0-HDMI-A-1" are
		// connectors and "renderD128" is a render node — neither is a card.
		if !strings.HasPrefix(name, "card") || strings.Contains(name, "-") {
			continue
		}
		if _, err := strconv.Atoi(strings.TrimPrefix(name, "card")); err != nil {
			continue
		}
		dev := filepath.Join(sysRoot, "class/drm", name, "device")
		if _, err := os.Stat(dev); err != nil {
			// No PCI device behind the node: a virtual or platform card that
			// still reports through sysfs, just not one we can key by slot.
			if _, err := os.Stat(filepath.Join(sysRoot, "class/drm", name)); err != nil {
				continue
			}
		}
		card := gpuCard{
			Name:   name,
			Vendor: readCardVendor(dev),
			Driver: readUeventField(dev, "DRIVER"),
			dev:    dev,
		}
		card.Slot = readCardSlot(dev)
		if card.Slot == "" {
			card.Slot = name
		}
		cards = append(cards, card)
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].Slot < cards[j].Slot })
	return cards
}

// readCardSlot returns the PCI slot behind a card, reduced to bus:device.function.
func readCardSlot(dev string) string {
	return normalizeSlot(readUeventField(dev, "PCI_SLOT_NAME"))
}

// normalizeSlot reduces a PCI address to bus:device.function by dropping the
// domain. The three sources that name a GPU disagree on the domain width —
// uevent prints 0000:03:00.0, nvidia-smi prints 00000000:03:00.0, DRM fdinfo
// prints 0000:03:00.0 — and only the tail is common to all three.
func normalizeSlot(raw string) string {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) != 3 {
		return ""
	}
	bus, dev := strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2])
	if bus == "" || !strings.Contains(dev, ".") {
		return ""
	}
	return strings.ToLower(bus + ":" + dev)
}

// readCardVendor maps the PCI vendor id to a vendor code, falling back to
// "other" for an id we have no name for — the readings do not need it.
func readCardVendor(dev string) string {
	b, err := os.ReadFile(filepath.Join(dev, "vendor"))
	if err != nil {
		return GPUVendorOther
	}
	if v, ok := pciVendorCodes[strings.ToLower(strings.TrimSpace(string(b)))]; ok {
		return v
	}
	return GPUVendorOther
}

// readUeventField returns one KEY=value field from the device's uevent file.
func readUeventField(dev, key string) string {
	b, err := os.ReadFile(filepath.Join(dev, "uevent"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), key+"="); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// readCardTempC reads the card's own hwmon. amdgpu publishes the on-die sensor
// as temp1_input in millidegrees (docs.kernel.org/gpu/amdgpu/thermal.html), and
// nouveau and the open NVIDIA driver use the same layout. An Intel iGPU
// usually has no GPU hwmon at all, which is a fact about the host rather than
// a failure to read.
func readCardTempC(dev string) *float64 {
	hwmon := filepath.Join(dev, "hwmon")
	entries, err := os.ReadDir(hwmon)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "hwmon") {
			continue
		}
		for i := 1; i <= 3; i++ {
			milli, ok := readFloat(filepath.Join(hwmon, e.Name(), "temp"+strconv.Itoa(i)+"_input"))
			if !ok {
				continue
			}
			c := milli / 1000.0
			// Several drivers publish 0 (or a negative placeholder) when the
			// sensor is not wired up, and a VM with no real GPU reports the
			// same. Neither is a temperature.
			if c <= 0 || c > 150 {
				continue
			}
			return &c
		}
	}
	return nil
}

// readBusyPercent reads amdgpu's own load counter, a percentage computed by the
// SMU from the aggregate activity of the IP cores. Cheap, instantaneous, and
// the best answer where it exists — but only amdgpu publishes it.
func readBusyPercent(dev string) *float64 {
	pct, ok := readFloat(filepath.Join(dev, "gpu_busy_percent"))
	if !ok {
		return nil
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return &pct
}

// primaryCard picks the card a single "GPU" gauge stands for: the busiest,
// then the hottest, then the first by PCI slot.
//
// Busiest wins because the common hybrid host — an Intel iGPU alongside an
// NVIDIA dGPU — has no single GPU to report, and the interesting one is
// whichever is working. Pinning the gauge to a fixed card reads 0% forever on
// the one the user is waiting for. The tie-breaks exist to keep the choice
// deterministic, so two consecutive samples of a quiet host come from the same
// card instead of flickering between the two.
//
// A host whose GPU exposes neither a temperature nor a utilization still gets
// an answer — its vendor, with both readings absent. "This machine has an
// Intel card that reports nothing" and "this machine has no GPU" are different
// facts, and the panel has to be able to tell the user which one it is.
func primaryCard(cards []gpuCard) *gpuCard {
	var best *gpuCard
	for i := range cards {
		c := cards[i]
		if c.TempC == nil && c.UtilPct == nil {
			continue
		}
		if best == nil {
			best = &cards[i]
			continue
		}
		if c.UtilPct != nil && (best.UtilPct == nil || *c.UtilPct > *best.UtilPct) {
			best = &cards[i]
			continue
		}
		if c.UtilPct != nil && best.UtilPct != nil && *c.UtilPct < *best.UtilPct {
			continue
		}
		if c.TempC != nil && (best.TempC == nil || *c.TempC > *best.TempC) {
			best = &cards[i]
		}
	}
	if best != nil {
		return best
	}
	if len(cards) > 0 {
		return &cards[0]
	}
	return nil
}

// readNvidia asks nvidia-smi for every card it knows, keyed by PCI slot. A nil
// map means nvidia-smi is absent or failing, and the card's sysfs and DRM
// counters then carry the reading on their own.
//
// Kept because the proprietary driver exposes no hwmon on most kernels, and
// because a percentage nvidia-smi computes itself beats a delta taken from raw
// per-engine nanoseconds. A row it will not name is dropped rather than guessed
// onto a card: attributing one card's temperature to another is the one mistake
// this file exists to avoid.
func readNvidia() map[string]gpuReading {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nvidia-smi",
		"--query-gpu=pci.bus_id,temperature.gpu,utilization.gpu",
		"--format=csv,noheader,nounits")
	out, err := cmd.Output()
	if err != nil {
		return nil // not available, not an error
	}
	bySlot := map[string]gpuReading{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.Split(strings.TrimSpace(line), ",")
		if len(parts) < 3 {
			continue
		}
		slot := normalizeSlot(parts[0])
		if slot == "" {
			continue
		}
		r := gpuReading{}
		if f, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
			r.temp = &f
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64); err == nil {
			r.util = &f
		}
		if r.temp != nil || r.util != nil {
			bySlot[slot] = r
		}
	}
	if len(bySlot) == 0 {
		return nil
	}
	return bySlot
}

// GPUUsage turns the cumulative DRM engine counters into a percentage of time
// spent busy. The counters only mean anything as a delta against the wall
// clock between two readings, so it remembers the previous one; the type is
// safe for the collector's single writer and is passed explicitly so a test can
// drive it with its own clock.
type GPUUsage struct {
	mu   sync.Mutex
	at   time.Time
	busy map[string]map[string]float64
}

// Utilization returns, per GPU, the busiest engine's share of the interval
// since the previous call.
//
// The maximum rather than the sum: render, copy and video engines run in
// parallel, so summing them produces a number above 100% that has to be
// clamped away anyway, while the busiest engine is both what a user means by
// "the GPU is busy" and what fits the panel's 0..100 axis.
//
// The first call after a restart returns nothing: there is no interval yet. A
// GPU whose clients all went away reports 0 rather than disappearing, because
// no open DRM client means no GPU work — the difference between "free" and
// "missing".
func (u *GPUUsage) Utilization(now time.Time, current map[string]map[string]float64) map[string]float64 {
	u.mu.Lock()
	defer u.mu.Unlock()
	prev, prevAt := u.busy, u.at
	u.busy, u.at = current, now
	if prevAt.IsZero() {
		return nil
	}
	elapsed := now.Sub(prevAt).Nanoseconds()
	if elapsed <= 0 {
		return nil
	}
	pct := make(map[string]float64, len(current))
	for slot, engines := range current {
		best, measured := 0.0, false
		for name, busy := range engines {
			before, known := prev[slot][name]
			if !known {
				// A client that appeared since the last reading has no
				// baseline, so nothing about its share is known yet.
				continue
			}
			// The kernel documents these counters as allowed to step
			// backwards when that is simpler for the driver; a negative delta
			// is not a measurement.
			if d := busy - before; d > 0 {
				if p := float64(d) / float64(elapsed) * 100; p > best {
					best = p
				}
				measured = true
			}
		}
		if !measured {
			continue
		}
		if best > 100 {
			best = 100
		}
		pct[slot] = best
	}
	for slot := range prev {
		if _, ok := pct[slot]; !ok {
			pct[slot] = 0
		}
	}
	return pct
}

// scanDRMEngineBusy walks /proc once and sums, per GPU and per engine, how long
// the machine's clients have left their engines running. This is the one
// utilization source every DRM driver agrees on: the kernel documents
// `drm-engine-<name>` as cumulative nanoseconds of busy time in fdinfo, with no
// vendor in the picture (docs.kernel.org/gpu/drm-usage-stats.html).
//
// Only descriptors the cheap readlink identifies as DRM are opened and parsed,
// so the cost is one readlink per descriptor on the host plus a handful of file
// reads — on a few hundred processes, tens of microseconds.
func scanDRMEngineBusy(procRoot string) map[string]map[string]float64 {
	if procRoot == "" {
		procRoot = "/proc"
	}
	pids, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	out := map[string]map[string]float64{}
	// The kernel documents drm-client-id as the way to avoid counting one
	// client twice when two processes hold descriptors to the same open file;
	// without it, the descriptor itself is the identity.
	counted := map[string]bool{}
	for _, pid := range pids {
		if !pid.IsDir() {
			continue
		}
		fdDir := filepath.Join(procRoot, pid.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue // kernel threads, exited processes, other users' procs
		}
		for _, fd := range fds {
			target, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil || !strings.HasPrefix(target, "/dev/dri/") {
				continue
			}
			sumFDInfo(filepath.Join(procRoot, pid.Name(), "fdinfo", fd.Name()), out, counted)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// sumFDInfo folds one DRM client's fdinfo into the per-GPU, per-engine totals.
func sumFDInfo(path string, out map[string]map[string]float64, counted map[string]bool) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()

	var (
		pdev    string
		client  string
		engines = map[string]float64{}
		groups  = map[string]float64{}
	)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		key, value, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		switch {
		case key == "drm-driver":
			// Any fdinfo with this is a DRM descriptor.
		case key == "drm-pdev":
			pdev = normalizeSlot(value)
		case key == "drm-client-id":
			client = value
		case strings.HasPrefix(key, "drm-engine-capacity-"):
			groups[strings.TrimPrefix(key, "drm-engine-capacity-")] = parseLeadingFloat(value)
		case strings.HasPrefix(key, "drm-engine-"):
			engines[strings.TrimPrefix(key, "drm-engine-")] = parseLeadingFloat(value)
		}
	}
	if pdev == "" || len(engines) == 0 {
		return
	}
	if client == "" {
		client = path // the descriptor is its own best identity
	}
	if counted[pdev+"\x00"+client] {
		return
	}
	counted[pdev+"\x00"+client] = true

	totals := out[pdev]
	if totals == nil {
		totals = map[string]float64{}
		out[pdev] = totals
	}
	for name, ns := range engines {
		// A group of identical hardware engines reports one counter for all
		// of them, so it is divided by the group's size to stay a time.
		if g := groups[name]; g > 1 {
			ns /= g
		}
		totals[name] += ns
	}
}

// parseLeadingFloat reads the number at the start of a value that may carry a
// unit suffix — fdinfo writes "123456789 ns", sysfs writes a bare number.
func parseLeadingFloat(value string) float64 {
	f, err := strconv.ParseFloat(strings.Fields(value + " ")[0], 64)
	if err != nil {
		return 0
	}
	return f
}

// readFloat reads a sysfs file holding a single number.
func readFloat(path string) (float64, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
	if err != nil {
		return 0, false
	}
	return f, true
}
