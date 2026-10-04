package sensors

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// TestFsKey_CollapsesOneFilesystem is the regression guard for the panel that
// listed a single disk three times. This host bind-mounts one ext4 volume at
// "/", "/nix/store" and the container overlay; keyed on the mountpoint each
// path was its own row with identical numbers, so the panel read as three
// disks. The filesystem ID is the identity, not the path.
func TestFsKey_CollapsesOneFilesystem(t *testing.T) {
	same := syscall.Statfs_t{Fsid: syscall.Fsid{X__val: [2]int32{42, -7}}, Blocks: 100, Bfree: 40, Bsize: 4096}
	other := syscall.Statfs_t{Fsid: syscall.Fsid{X__val: [2]int32{43, -7}}, Blocks: 100, Bfree: 40, Bsize: 4096}

	if got, want := fsKey("ext4", &same), fsKey("ext4", &same); got != want {
		t.Errorf("the same filesystem produced two keys: %q vs %q", got, want)
	}
	if fsKey("ext4", &same) == fsKey("ext4", &other) {
		t.Error("two filesystems with different IDs collapsed into one key")
	}
	// Same ID on different fs types is still a different row: an ext4 and a
	// zfs pool can legitimately share an fsid value.
	if fsKey("ext4", &same) == fsKey("zfs", &same) {
		t.Error("the fstype is not part of the key")
	}
}

// TestFsKey_ZeroFsidFallsBack: some filesystems report no ID, and folding
// those on the mountpoint would bring the duplicate rows straight back. The
// fallback has to still identify size and free space.
func TestFsKey_ZeroFsidFallsBack(t *testing.T) {
	anon := syscall.Statfs_t{Blocks: 100, Bfree: 40, Bsize: 4096}
	different := syscall.Statfs_t{Blocks: 200, Bfree: 40, Bsize: 4096}

	if fsKey("ext4", &anon) == "ext4/0:0" {
		t.Error("a zero fsid must not be used as the key")
	}
	if fsKey("ext4", &anon) == fsKey("ext4", &different) {
		t.Error("two anonymous filesystems of different sizes collapsed into one key")
	}
}

// TestReadDisks_OneRowPerFilesystem reads the host's real /proc/mounts: every
// mount that resolves to the same filesystem must collapse to one row, and
// two genuinely different filesystems must both survive.
func TestReadDisks_OneRowPerFilesystem(t *testing.T) {
	disks, err := ReadDisks("/proc")
	if err != nil {
		t.Skipf("no readable /proc/mounts: %v", err)
	}
	if len(disks) == 0 {
		t.Skip("host has no filterable filesystem mounted")
	}

	// No two rows may describe the same (total, used) pair: that is the
	// duplicate the panel was showing, whatever the mount layout is.
	seen := make(map[[2]int64]string, len(disks))
	for _, d := range disks {
		key := [2]int64{d.TotalMB, d.UsedMB}
		if prev, dup := seen[key]; dup {
			t.Errorf("%s and %s report the same filesystem (%d/%d MB); expected one row",
				prev, d.Mountpoint, d.UsedMB, d.TotalMB)
		}
		seen[key] = d.Mountpoint
		if d.UsedPct < 0 || d.UsedPct > 100 {
			t.Errorf("%s: used_pct=%.2f, outside 0..100", d.Mountpoint, d.UsedPct)
		}
	}
}

// TestReadDisks_SkipsUnfilterableTypes keeps the fs whitelist honest: a
// fixture mount list that is all tmpfs/devtmpfs must produce nothing, so the
// dedup change cannot have quietly widened what counts as a disk.
func TestReadDisks_SkipsUnfilterableTypes(t *testing.T) {
	dir := t.TempDir()
	mounts := filepath.Join(dir, "mounts")
	content := "tmpfs /run tmpfs rw 0 0\ndevtmpfs /dev devtmpfs rw 0 0\nproc /proc proc rw 0 0\n"
	if err := os.WriteFile(mounts, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	disks, err := ReadDisks(dir)
	if err != nil {
		t.Fatalf("ReadDisks: %v", err)
	}
	if len(disks) != 0 {
		t.Errorf("got %d disks, want 0: only real filesystems count", len(disks))
	}
}
