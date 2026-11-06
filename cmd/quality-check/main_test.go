package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gofrs/flock"
)

func TestRejectNonSharedDataDirectoryInUse(t *testing.T) {
	dir := t.TempDir()
	lock := flock.New(filepath.Join(dir, "service.lock"))
	if err := lock.Lock(); err != nil {
		t.Fatal(err)
	}
	defer lock.Unlock()
	err := run(dir, "127.0.0.1:0", "", false, "", "", false)
	if err == nil || !strings.Contains(err.Error(), "已有检测服务") {
		t.Fatalf("shared directory accepted: %v", err)
	}
}

type startInfo struct {
	Origin  string `json:"origin"`
	Control string `json:"control"`
	Owner   bool   `json:"owner"`
}

func readStartInfo(t *testing.T, stdout *bufio.Reader) startInfo {
	t.Helper()
	line, err := stdout.ReadString('\n')
	if err != nil {
		t.Fatalf("read start info: %v", err)
	}
	var info startInfo
	if err := json.Unmarshal([]byte(line), &info); err != nil {
		t.Fatalf("decode start info %q: %v", line, err)
	}
	return info
}

// TestSharedInstanceConnectsToOwner exercises the desktop contract: the first
// process owns the data directory, later processes read its connection and
// exit successfully, and owner shutdown removes the connection record.
func TestSharedInstanceConnectsToOwner(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "quality-check-test")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = os.Environ()
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build helper binary: %v\n%s", err, output)
	}
	dataDir := filepath.Join(dir, "data")

	owner := exec.Command(binary, "-data", dataDir, "-shared", "-owned", "-listen", "127.0.0.1:0")
	stdin, err := owner.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := owner.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	owner.Stderr = os.Stderr
	if err := owner.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stdin.Close()
		if owner.Process != nil {
			owner.Process.Kill()
		}
		owner.Wait()
	})
	info := readStartInfo(t, bufio.NewReader(stdout))
	if !info.Owner || info.Origin == "" || info.Control == "" {
		t.Fatalf("owner start info = %+v", info)
	}
	connectionPath := filepath.Join(dataDir, "connection.json")
	raw, err := os.ReadFile(connectionPath)
	if err != nil {
		t.Fatalf("owner did not publish its connection: %v", err)
	}
	var published startInfo
	if err := json.Unmarshal(raw, &published); err != nil {
		t.Fatalf("decode connection: %v", err)
	}
	if published.Origin != info.Origin || published.Control != info.Control {
		t.Fatalf("published connection = %+v, owner = %+v", published, info)
	}
	if stat, err := os.Stat(connectionPath); err != nil || stat.Mode().Perm() != 0o600 {
		t.Fatalf("connection permissions = %v, %v", stat.Mode().Perm(), err)
	}

	joiner := exec.Command(binary, "-data", dataDir, "-shared", "-listen", "127.0.0.1:0")
	joinedOutput, err := joiner.Output()
	if err != nil {
		t.Fatalf("joiner failed: %v", err)
	}
	var joined startInfo
	if err := json.Unmarshal(joinedOutput, &joined); err != nil {
		t.Fatalf("joiner output %q: %v", joinedOutput, err)
	}
	if joined.Owner || joined.Origin != info.Origin || joined.Control != info.Control {
		t.Fatalf("join = %+v, owner = %+v", joined, info)
	}

	if err := owner.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- owner.Wait() }()
	select {
	case err := <-exited:
		if err != nil {
			t.Fatalf("owner exit: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("owner did not exit after SIGTERM")
	}
	if _, err := os.Stat(connectionPath); !os.IsNotExist(err) {
		t.Fatalf("connection record remained after shutdown: %v", err)
	}
}
