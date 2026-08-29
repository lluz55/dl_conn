package sensors

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func ReadUptime(procRoot string) (int64, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "uptime"))
	if err != nil {
		return 0, err
	}
	parts := strings.Fields(string(b))
	if len(parts) == 0 {
		return 0, nil
	}
	f, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	return int64(f), nil
}
