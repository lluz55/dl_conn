package sensors

import "time"

// Snapshot aggregates all host telemetry at a point in time.
type Snapshot struct {
	SampledAt time.Time `json:"sampled_at"`
	CPU       *CPUSnapshot   `json:"cpu,omitempty"`
	Memory    *MemorySnapshot `json:"memory,omitempty"`
	Disks     []DiskSnapshot  `json:"disks,omitempty"`
	GPU       *GPUSnapshot    `json:"gpu,omitempty"`
	Battery   *BatterySnapshot `json:"battery,omitempty"`
	UptimeSec int64 `json:"uptime_s"`
	// NumCPU is the logical core count at sample time. Load averages are
	// only interpretable relative to it, so a dashboard needs both to turn
	// a bare load1 into a percentage. Zero on platforms that cannot report
	// it, in which case clients should fall back to showing raw load.
	NumCPU int `json:"num_cpu,omitempty"`
}

type CPUSnapshot struct {
	TempC    *float64 `json:"temp_c,omitempty"`
	Load1    float64  `json:"load1"`
	Load5    float64  `json:"load5"`
	Load15   float64  `json:"load15"`
	FreqMHz  *float64 `json:"freq_mhz,omitempty"`
}

type MemorySnapshot struct {
	TotalMB     int64   `json:"total_mb"`
	AvailableMB int64   `json:"available_mb"`
	UsedMB      int64   `json:"used_mb"`
	UsedPct     float64 `json:"used_pct"`
}

type DiskSnapshot struct {
	Mountpoint string  `json:"mountpoint"`
	TotalMB    int64   `json:"total_mb"`
	UsedMB     int64   `json:"used_mb"`
	UsedPct    float64 `json:"used_pct"`
}

type GPUSnapshot struct {
	TempC   *float64 `json:"temp_c,omitempty"`
	UtilPct *float64 `json:"util_pct,omitempty"`
}

type BatterySnapshot struct {
	CapacityPct *int   `json:"capacity_pct,omitempty"`
	Status      string `json:"status,omitempty"`
	Available   bool   `json:"available"`
}
