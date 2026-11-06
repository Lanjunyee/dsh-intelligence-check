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
	transport := &fakeTransport{generate: func(ctx context.Context, _ TargetID, _ string, _ func(string)) (string, int, error) {
		close(started)
		<-ctx.Done()
		return "", 0, ctx.Err()
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
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string)) (string, int, error) {
		return "manual answer", 0, nil
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
