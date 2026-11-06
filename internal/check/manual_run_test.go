package check

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestManualMilkThroughWebPersistsAfterRestart(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string)) (string, int, error) {
		return "46.24 inches", 9, nil
	}}
	dir := t.TempDir()
	s, err := NewWithTransport(dir, transport)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(Config{DailyLimit: 5}); err != nil {
		t.Fatal(err)
	}
	// A target does not need to be monitored for a manual check.
	if err := s.SetTarget(id, false); err != nil {
		t.Fatal(err)
	}
	h := s.Handler("secret")
	request := func(action string) *httptest.ResponseRecorder {
		body := `{"provider":"provider-a","model":"solo","action":"` + action + `","prompt":"milk"}`
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
			if result.Verdict != "passed" || result.Answer != "46.24 inches" || result.Tokens != 9 || result.Provider != "provider-a" {
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
	id := TargetID{Provider: "provider-a", Model: "solo"}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.state.Results = append(s.state.Results, Result{ID: "kept", Provider: id.Provider, Model: id.Model, Answer: "answer"})
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

func TestTransportSeamCoversChecksAndModelTrace(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	var mu sync.Mutex
	updates := 0
	transport := &fakeTransport{generate: func(_ context.Context, _ TargetID, _ string, progress func(string)) (string, int, error) {
		if progress != nil {
			progress("part")
			mu.Lock()
			updates++
			mu.Unlock()
		}
		return "46.24 inches", 7, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.SetCatalog([]Model{{Provider: id.Provider, ProviderName: "Provider A", Model: id.Model, Name: "Solo"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Trigger(id, "milk"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "passed" {
		t.Fatalf("quality check did not use transport: %+v", state.Results)
	}
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	calls, prompts := transport.snapshot()
	mu.Lock()
	progressUpdates := updates
	mu.Unlock()
	if len(calls) != 4 || progressUpdates != 1 {
		t.Fatalf("calls=%v updates=%d", calls, progressUpdates)
	}
	for _, call := range calls {
		if call != id {
			t.Fatalf("probe alias leaked to transport: %v", call)
		}
	}
	if prompts[0] != mustPrompt(t, "milk").Text || !strings.Contains(prompts[3], "1 到 355") {
		t.Fatalf("unexpected transport prompts: %v", prompts)
	}

	h := s.Handler("secret")
	r := httptest.NewRequest("GET", "/api/models", nil)
	r.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"provider":"provider-a"`) || !strings.Contains(w.Body.String(), `"model":"solo"`) {
		t.Fatalf("model catalog bypassed host catalog: %d %s", w.Code, w.Body.String())
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
