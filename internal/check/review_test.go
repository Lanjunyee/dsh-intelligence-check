package check

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestCancelQualityRequest(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	started := make(chan struct{})
	transport := &fakeTransport{generate: func(ctx context.Context, _ TargetID, _ string, _ func(string), _ GenerateParams) (Generation, error) {
		close(started)
		<-ctx.Done()
		return Generation{}, ctx.Err()
	}}
	s := fixtureWithTransport(t, transport)
	s.Configure(Config{DailyLimit: 20})
	s.SetTarget(id, true)
	if err := s.Trigger(id, "milk"); err != nil {
		t.Fatal(err)
	}
	<-started
	if err := s.CancelTest(id); err != nil {
		t.Fatal(err)
	}
	s.wg.Wait()
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Error != "检测已取消" {
		t.Fatal(state.Results)
	}
	if s.CancelTest(id) == nil {
		t.Fatal("completed test remained cancellable")
	}
}

func TestClearHistoryPreservesCompositeBudget(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	s := fixture(t)
	s.Configure(Config{DailyLimit: 1})
	s.SetTarget(id, true)
	s.state.Results = append(s.state.Results, Result{ID: "old", Provider: id.Provider, Model: id.Model, Time: time.Now(), Answer: "private"})
	s.running[id] = true
	if s.ClearResults([]string{"old"}) == nil {
		t.Fatal("cleared while running")
	}
	delete(s.running, id)
	if err := s.ClearResults([]string{"old"}); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if len(state.Results) != 0 {
		t.Fatal(state)
	}
	if err := s.Trigger(id, "repeat"); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatal("clearing restored budget", err)
	}
	var stored State
	day := time.Now().UTC().Format("2006-01-02")
	if err := s.store.Load(&stored); err != nil || stored.ClearedUsage[day]["provider-a"]["solo"] != 1 {
		t.Fatal("budget not persisted", err)
	}
}

func TestUnmonitoredTargetAllowsManualChecks(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		return Generation{Answer: "manual answer", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	s.Configure(Config{DailyLimit: 20})
	s.SetTarget(id, false)
	if err := s.Trigger(id, "repeat"); err != nil {
		t.Fatal(err)
	}
	s.wg.Wait()
	if err := s.TriggerModelTrace(id); err != nil {
		t.Fatal(err)
	}
	s.wg.Wait()
	state, _ := s.Snapshot()
	if len(state.Results) != 4 || state.Targets[0].Enabled {
		t.Fatal("manual test changed monitoring")
	}
}

func TestReviewPersistsWithoutChangingVerdict(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	s := fixture(t)
	s.SetTarget(id, true)
	s.state.Results = append(s.state.Results, Result{ID: "answer", Provider: id.Provider, Model: id.Model, Prompt: "repeat", Answer: "original", Verdict: "manual", Time: time.Now()})
	if err := s.ReviewResult("answer", "accepted", "checked"); err != nil {
		t.Fatal(err)
	}
	var stored State
	if err := s.store.Load(&stored); err != nil {
		t.Fatal(err)
	}
	r := stored.Results[0]
	if r.Answer != "original" || r.Verdict != "manual" || r.Review != "accepted" || r.ReviewNote != "checked" || r.ReviewedAt.IsZero() {
		t.Fatal(r)
	}
	if s.ReviewResult("answer", "passed", "") == nil || s.ReviewResult("missing", "pending", "") == nil {
		t.Fatal("invalid review accepted")
	}
	s.state.Results = append(s.state.Results, Result{ID: "running", Verdict: "running"})
	if s.ReviewResult("running", "accepted", "") == nil {
		t.Fatal("reviewed pending answer")
	}
}

func TestReviewPersistsSeparatelyFromAutomaticEvaluationAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	one := TargetID{Provider: "provider-one", Model: "shared-model"}
	two := TargetID{Provider: "provider-two", Model: "shared-model"}
	for _, id := range []TargetID{one, two} {
		if err := s.SetTarget(id, false); err != nil {
			t.Fatal(err)
		}
	}
	s.state.Results = append(s.state.Results,
		Result{ID: "one-run", Provider: one.Provider, Model: one.Model, Prompt: "milk", Answer: "46.24 inches", Verdict: "passed", Time: time.Now()},
		Result{ID: "two-run", Provider: two.Provider, Model: two.Model, Prompt: "milk", Answer: "48 inches", Verdict: "failed", Time: time.Now()},
	)
	s.mu.Lock()
	err = s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ReviewResult("two-run", "rejected", "忽略子代自身消化能力"); err != nil {
		t.Fatal(err)
	}
	s.Close()

	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ := restored.Snapshot()
	byID := map[string]Result{}
	for _, result := range state.Results {
		byID[result.ID] = result
	}
	oneRun, twoRun := byID["one-run"], byID["two-run"]
	if oneRun.Provider != one.Provider || oneRun.Verdict != "passed" || oneRun.Review != "" {
		t.Fatalf("automatic evaluation changed after restart: %+v", oneRun)
	}
	if twoRun.Provider != two.Provider || twoRun.Verdict != "failed" || twoRun.Review != "rejected" || twoRun.ReviewNote != "忽略子代自身消化能力" || twoRun.ReviewedAt.IsZero() {
		t.Fatalf("human review lost or merged after restart: %+v", twoRun)
	}
}

func TestDeleteTargetPreservesHistory(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	s := fixture(t)
	s.SetTarget(id, true)
	s.state.Results = append(s.state.Results, Result{ID: "old", Provider: id.Provider, Model: id.Model, Answer: "kept"})
	s.running[id] = true
	if s.DeleteTarget(id) == nil {
		t.Fatal("deleted active target")
	}
	delete(s.running, id)
	if err := s.DeleteTarget(id); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if len(state.Targets) != 0 || len(state.Results) != 1 {
		t.Fatal("history removed or target retained")
	}
}
