package sensors

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

func ReadDisks(procRoot string) ([]DiskSnapshot, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "mounts"))
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	var out []DiskSnapshot
	for _, line := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		mountpoint := fields[1]
		fstype := fields[2]
		// Filter to real filesystems.
		switch fstype {
		case "ext4", "btrfs", "xfs", "zfs", "ext3", "f2fs":
		default:
			continue
		}
		if seen[mountpoint] {
			continue
		}
		seen[mountpoint] = true
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountpoint, &stat); err != nil {
			continue
		}
		total := int64(stat.Blocks) * int64(stat.Bsize) / (1024 * 1024)
		free := int64(stat.Bfree) * int64(stat.Bsize) / (1024 * 1024)
		used := total - free
		var pct float64
		if total > 0 {
			pct = float64(used) / float64(total) * 100
		}
		out = append(out, DiskSnapshot{
			Mountpoint: mountpoint,
			TotalMB:    total,
			UsedMB:     used,
			UsedPct:    pct,
		})
	}
	return out, nil
}

// DiskForPath is used in tests to avoid syscall.Statfs variability: returns empty.
func DiskForPath(_ string) ([]DiskSnapshot, error) { return nil, nil }

var _ = filepath.Join // ensure import used
