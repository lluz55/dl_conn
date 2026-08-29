package sensors

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func ReadMemory(procRoot string) (*MemorySnapshot, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "meminfo"))
	if err != nil {
		return nil, err
	}
	var totalKB, availKB int64
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		val, _ := strconv.ParseInt(fields[1], 10, 64)
		switch key {
		case "MemTotal":
			totalKB = val
		case "MemAvailable":
			availKB = val
		}
	}
	if totalKB == 0 {
		return nil, nil
	}
	if availKB == 0 {
		availKB = totalKB // fallback
	}
	usedKB := totalKB - availKB
	usedPct := float64(usedKB) / float64(totalKB) * 100
	return &MemorySnapshot{
		TotalMB:     totalKB / 1024,
		AvailableMB: availKB / 1024,
		UsedMB:      usedKB / 1024,
		UsedPct:     usedPct,
	}, nil
}
