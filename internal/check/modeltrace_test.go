package check

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestModelTraceBatchBudgetAndTargetIsolation(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string)) (string, int, error) {
		return "1,2,3", 12, nil
	}}
	s := fixtureWithTransport(t, transport)
	s.Configure(Config{DailyLimit: 3})
	s.SetTarget(id, true)
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	if err := s.TriggerModelTrace(id); err == nil {
		t.Fatal("concurrent probe accepted")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		state, _ := s.Snapshot()
		if len(state.Results) == 3 && state.Results[2].Verdict != "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("batch not completed")
		}
		time.Sleep(10 * time.Millisecond)
	}
	state, _ := s.Snapshot()
	calls, prompts := transport.snapshot()
	if len(calls) != 3 || !state.Targets[0].Enabled {
		t.Fatal("wrong call count or monitoring changed")
	}
	seen := map[int]bool{}
	for _, result := range state.Results {
		if result.Batch != state.Results[0].Batch || result.Tokens != 12 || result.PromptText == "" || seen[result.ExpectedCount] {
			t.Fatal("batch metadata missing or challenge counts reused")
		}
		if result.Provider != id.Provider || result.Model != id.Model {
			t.Fatal("ModelTrace record lost composite identity")
		}
		if result.ExpectedCount < 292 || result.ExpectedCount > 332 {
			t.Fatal("invalid challenge length")
		}
		seen[result.ExpectedCount] = true
	}
	for _, prompt := range prompts {
		if !strings.Contains(prompt, "1 到 355") {
			t.Fatal("independent probe payload invalid")
		}
	}
	if err := s.TriggerModelTrace(id); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatal("budget exceeded", err)
	}
	if len(calls) != 3 {
		t.Fatal("over-budget request sent")
	}
}

func TestModelTraceAssetsRequireAuthentication(t *testing.T) {
	s := fixture(t)
	h := s.Handler("secret")
	for _, path := range []string{"/modeltrace/panel.js", "/modeltrace/fingerprint-core.js", "/modeltrace/unified_bank.json"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatal("unauthenticated asset exposed", path)
		}
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer secret")
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.Len() == 0 {
			t.Fatal("asset missing", path)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 204 || w.Body.Len() != 0 || w.Header().Get("X-Magpie-Quality") != "ready" {
		t.Fatal("invalid health probe")
	}
}
