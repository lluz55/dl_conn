package sensors

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ReadCPUTemp returns CPU temperature in Celsius if available.
func ReadCPUTemp(sysRoot string) (*float64, error) {
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	thermalBase := filepath.Join(sysRoot, "class/thermal")
	entries, err := os.ReadDir(thermalBase)
	if err != nil {
		// Try hwmon fallback.
		return readHwmonTemp(sysRoot)
	}
	var best *float64
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "thermal_zone") {
			continue
		}
		typePath := filepath.Join(thermalBase, e.Name(), "type")
		tempPath := filepath.Join(thermalBase, e.Name(), "temp")
		typeBytes, _ := os.ReadFile(typePath)
		t := strings.TrimSpace(string(typeBytes))
		// Prefer x86_pkg_temp / coretemp style, but accept any.
		tempBytes, err := os.ReadFile(tempPath)
		if err != nil {
			continue
		}
		v := strings.TrimSpace(string(tempBytes))
		milli, err := strconv.ParseFloat(v, 64)
		if err != nil {
			continue
		}
		c := milli / 1000.0
		// Prefer known CPU zone names.
		if t == "x86_pkg_temp" || strings.Contains(t, "coretemp") || strings.Contains(t, "k10temp") || t == "cpu-thermal" {
			return &c, nil
		}
		if best == nil {
			tmp := c
			best = &tmp
		}
	}
	if best != nil {
		return best, nil
	}
	return readHwmonTemp(sysRoot)
}

func readHwmonTemp(sysRoot string) (*float64, error) {
	hwmonBase := filepath.Join(sysRoot, "class/hwmon")
	entries, err := os.ReadDir(hwmonBase)
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		nameBytes, _ := os.ReadFile(filepath.Join(hwmonBase, e.Name(), "name"))
		name := strings.TrimSpace(string(nameBytes))
		if name != "coretemp" && name != "k10temp" && name != "cpu_thermal" && name != "atk0110" {
			continue
		}
		// Look for temp1_input etc.
		for i := 1; i <= 5; i++ {
			p := filepath.Join(hwmonBase, e.Name(), "temp"+strconv.Itoa(i)+"_input")
			b, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			v := strings.TrimSpace(string(b))
			milli, err := strconv.ParseFloat(v, 64)
			if err != nil {
				continue
			}
			c := milli / 1000.0
			return &c, nil
		}
	}
	return nil, nil
}

// ReadLoadAvg reads /proc/loadavg.
func ReadLoadAvg(procRoot string) (float64, float64, float64, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "loadavg"))
	if err != nil {
		return 0, 0, 0, err
	}
	parts := strings.Fields(string(b))
	if len(parts) < 3 {
		return 0, 0, 0, nil
	}
	l1, _ := strconv.ParseFloat(parts[0], 64)
	l5, _ := strconv.ParseFloat(parts[1], 64)
	l15, _ := strconv.ParseFloat(parts[2], 64)
	return l1, l5, l15, nil
}

// ReadCPUFreq reads max frequency from /proc/cpuinfo or sysfs.
func ReadCPUFreq(procRoot, sysRoot string) (*float64, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "cpuinfo"))
	if err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "cpu MHz") {
				parts := strings.Split(line, ":")
				if len(parts) == 2 {
					v := strings.TrimSpace(parts[1])
					f, err := strconv.ParseFloat(v, 64)
					if err == nil {
						return &f, nil
					}
				}
			}
		}
	}
	// Fallback sysfs.
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	entries, err := os.ReadDir(filepath.Join(sysRoot, "devices/system/cpu"))
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "cpu") {
			continue
		}
		p := filepath.Join(sysRoot, "devices/system/cpu", e.Name(), "cpufreq/scaling_cur_freq")
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		v := strings.TrimSpace(string(b))
		khz, err := strconv.ParseFloat(v, 64)
		if err == nil {
			mhz := khz / 1000.0
			return &mhz, nil
		}
	}
	return nil, nil
}
