package check

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func bridgeServer(t *testing.T, events func(request map[string]any) []string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bridge-secret" {
			http.Error(w, "unauthorized", http.StatusForbidden)
			return
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		for _, line := range events(request) {
			fmt.Fprintln(w, line)
			w.(http.Flusher).Flush()
		}
	}))
}

func TestHostBridgeStreamsDeltasUsageAndFinish(t *testing.T) {
	var seen map[string]any
	server := bridgeServer(t, func(request map[string]any) []string {
		seen = request
		return []string{
			`{"type":"delta","text":"46."}`,
			`{"type":"delta","text":"24 inches"}`,
			`{"type":"usage","usage":{"input_tokens":12,"output_tokens":5,"total_tokens":17}}`,
			`{"type":"finish","reason":"stop"}`,
		}
	})
	defer server.Close()
	id := TargetID{Provider: "provider-one", Model: "shared-model"}
	var partials []string
	gen, err := NewHostBridgeTransport(server.URL, "bridge-secret").Generate(
		context.Background(), id, "question", func(partial string) { partials = append(partials, partial) },
		GenerateParams{MaxTokens: DefaultMaxTokens},
	)
	if err != nil {
		t.Fatal(err)
	}
	if gen.Answer != "46.24 inches" || gen.Finish != "stop" || gen.Usage == nil || gen.Usage.TotalTokens == nil || *gen.Usage.TotalTokens != 17 {
		t.Fatalf("unexpected generation: %+v", gen)
	}
	if gen.Usage.InputTokens != 12 || gen.Usage.OutputTokens != 5 {
		t.Fatalf("usage lost: %+v", gen.Usage)
	}
	if strings.Join(partials, "|") != "46.|46.24 inches" {
		t.Fatalf("increments not surfaced: %v", partials)
	}
	target, _ := seen["target"].(map[string]any)
	params, _ := seen["params"].(map[string]any)
	if seen["request_id"] == "" || seen["prompt"] != "question" || target["provider"] != "provider-one" || target["model"] != "shared-model" {
		t.Fatalf("request identity lost: %v", seen)
	}
	if params["max_tokens"] != float64(DefaultMaxTokens) {
		t.Fatalf("generation parameters lost: %v", params)
	}
}

func TestHostBridgeTerminalStatesPreserveAnswer(t *testing.T) {
	for _, tc := range []struct {
		name      string
		events    []string
		finish    string
		answer    string
		errorCode string
	}{
		{"truncated", []string{`{"type":"delta","text":"partial"}`, `{"type":"finish","reason":"max-tokens"}`}, "max-tokens", "partial", ""},
		{"failure", []string{`{"type":"delta","text":"partial"}`, `{"type":"finish","reason":"error","error":{"code":"RATE_LIMIT","message":"quota exceeded"}}`}, "error", "partial", "RATE_LIMIT"},
		{"aborted", []string{`{"type":"delta","text":"partial"}`, `{"type":"finish","reason":"aborted","error":{"code":"ABORTED","message":"Request was aborted"}}`}, "aborted", "partial", "ABORTED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := bridgeServer(t, func(map[string]any) []string { return tc.events })
			defer server.Close()
			gen, err := NewHostBridgeTransport(server.URL, "bridge-secret").Generate(
				context.Background(), TargetID{Provider: "p", Model: "m"}, "q", nil, GenerateParams{})
			if err != nil {
				t.Fatal(err)
			}
			if gen.Finish != tc.finish || gen.Answer != tc.answer {
				t.Fatalf("generation=%+v", gen)
			}
			if tc.errorCode != "" && (gen.Error == nil || gen.Error.Code != tc.errorCode) {
				t.Fatalf("failure lost: %+v", gen.Error)
			}
		})
	}
}

func TestHostBridgeCancelStopsStreamAndKeepsPartialAnswer(t *testing.T) {
	arrived := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		fmt.Fprintln(w, `{"type":"delta","text":"partial"}`)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-arrived
		cancel()
	}()
	gen, err := NewHostBridgeTransport(server.URL, "bridge-secret").Generate(
		ctx, TargetID{Provider: "p", Model: "m"}, "q", func(partial string) { close(arrived) }, GenerateParams{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel not surfaced: %v", err)
	}
	if gen.Answer != "partial" {
		t.Fatalf("partial answer lost: %+v", gen)
	}
}

func TestHostBridgeRejectsMissingFinish(t *testing.T) {
	server := bridgeServer(t, func(map[string]any) []string { return []string{`{"type":"delta","text":"partial"}`} })
	defer server.Close()
	_, err := NewHostBridgeTransport(server.URL, "bridge-secret").Generate(
		context.Background(), TargetID{Provider: "p", Model: "m"}, "q", nil, GenerateParams{})
	if err == nil || !strings.Contains(err.Error(), "完成事件") {
		t.Fatalf("missing finish accepted: %v", err)
	}
}

func TestHostBridgeHonoursCallerDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := NewHostBridgeTransport(server.URL, "bridge-secret").Generate(
		ctx, TargetID{Provider: "p", Model: "m"}, "q", nil, GenerateParams{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline not surfaced: %v", err)
	}
}
