package sensors

import (
	"fmt"
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
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountpoint, &stat); err != nil {
			continue
		}
		// One row per *filesystem*, not per mountpoint. Bind mounts and
		// btrfs subvolumes share the filesystem's statfs, so keying on the
		// mountpoint listed the same disk once per path it appears under —
		// on this host one ext4 volume was reported three times with
		// identical numbers, which reads as three disks in the panel.
		fs := fsKey(fstype, &stat)
		if seen[fs] {
			continue
		}
		seen[fs] = true
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

// fsKey identifies the filesystem behind a mount. The filesystem ID is the
// identity: ext4, xfs and zfs report a distinct one per filesystem, and btrfs
// reports the same one for every subvolume of it — which is exactly the
// collapse we want, because statfs on a subvolume already reports the whole
// filesystem's numbers.
//
// A filesystem that reports no ID at all falls back to its size and free
// space, which is weaker but still stops the duplicate rows; two distinct
// filesystems would have to match on both to be folded together.
func fsKey(fstype string, stat *syscall.Statfs_t) string {
	if id := fmt.Sprintf("%d:%d", stat.Fsid.X__val[0], stat.Fsid.X__val[1]); id != "0:0" {
		return fstype + "/" + id
	}
	return fmt.Sprintf("%s/%d/%d/%d", fstype, stat.Blocks, stat.Bfree, stat.Bsize)
}

// DiskForPath is used in tests to avoid syscall.Statfs variability: returns empty.
func DiskForPath(_ string) ([]DiskSnapshot, error) { return nil, nil }

var _ = filepath.Join // ensure import used
