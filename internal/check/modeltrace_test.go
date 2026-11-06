package check

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestModelTraceCancelAbortsActiveCallAndSkipsUnstarted(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	started := make(chan struct{})
	var calls atomic.Int32
	transport := &fakeTransport{generate: func(ctx context.Context, _ TargetID, _ string, _ func(string), _ GenerateParams) (Generation, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			return Generation{Answer: "partial", Finish: "aborted", Error: &GenerationError{Code: "ABORTED", Message: "Request was aborted"}}, ctx.Err()
		}
		return Generation{Answer: "1,2,3", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 10}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	<-started
	if err := s.CancelModelTrace(id); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 3 {
		t.Fatalf("cancelled batch lost entries: %+v", state.Results)
	}
	for _, result := range state.Results {
		if result.Batch != state.Results[0].Batch {
			t.Fatal("cancelled batch lost batch association")
		}
	}
	active := state.Results[0]
	if active.Verdict != "cancelled" || active.Error != "检测已取消" || active.Answer != "partial" || active.Finish != "aborted" || active.ErrorCode != "ABORTED" {
		t.Fatalf("active challenge not explained: %+v", active)
	}
	for _, skipped := range state.Results[1:] {
		if skipped.Verdict != "skipped" || !strings.Contains(skipped.Error, "未开始") || skipped.Answer != "" {
			t.Fatalf("unstarted challenge not explained: %+v", skipped)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("cancel did not stop unstarted challenges: %d calls", calls.Load())
	}
	s.mu.Lock()
	counted := s.dayCountLocked(id, time.Now().UTC().Format("2006-01-02"))
	s.mu.Unlock()
	if counted != 1 {
		t.Fatalf("unstarted requests counted against budget: %d", counted)
	}
}

func TestModelTraceFailureKeepsEveryEntryExplainable(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	var calls atomic.Int32
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		if calls.Add(1) == 1 {
			return Generation{Answer: "partial", Finish: "error", Error: &GenerationError{Code: "RATE_LIMIT", Message: "quota exceeded"}}, nil
		}
		return Generation{Answer: "1,2,3", Usage: usage(5), Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 10}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 3 {
		t.Fatalf("failed batch lost entries: %+v", state.Results)
	}
	failed := state.Results[0]
	if failed.Verdict != "unavailable" || failed.Error != "quota exceeded" || failed.Finish != "error" || failed.ErrorCode != "RATE_LIMIT" || failed.Answer != "partial" {
		t.Fatalf("failed challenge not explained: %+v", failed)
	}
	for _, result := range state.Results[1:] {
		if result.Verdict != "manual" || result.Answer != "1,2,3" {
			t.Fatalf("independent challenge did not keep its raw answer: %+v", result)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("failure stopped independent challenges: %d calls", calls.Load())
	}
}

func TestModelTraceInvalidAnswerKeepsRawText(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		return Generation{Answer: "I cannot complete this task.", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 3 {
		t.Fatalf("invalid batch lost entries: %+v", state.Results)
	}
	for _, result := range state.Results {
		if result.Verdict != "manual" || result.Answer != "I cannot complete this task." || result.Finish != "stop" {
			t.Fatalf("invalid answer not preserved for attribution review: %+v", result)
		}
	}
}

func TestModelTraceBudgetRejectionCreatesNoRequests(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 2}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.TriggerModelTrace(id); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatalf("insufficient budget not explained: %v", err)
	}
	state, _ := s.Snapshot()
	calls, _ := transport.snapshot()
	if len(state.Results) != 0 || len(calls) != 0 {
		t.Fatalf("budget rejection created requests: results=%d calls=%d", len(state.Results), len(calls))
	}
}

func TestModelTraceBatchBudgetAndTargetIsolation(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		return Generation{Answer: "1,2,3", Usage: usage(12), Finish: "stop"}, nil
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
		if result.Batch != state.Results[0].Batch || result.Usage == nil || *result.Usage.TotalTokens != 12 || result.PromptText == "" || seen[result.ExpectedCount] {
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
	transport.mu.Lock()
	params := append([]GenerateParams(nil), transport.params...)
	transport.mu.Unlock()
	for _, param := range params {
		if param.MaxTokens != DefaultMaxTokens {
			t.Fatalf("generation parameter lost: %+v", param)
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
