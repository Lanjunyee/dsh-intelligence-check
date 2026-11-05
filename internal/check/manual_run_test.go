package check

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestManualMilkThroughWebPersistsAfterRestart(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model    string
			Messages []struct{ Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "a/solo" {
			t.Errorf("transport model = %q", body.Model)
		}
		milk, _ := FindPrompt("milk")
		if len(body.Messages) != 1 || body.Messages[0].Content != milk.Text {
			t.Error("检测请求没有原样发送题目")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"46.24 inches"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}`))
	}))
	defer upstream.Close()

	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(Config{GatewayURL: upstream.URL, GatewayKey: "fixture", DailyLimit: 5}); err != nil {
		t.Fatal(err)
	}
	// A target does not need to be monitored for a manual check.
	if err := s.SetTarget("a/solo", false); err != nil {
		t.Fatal(err)
	}
	h := s.Handler("secret")
	request := func(action string) *httptest.ResponseRecorder {
		body := `{"model":"a/solo","action":"` + action + `","prompt":"milk"}`
		r := httptest.NewRequest("POST", "/api/action", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer secret")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("test"); w.Code != 200 {
		t.Fatalf("manual check rejected: %d %s", w.Code, w.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		state, _ := s.Snapshot()
		if len(state.Results) == 1 && state.Results[0].Verdict != "running" {
			result := state.Results[0]
			if result.Verdict != "passed" || result.Answer != "46.24 inches" || result.Tokens != 9 {
				t.Fatalf("unexpected record: %+v", result)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("manual milk did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, action := range []string{"allow", "hold"} {
		if w := request(action); w.Code != 400 {
			t.Fatalf("business gate action %q still accepted: %d", action, w.Code)
		}
	}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".js") {
				t.Fatalf("business gate script published: %s", entry.Name())
			}
		}
	}
	s.Close()

	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ := restored.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Answer != "46.24 inches" || state.Results[0].Verdict != "passed" {
		t.Fatalf("record lost across restart: %+v", state.Results)
	}
}

// Unwritable gate locations must not affect checks or persistence.
func TestMissingOrUnwritableGatePathDoesNotAffectSaving(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "gate.middleware.js"), 0500); err != nil {
		t.Fatal(err)
	}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.SetTarget("a/solo", true); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.state.Results = append(s.state.Results, Result{ID: "kept", Model: "a/solo", Answer: "answer"})
	err = s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var stored State
	if err := s.store.Load(&stored); err != nil || len(stored.Results) != 1 || stored.Results[0].Answer != "answer" {
		t.Fatalf("record not persisted: %+v %v", stored.Results, err)
	}
	info, err := os.Stat(filepath.Join(dir, "gate.middleware.js"))
	if err != nil || !info.IsDir() {
		t.Fatal("unexpected write to gate path")
	}
}

type recordingTransport struct {
	mu      sync.Mutex
	models  []Model
	calls   []string
	updates int
}

func (r *recordingTransport) Models(context.Context) ([]Model, error) {
	return r.models, nil
}

func (r *recordingTransport) Generate(_ context.Context, model, prompt string, progress func(string)) (string, int, error) {
	r.mu.Lock()
	r.calls = append(r.calls, model+"|"+prompt)
	r.mu.Unlock()
	if progress != nil {
		progress("part")
		r.mu.Lock()
		r.updates++
		r.mu.Unlock()
	}
	return "46.24 inches", 7, nil
}

func TestTransportSeamCoversChecksAndModelTrace(t *testing.T) {
	transport := &recordingTransport{models: []Model{{ID: "a/solo", Group: "a"}}}
	s, err := NewWithTransport(t.TempDir(), transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.SetTarget("a/solo", true); err != nil {
		t.Fatal(err)
	}
	if err := s.Trigger("a/solo", "milk"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "passed" {
		t.Fatalf("quality check did not use transport: %+v", state.Results)
	}
	if err := s.TriggerModelTrace("a/solo"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	transport.mu.Lock()
	calls, updates := append([]string(nil), transport.calls...), transport.updates
	transport.mu.Unlock()
	if len(calls) != 4 || updates != 1 {
		t.Fatalf("calls=%v updates=%d", calls, updates)
	}
	for _, call := range calls {
		if !strings.HasPrefix(call, "a/solo|") {
			t.Fatalf("probe alias leaked to transport: %s", call)
		}
	}
	if calls[0] != "a/solo|"+mustPrompt(t, "milk").Text || !strings.Contains(calls[3], "1 到 355") {
		t.Fatalf("unexpected transport prompts: %v", calls)
	}

	h := s.Handler("secret")
	r := httptest.NewRequest("GET", "/api/models", nil)
	r.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"id":"a/solo"`) {
		t.Fatalf("model catalog bypassed transport: %d %s", w.Code, w.Body.String())
	}
}

func mustPrompt(t *testing.T, id string) Prompt {
	t.Helper()
	p, ok := FindPrompt(id)
	if !ok {
		t.Fatal("missing prompt", id)
	}
	return p
}
