package check

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestDetectionLifecycleUsesTransportWithoutProbeAlias(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{}
	s := fixtureWithTransport(t, transport)
	s.Configure(Config{DailyLimit: 120})
	s.SetTarget(id, true)
	if err := s.Trigger(id, "milk"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "passed" || state.Results[0].Usage == nil || *state.Results[0].Usage.TotalTokens != 7 {
		t.Fatalf("results=%+v", state.Results)
	}
	if state.Results[0].Provider != id.Provider || state.Results[0].Model != id.Model {
		t.Fatalf("result lost composite identity: %+v", state.Results[0])
	}
	calls, prompts := transport.snapshot()
	milk, _ := FindPrompt("milk")
	if len(calls) != 1 || calls[0] != id || prompts[0] != milk.Text {
		t.Fatalf("transport calls=%v prompts=%v", calls, prompts)
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
	id := TargetID{Provider: "provider-a", Model: "solo"}
	for _, tc := range []struct {
		name   string
		answer string
		fail   bool
		limit  int
		want   string
		calls  int
	}{
		{"confirmed", "48 inches", false, 120, "failed", 2},
		{"limited", "", true, 120, "unavailable", 1},
		{"budget", "48 inches", false, 1, "failed", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
				calls.Add(1)
				if tc.fail {
					return Generation{}, errors.New("rate limited")
				}
				return Generation{Answer: tc.answer, Finish: "stop"}, nil
			}}
			s := fixtureWithTransport(t, transport)
			s.Configure(Config{DailyLimit: tc.limit})
			s.SetTarget(id, true)
			if err := s.Trigger(id, "milk"); err != nil {
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
	id := TargetID{Provider: "provider-a", Model: "solo"}
	transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
		return Generation{Answer: "<svg/>", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	s.Configure(Config{DailyLimit: 120})
	s.SetTarget(id, true)
	if err := s.Trigger(id, "svg"); err != nil {
		t.Fatal(err)
	}
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "manual" {
		t.Fatalf("manual prompt result: %+v", state.Results)
	}
	if !state.Targets[0].Enabled {
		t.Fatal("manual check changed monitoring")
	}
}
