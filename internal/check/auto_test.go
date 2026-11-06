package check

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func waitForCalls(t *testing.T, transport *fakeTransport, want int) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for {
		calls, _ := transport.snapshot()
		if len(calls) >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("automatic check did not reach %d call(s), got %d", want, len(calls))
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAutomaticCheckDefaultsOffAndPersistsSettings(t *testing.T) {
	dir := t.TempDir()
	s, err := NewWithTransport(dir, &fakeTransport{})
	if err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if state.Config.AutoEnabled {
		t.Fatal("automatic check was enabled by default")
	}
	if state.Config.IntervalSeconds != 900 {
		t.Fatalf("default interval = %d, want 900", state.Config.IntervalSeconds)
	}
	if err := s.Configure(Config{DailyLimit: 7, AutoEnabled: true, IntervalSeconds: 2}); err != nil {
		t.Fatal(err)
	}
	s.Close()

	restored, err := NewWithTransport(dir, &fakeTransport{})
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ = restored.Snapshot()
	if !state.Config.AutoEnabled || state.Config.IntervalSeconds != 2 || state.Config.DailyLimit != 7 {
		t.Fatalf("automatic settings lost across restart: %+v", state.Config)
	}
}

func TestAutomaticCheckRejectsInvalidInterval(t *testing.T) {
	s := fixtureWithTransport(t, &fakeTransport{})
	if err := s.Configure(Config{DailyLimit: 120, IntervalSeconds: 86401}); err == nil {
		t.Fatal("accepted an interval longer than one day")
	}
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: -1}); err == nil {
		t.Fatal("accepted a negative interval")
	}
}

func TestAutomaticCheckRunsMilkOnlyForMonitoredTargets(t *testing.T) {
	watched := TargetID{Provider: "provider-a", Model: "watched"}
	unwatched := TargetID{Provider: "provider-a", Model: "unwatched"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(watched, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(unwatched, false); err != nil {
		t.Fatal(err)
	}
	waitForCalls(t, transport, 1)
	time.Sleep(1200 * time.Millisecond)
	calls, prompts := transport.snapshot()
	if len(calls) == 0 {
		t.Fatal("no automatic check ran without a business conversation")
	}
	milk := mustPrompt(t, "milk")
	for i := range calls {
		if calls[i] != watched {
			t.Fatalf("automatic check called unmonitored target %+v", calls[i])
		}
		if prompts[i] != milk.Text {
			t.Fatalf("automatic check used prompt %q instead of milk", prompts[i])
		}
	}
}

func TestTurningOffAutomaticCheckStopsFurtherCalls(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	waitForCalls(t, transport, 1)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: false, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	calls, _ := transport.snapshot()
	time.Sleep(1300 * time.Millisecond)
	after, _ := transport.snapshot()
	if len(after) != len(calls) {
		t.Fatalf("automatic checks continued after disabling: %d -> %d", len(calls), len(after))
	}
}

func TestRemovingMonitoredTargetStopsFurtherCalls(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	waitForCalls(t, transport, 1)
	waitIdle(t, s)
	if err := s.DeleteTarget(id); err != nil {
		t.Fatal(err)
	}
	calls, _ := transport.snapshot()
	time.Sleep(1300 * time.Millisecond)
	after, _ := transport.snapshot()
	if len(after) != len(calls) {
		t.Fatalf("automatic checks continued after removing the target: %d -> %d", len(calls), len(after))
	}
}

func TestAutomaticMilkRetestKeepsIndependentRecords(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		return Generation{Answer: "48 inches", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	waitForCalls(t, transport, 2)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: false, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 2 {
		t.Fatalf("automatic retest records = %d, want 2", len(state.Results))
	}
	if state.Results[0].ID == state.Results[1].ID || state.Results[0].Verdict != "failed" || state.Results[1].Verdict != "failed" {
		t.Fatalf("automatic retest did not keep independent failed records: %+v", state.Results)
	}
	_, prompts := transport.snapshot()
	milk := mustPrompt(t, "milk")
	for _, prompt := range prompts {
		if prompt != milk.Text {
			t.Fatalf("automatic retest used %q instead of milk", prompt)
		}
	}
}

func TestAutomaticAndManualChecksForSameTargetMerge(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		once.Do(func() { close(started) })
		<-release
		return Generation{Answer: "46.24 inches", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(4 * time.Second):
		t.Fatal("automatic check did not start")
	}
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: false, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.Trigger(id, "milk"); err == nil || !strings.Contains(err.Error(), "已有检测") {
		t.Fatalf("manual check was not merged with the automatic check: %v", err)
	}
	close(release)
	waitIdle(t, s)
	calls, _ := transport.snapshot()
	if len(calls) != 1 {
		t.Fatalf("merged checks produced %d model calls", len(calls))
	}
}

func TestAutomaticCheckStopsWhenBudgetIsSpentAndClearingHistoryKeepsIt(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.Configure(Config{DailyLimit: 1, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	waitForCalls(t, transport, 1)
	waitIdle(t, s)
	time.Sleep(1200 * time.Millisecond)
	calls, _ := transport.snapshot()
	if len(calls) != 1 {
		t.Fatalf("automatic checks continued after exhausting the budget: %d", len(calls))
	}
	if err := s.Trigger(id, "milk"); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatalf("manual check bypassed the spent budget: %v", err)
	}
	state, _ := s.Snapshot()
	if len(state.Results) != 1 {
		t.Fatalf("unexpected records: %+v", state.Results)
	}
	if err := s.ClearResults([]string{state.Results[0].ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.Trigger(id, "milk"); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatalf("clearing history returned spent budget: %v", err)
	}
}

func TestCloseStopsAutomaticTimerAndCancelsActiveCall(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	started := make(chan struct{})
	cancelled := make(chan struct{})
	var calls atomic.Int32
	var once sync.Once
	var cancelOnce sync.Once
	transport := &fakeTransport{generate: func(ctx context.Context, _ TargetID, _ string, _ func(string), _ GenerateParams) (Generation, error) {
		calls.Add(1)
		once.Do(func() { close(started) })
		<-ctx.Done()
		cancelOnce.Do(func() { close(cancelled) })
		return Generation{Answer: "partial"}, ctx.Err()
	}}
	s, err := NewWithTransport(t.TempDir(), transport)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(4 * time.Second):
		t.Fatal("automatic check did not start")
	}
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("service close did not finish")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("active automatic call was not cancelled")
	}
	stopped := calls.Load()
	time.Sleep(1200 * time.Millisecond)
	if calls.Load() != stopped {
		t.Fatal("automatic timer kept calling after close")
	}
}

func TestInvalidAutomaticSettingsDoNotStartChecks(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 0}); err != nil {
		t.Fatalf("zero interval should fall back to the default: %v", err)
	}
	state, _ := s.Snapshot()
	if state.Config.IntervalSeconds != 900 {
		t.Fatalf("interval = %d, want the 900 second default", state.Config.IntervalSeconds)
	}
	if err := s.Configure(Config{DailyLimit: 120, AutoEnabled: true, IntervalSeconds: 86401}); err == nil {
		t.Fatal("invalid interval was accepted")
	}
}
