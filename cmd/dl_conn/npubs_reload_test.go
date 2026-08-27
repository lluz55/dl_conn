package main

import (
	"os"
	"os/signal"
	"syscall"
	"testing"
	"time"
)

func TestReloadDaemon_ExplicitPID(t *testing.T) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGHUP)
	defer signal.Stop(ch)

	pid, err := reloadDaemon(os.Getpid())
	if err != nil {
		t.Fatalf("reloadDaemon(self) = %v, want nil", err)
	}
	if pid != os.Getpid() {
		t.Errorf("pid = %d, want %d", pid, os.Getpid())
	}
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Error("SIGHUP was never delivered")
	}
}

func TestReloadDaemon_DeadPID(t *testing.T) {
	// A process that has certainly exited: fork one and wait for it.
	proc, err := os.StartProcess("/bin/sh", []string{"sh", "-c", "exit 0"}, &os.ProcAttr{})
	if err != nil {
		t.Skipf("cannot spawn a helper process: %v", err)
	}
	state, err := proc.Wait()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reloadDaemon(state.Pid()); err == nil {
		t.Error("reloadDaemon(dead pid) = nil, want an error")
	}
}

// The scan must never report the process doing the scanning: this same
// binary is what runs "npubs add", and signalling it would kill the CLI.
func TestFindDaemonProcesses_ExcludesSelf(t *testing.T) {
	pids, err := findDaemonProcesses()
	if err != nil {
		t.Skipf("no /proc on this platform: %v", err)
	}
	for _, pid := range pids {
		if pid == os.Getpid() {
			t.Fatalf("findDaemonProcesses returned its own PID %d", pid)
		}
	}
}

func TestIsCLIInvocation_Self(t *testing.T) {
	// The test binary's own command line has no "npubs"/"keygen" argument,
	// so it must not be classified as a one-shot CLI run.
	if isCLIInvocation(os.Getpid()) {
		t.Error("isCLIInvocation(self) = true, want false")
	}
	if !isCLIInvocation(-1) {
		t.Error("isCLIInvocation(unreadable) = false, want true (never signal what we can't identify)")
	}
}
