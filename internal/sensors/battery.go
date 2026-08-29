package sensors

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func ReadBattery(sysRoot string) (*BatterySnapshot, error) {
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	base := filepath.Join(sysRoot, "class/power_supply")
	entries, err := os.ReadDir(base)
	if err != nil {
		return &BatterySnapshot{Available: false}, nil
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "BAT") {
			continue
		}
		capBytes, err := os.ReadFile(filepath.Join(base, e.Name(), "capacity"))
		statusBytes, _ := os.ReadFile(filepath.Join(base, e.Name(), "status"))
		if err != nil {
			continue
		}
		capStr := strings.TrimSpace(string(capBytes))
		cap, err := strconv.Atoi(capStr)
		if err != nil {
			continue
		}
		status := strings.TrimSpace(string(statusBytes))
		return &BatterySnapshot{
			CapacityPct: &cap,
			Status:      status,
			Available:   true,
		}, nil
	}
	return &BatterySnapshot{Available: false}, nil
}
