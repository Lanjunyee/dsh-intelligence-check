package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/Lanjunyee/dsh-intelligence-check/internal/check"
	"github.com/gofrs/flock"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	dir := flag.String("data", "data", "private data directory")
	listen := flag.String("listen", "127.0.0.1:0", "loopback address")
	cloudflared := flag.String("cloudflared", "", "official cloudflared executable")
	owned := flag.Bool("owned", false, "stop when parent input closes")
	bridge := flag.String("bridge", "", "host model generation bridge URL")
	bridgeToken := flag.String("bridge-token", "", "host bridge bearer token")
	shared := flag.Bool("shared", false, "join the user-level shared instance instead of failing on its lock")
	flag.Parse()
	if err := run(*dir, *listen, *cloudflared, *owned, *bridge, *bridgeToken, *shared); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// connectionRecord is the owner-only rendezvous a shared desktop instance
// publishes for later plugin instances. The control token authorizes the same
// management API the owner received on stdout.
type connectionRecord struct {
	Origin  string `json:"origin"`
	Control string `json:"control"`
	PID     int    `json:"pid"`
}

func writeConnection(path, origin, control string) error {
	record, err := json.Marshal(connectionRecord{Origin: origin, Control: control, PID: os.Getpid()})
	if err != nil {
		return err
	}
	temporary := path + "." + check.RandomHex()[:8] + ".tmp"
	if err := os.WriteFile(temporary, record, 0600); err != nil {
		return err
	}
	if err := os.Chmod(temporary, 0600); err != nil {
		os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		os.Remove(temporary)
		return err
	}
	return nil
}

func removeConnection(path, control string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var record connectionRecord
	if json.Unmarshal(raw, &record) != nil || record.Control != control {
		return
	}
	os.Remove(path)
}

func healthy(origin string) bool {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	request, err := http.NewRequest("GET", origin+"/health", nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	io.Copy(io.Discard, response.Body)
	return response.StatusCode == http.StatusNoContent && response.Header.Get("X-DSH-Intelligence-Check") == "ready"
}

func awaitConnection(path string) (connectionRecord, error) {
	deadline := time.Now().Add(5 * time.Second)
	for {
		raw, err := os.ReadFile(path)
		if err == nil {
			var record connectionRecord
			if json.Unmarshal(raw, &record) == nil && record.Origin != "" && record.Control != "" && healthy(record.Origin) {
				return record, nil
			}
		}
		if time.Now().After(deadline) {
			return connectionRecord{}, fmt.Errorf("检测服务正在启动但未就绪，请稍后重试")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func run(dir, addr, binary string, owned bool, bridge, bridgeToken string, shared bool) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	lock := flock.New(filepath.Join(dir, "service.lock"))
	locked, err := lock.TryLock()
	if err != nil {
		return err
	}
	connectionPath := filepath.Join(dir, "connection.json")
	if !locked {
		if !shared {
			return fmt.Errorf("此数据目录已有检测服务运行，请使用独立 dataDir")
		}
		record, err := awaitConnection(connectionPath)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{
			"origin": record.Origin, "control": record.Control, "owner": false,
		})
	}
	defer lock.Unlock()
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("management listener must be loopback")
	}
	s, err := check.NewWithTransport(dir, transportFor(bridge, bridgeToken))
	if err != nil {
		return err
	}
	defer s.Close()
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	token := check.RandomHex()
	origin := "http://" + ln.Addr().String()
	if shared {
		if err := writeConnection(connectionPath, origin, token); err != nil {
			return err
		}
		defer removeConnection(connectionPath, token)
	}
	access := check.NewAccess(token, origin)
	console := check.NewConsole(access, origin, dir, binary)
	defer console.Close()
	server := &http.Server{Handler: s.ManagedHandler(access, console), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"url": origin + "/open/" + access.Ticket(), "origin": origin, "control": token, "owner": true})
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	done := make(chan error, 1)
	parentClosed := make(chan struct{})
	if owned {
		go func() { io.Copy(io.Discard, os.Stdin); close(parentClosed) }()
	}
	go func() { done <- server.Serve(ln) }()
	select {
	case err := <-done:
		if err != http.ErrServerClosed {
			return err
		}
	case <-stop:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	case <-parentClosed:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}
	return nil
}

func transportFor(bridge, token string) check.Transport {
	if bridge == "" {
		return nil
	}
	return check.NewHostBridgeTransport(bridge, token)
}
