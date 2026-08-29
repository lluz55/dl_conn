package sensors

import (
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestReadCPUTemp_FromFakeSys(t *testing.T) {
	root := t.TempDir()
	class := filepath.Join(root, "class", "thermal")
	if err := os.MkdirAll(class, 0o755); err != nil {
		t.Fatal(err)
	}
	// thermal_zone0: type=acpitz, temp=50000 → 50.0°C
	zone := filepath.Join(class, "thermal_zone0")
	if err := os.MkdirAll(zone, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(zone, "type"), []byte("acpitz\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(zone, "temp"), []byte("50000\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := ReadCPUTemp(root)
	if err != nil {
		t.Fatalf("ReadCPUTemp: %v", err)
	}
	if got == nil || *got != 50.0 {
		t.Fatalf("got %v, want 50.0", got)
	}
}

func TestReadCPUTemp_PreferredZone(t *testing.T) {
	root := t.TempDir()
	class := filepath.Join(root, "class", "thermal")
	if err := os.MkdirAll(class, 0o755); err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"acpitz", "x86_pkg_temp"} {
		zone := filepath.Join(class, "thermal_zone"+itoa(i))
		if err := os.MkdirAll(zone, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(zone, "type"), []byte(name+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		temp := "45000"
		if name == "x86_pkg_temp" {
			temp = "72000"
		}
		if err := os.WriteFile(filepath.Join(zone, "temp"), []byte(temp+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	got, err := ReadCPUTemp(root)
	if err != nil {
		t.Fatalf("ReadCPUTemp: %v", err)
	}
	if got == nil || *got != 72.0 {
		t.Fatalf("got %v, want 72.0 (preferred zone)", got)
	}
}

func TestReadLoadAvg_FromFakeProc(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "loadavg"), []byte("1.50 2.30 3.10 1/234 12345\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	l1, l5, l15, err := ReadLoadAvg(root)
	if err != nil {
		t.Fatal(err)
	}
	if l1 != 1.5 || l5 != 2.3 || l15 != 3.1 {
		t.Fatalf("got %v %v %v", l1, l5, l15)
	}
}

func TestReadMemory_FromFakeProc(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// MemTotal=8000000 kB, MemAvailable=2000000 kB → 75% used
	body := "MemTotal:       8000000 kB\nMemAvailable:   2000000 kB\nMemFree:        1000000 kB\n"
	if err := os.WriteFile(filepath.Join(root, "meminfo"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	mem, err := ReadMemory(root)
	if err != nil {
		t.Fatal(err)
	}
	if mem == nil {
		t.Fatal("nil memory")
	}
	if mem.TotalMB != 7812 { // 8000000/1024
		t.Errorf("TotalMB=%d, want 7812", mem.TotalMB)
	}
	if mem.AvailableMB != 1953 { // 2000000/1024
		t.Errorf("AvailableMB=%d, want 1953", mem.AvailableMB)
	}
	if mem.UsedPct < 74.9 || mem.UsedPct > 75.1 {
		t.Errorf("UsedPct=%f, want ~75", mem.UsedPct)
	}
}

func TestReadUptime_FromFakeProc(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "uptime"), []byte("12345.67 67890.12\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	up, err := ReadUptime(root)
	if err != nil {
		t.Fatal(err)
	}
	if up != 12345 {
		t.Fatalf("uptime=%d, want 12345", up)
	}
}

func TestReadBattery_NotAvailable(t *testing.T) {
	root := t.TempDir()
	// Empty power_supply dir → no BATx → not available.
	if err := os.MkdirAll(filepath.Join(root, "class", "power_supply"), 0o755); err != nil {
		t.Fatal(err)
	}
	batt, err := ReadBattery(root)
	if err != nil {
		t.Fatal(err)
	}
	if batt == nil || batt.Available {
		t.Fatalf("expected available=false, got %+v", batt)
	}
}

func TestReadBattery_FromFakeSys(t *testing.T) {
	root := t.TempDir()
	bat := filepath.Join(root, "class", "power_supply", "BAT0")
	if err := os.MkdirAll(bat, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "capacity"), []byte("85\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "status"), []byte("Discharging\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	batt, err := ReadBattery(root)
	if err != nil {
		t.Fatal(err)
	}
	if batt == nil || !batt.Available || batt.CapacityPct == nil || *batt.CapacityPct != 85 {
		t.Fatalf("got %+v", batt)
	}
	if batt.Status != "Discharging" {
		t.Errorf("status=%q", batt.Status)
	}
}

func TestCollector_CollectOnce(t *testing.T) {
	root := t.TempDir()
	// Set up a minimal /sys and /proc.
	if err := os.MkdirAll(filepath.Join(root, "proc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "proc", "loadavg"), []byte("0.50 0.60 0.70 1/1 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "proc", "meminfo"), []byte("MemTotal: 4000000 kB\nMemAvailable: 1000000 kB\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "proc", "uptime"), []byte("1000.00 2000.00\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	class := filepath.Join(root, "sys", "class", "thermal")
	if err := os.MkdirAll(class, 0o755); err != nil {
		t.Fatal(err)
	}
	zone := filepath.Join(class, "thermal_zone0")
	if err := os.MkdirAll(zone, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(zone, "type"), []byte("x86_pkg_temp\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(zone, "temp"), []byte("60000\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Sanity: fstest available (re-exported by testing/fstest).
	_ = fstest.MapFS{}

	c := NewCollector(10).WithRoots(filepath.Join(root, "sys"), filepath.Join(root, "proc"))
	snap := c.CollectOnce()
	if snap.CPU == nil || snap.CPU.TempC == nil || *snap.CPU.TempC != 60.0 {
		t.Errorf("CPU temp = %+v", snap.CPU)
	}
	if snap.CPU == nil || snap.CPU.Load1 != 0.5 {
		t.Errorf("CPU load1 = %+v", snap.CPU)
	}
	if snap.Memory == nil || snap.Memory.TotalMB != 3906 {
		t.Errorf("Memory = %+v", snap.Memory)
	}
	if snap.UptimeSec != 1000 {
		t.Errorf("Uptime=%d", snap.UptimeSec)
	}
	if c.Latest() == nil {
		t.Error("Latest() returned nil after CollectOnce")
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	return string(rune('0' + i))
}
