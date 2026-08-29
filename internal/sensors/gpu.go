package sensors

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func ReadGPU() (*GPUSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits")
	out, err := cmd.Output()
	if err != nil {
		return &GPUSnapshot{}, nil // not available, not an error
	}
	line := strings.TrimSpace(string(out))
	// Take first GPU only.
	if idx := strings.Index(line, "\n"); idx >= 0 {
		line = line[:idx]
	}
	parts := strings.Split(line, ",")
	if len(parts) < 2 {
		return &GPUSnapshot{}, nil
	}
	snap := &GPUSnapshot{}
	if v := strings.TrimSpace(parts[0]); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			snap.TempC = &f
		}
	}
	if v := strings.TrimSpace(parts[1]); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			snap.UtilPct = &f
		}
	}
	if snap.TempC == nil && snap.UtilPct == nil {
		return &GPUSnapshot{}, nil
	}
	return snap, nil
}
