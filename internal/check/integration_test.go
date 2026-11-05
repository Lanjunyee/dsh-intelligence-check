package check

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDetectionLifecycleUsesTransportWithoutProbeAlias(t *testing.T) {
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Model    string
			Messages []struct{ Content string }
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Model != "a/solo" {
			t.Errorf("probe alias leaked: %q", body.Model)
		}
		milk, _ := FindPrompt("milk")
		if len(body.Messages) != 1 || body.Messages[0].Content != milk.Text {
			t.Error("probe prompt changed")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"46.24 inches"},"finish_reason":"stop"}],"usage":{"total_tokens":6}}`))
	}))
	defer up.Close()
	s := fixture(t)
	s.Configure(Config{GatewayURL: up.URL, GatewayKey: "fixture", DailyLimit: 120})
	s.SetTarget("a/solo", true)
	if err := s.Trigger("a/solo", "milk"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if calls.Load() != 1 || len(state.Results) != 1 || state.Results[0].Verdict != "passed" || state.Results[0].Tokens != 6 {
		t.Fatalf("calls=%d results=%+v", calls.Load(), state.Results)
	}
}

func waitIdle(t *testing.T, s *Service) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		s.mu.Lock()
		running := len(s.running) > 0
		s.mu.Unlock()
		if !running {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("检测未结束")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRetestAndFailureRecords(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		answer string
		limit  int
		want   string
		calls  int
	}{
		{"confirmed", 200, "48 inches", 120, "failed", 2},
		{"limited", 429, "", 120, "unavailable", 1},
		{"budget", 200, "48 inches", 1, "failed", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(tc.status)
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": tc.answer}, "finish_reason": "stop"}}})
			}))
			defer up.Close()
			s := fixture(t)
			s.Configure(Config{GatewayURL: up.URL, GatewayKey: "fixture", DailyLimit: tc.limit})
			s.SetTarget("a/solo", true)
			if err := s.Trigger("a/solo", "milk"); err != nil {
				t.Fatal(err)
			}
			waitIdle(t, s)
			state, _ := s.Snapshot()
			if len(state.Results) == 0 || state.Results[len(state.Results)-1].Verdict != tc.want || int(calls.Load()) != tc.calls {
				t.Fatalf("verdict=%v calls=%d", state.Results, calls.Load())
			}
		})
	}
}

func TestManualPromptDoesNotRetestOrTouchTargetState(t *testing.T) {
	s := fixture(t)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"choices":[{"message":{"content":"<svg/>"},"finish_reason":"stop"}]}`))
	}))
	defer up.Close()
	s.Configure(Config{GatewayURL: up.URL, GatewayKey: "fixture", DailyLimit: 120})
	s.SetTarget("a/solo", true)
	if err := s.Trigger("a/solo", "svg"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "manual" {
		t.Fatalf("manual prompt result: %+v", state.Results)
	}
	if !state.Targets["a/solo"].Enabled {
		t.Fatal("manual check changed monitoring")
	}
}
