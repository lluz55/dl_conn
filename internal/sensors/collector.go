package sensors

import (
	"context"
	"runtime"
	"sync"
	"time"
)

// Collector periodically samples host sensors.
type Collector struct {
	interval time.Duration
	sysRoot  string
	procRoot string

	// gpuUsage carries the previous DRM engine reading across samples: those
	// counters are cumulative, and only their delta against the wall clock is
	// a utilization.
	gpuUsage *GPUUsage
	// netPrev carries the previous Network snapshot across samples so the
	// collector can compute the bytes-per-second rate the same way gpuUsage
	// derives a percentage from cumulative engine counters. Both are nil-safe
	// on the very first sample.
	netPrev *NetworkSnapshot

	mu       sync.RWMutex
	latest   *Snapshot
	onSample func(Snapshot) // optional persistence hook
}

// NewCollector creates a collector with given interval.
func NewCollector(interval time.Duration) *Collector {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	return &Collector{interval: interval, gpuUsage: &GPUUsage{}}
}

// WithRoots overrides /sys and /proc roots (for tests).
func (c *Collector) WithRoots(sysRoot, procRoot string) *Collector {
	c.sysRoot = sysRoot
	c.procRoot = procRoot
	return c
}

// WithPersist sets a callback called on each sample.
func (c *Collector) WithPersist(fn func(Snapshot)) *Collector {
	c.onSample = fn
	return c
}

// Latest returns the most recent snapshot (or nil).
func (c *Collector) Latest() *Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.latest == nil {
		return nil
	}
	cp := *c.latest
	return &cp
}

// CollectOnce performs a single collection.
func (c *Collector) CollectOnce() Snapshot {
	snap := Snapshot{SampledAt: time.Now(), NumCPU: runtime.NumCPU()}
	if t, _ := ReadCPUTemp(c.sysRoot); t != nil {
		snap.CPU = &CPUSnapshot{TempC: t}
	} else {
		snap.CPU = &CPUSnapshot{}
	}
	if l1, l5, l15, err := ReadLoadAvg(c.procRoot); err == nil {
		if snap.CPU == nil {
			snap.CPU = &CPUSnapshot{}
		}
		snap.CPU.Load1 = l1
		snap.CPU.Load5 = l5
		snap.CPU.Load15 = l15
	}
	if f, _ := ReadCPUFreq(c.procRoot, c.sysRoot); f != nil {
		if snap.CPU == nil {
			snap.CPU = &CPUSnapshot{}
		}
		snap.CPU.FreqMHz = f
	}
	if mem, _ := ReadMemory(c.procRoot); mem != nil {
		snap.Memory = mem
	}
	if disks, _ := ReadDisks(c.procRoot); disks != nil {
		snap.Disks = disks
	}
	// A snapshot carrying only a vendor still counts: "this host has an Intel
	// card and it reports nothing" is what lets the frontend tell a silent GPU
	// apart from no GPU at all.
	if gpu, _ := ReadGPU(c.sysRoot, c.procRoot, c.gpuUsage); gpu != nil &&
		(gpu.Vendor != "" || gpu.TempC != nil || gpu.UtilPct != nil) {
		snap.GPU = gpu
	}
	if batt, _ := ReadBattery(c.sysRoot); batt != nil && batt.Available {
		snap.Battery = batt
	}
	if net, _ := ReadNetwork(c.procRoot); net != nil {
		// Rate derivation needs two samples and the wall clock between them.
		// A brand-new daemon (or a daemon that just lost its previous
		// reading) gets only cumulative counters; one with a previous reading
		// gets bytes-per-second as well.
		net.SampledAt = snap.SampledAt
		if c.netPrev != nil && !c.netPrev.SampledAt.IsZero() && !snap.SampledAt.Equal(c.netPrev.SampledAt) {
			elapsed := snap.SampledAt.Sub(c.netPrev.SampledAt).Seconds()
			if elapsed > 0 {
				if net.TotalRxBytes >= c.netPrev.TotalRxBytes {
					delta := float64(net.TotalRxBytes - c.netPrev.TotalRxBytes)
					rx := delta / elapsed
					net.RxBps = &rx
				}
				if net.TotalTxBytes >= c.netPrev.TotalTxBytes {
					delta := float64(net.TotalTxBytes - c.netPrev.TotalTxBytes)
					tx := delta / elapsed
					net.TxBps = &tx
				}
			}
		}
		// Carry the wall clock alongside the previous counters so the next
		// sample can compute its delta. SampledAt lives on the struct itself
		// (json:"-") so it does not pollute the emitted snapshot.
		prev := *net
		c.netPrev = &prev
		snap.Network = net
	}
	if up, _ := ReadUptime(c.procRoot); up != 0 {
		snap.UptimeSec = up
	}
	c.mu.Lock()
	cp := snap
	c.latest = &cp
	c.mu.Unlock()
	if c.onSample != nil {
		c.onSample(snap)
	}
	return snap
}

// Run starts periodic collection until ctx is done.
func (c *Collector) Run(ctx context.Context) {
	c.CollectOnce()
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.CollectOnce()
		}
	}
}
