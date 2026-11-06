package check

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestManualCheckRecordsCompletionStates(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	for _, tc := range []struct {
		name     string
		gen      Generation
		verdict  string
		contains string
		usageNil bool
		finish   string
		errCode  string
	}{
		{"normal", Generation{Answer: "46.24 inches", Finish: "stop"}, "passed", "", true, "stop", ""},
		{"empty", Generation{Answer: " \n", Finish: "stop"}, "empty", "空回答", true, "stop", ""},
		{"truncated", Generation{Answer: "partial answer", Finish: "max-tokens"}, "truncated", "截断", true, "max-tokens", ""},
		{"aborted", Generation{Answer: "partial", Finish: "aborted", Error: &GenerationError{Code: "ABORTED", Message: "Request was aborted"}}, "unavailable", "检测已取消", true, "aborted", "ABORTED"},
		{"host-error", Generation{Answer: "partial", Finish: "error", Error: &GenerationError{Code: "RATE_LIMIT", Message: "quota exceeded"}}, "unavailable", "quota exceeded", true, "error", "RATE_LIMIT"},
		{"with-usage", Generation{Answer: "46.24 inches", Finish: "stop", Usage: usage(17)}, "passed", "", false, "stop", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := &fakeTransport{generate: func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
				return tc.gen, nil
			}}
			s := fixtureWithTransport(t, transport)
			if err := s.SetTarget(id, false); err != nil {
				t.Fatal(err)
			}
			if err := s.Trigger(id, "milk"); err != nil {
				t.Fatal(err)
			}
			waitIdle(t, s)
			state, _ := s.Snapshot()
			if len(state.Results) != 1 {
				t.Fatalf("record missing: %+v", state.Results)
			}
			result := state.Results[0]
			if result.Verdict != tc.verdict || !strings.Contains(result.Error, tc.contains) {
				t.Fatalf("verdict=%q error=%q", result.Verdict, result.Error)
			}
			if result.Finish != tc.finish || result.ErrorCode != tc.errCode {
				t.Fatalf("finish=%q error_code=%q", result.Finish, result.ErrorCode)
			}
			if (result.Usage == nil) != tc.usageNil {
				t.Fatalf("usage presence wrong: %+v", result.Usage)
			}
			if tc.verdict != "empty" && result.Answer != tc.gen.Answer && tc.name != "aborted" && tc.name != "host-error" {
				t.Fatalf("answer not persisted: %q", result.Answer)
			}
			if len(transport.calls) != 1 {
				t.Fatalf("completion state retried unexpectedly: %d", len(transport.calls))
			}
		})
	}
}

func TestIncrementsVisibleWhileCheckRuns(t *testing.T) {
	id := TargetID{Provider: "provider-a", Model: "solo"}
	started := make(chan struct{})
	release := make(chan struct{})
	transport := &fakeTransport{generate: func(_ context.Context, _ TargetID, _ string, progress func(string), _ GenerateParams) (Generation, error) {
		progress("partial")
		close(started)
		<-release
		return Generation{Answer: "partial 46.24 inches", Finish: "stop"}, nil
	}}
	s := fixtureWithTransport(t, transport)
	if err := s.SetTarget(id, false); err != nil {
		t.Fatal(err)
	}
	if err := s.Trigger(id, "milk"); err != nil {
		t.Fatal(err)
	}
	<-started
	deadline := time.Now().Add(3 * time.Second)
	for {
		state, _ := s.Snapshot()
		if len(state.Results) == 1 && state.Results[0].Answer == "partial" && state.Results[0].Verdict == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("increment not visible while running: %+v", state.Results)
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(release)
	waitIdle(t, s)
}
