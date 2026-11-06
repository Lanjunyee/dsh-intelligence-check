package check

import (
	"testing"
	"time"
)

func TestRestartMarksUnfinishedChecksUnavailable(t *testing.T) {
	dir := t.TempDir()
	id := TargetID{Provider: "provider-a", Model: "solo"}
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.SetTarget(id, true)
	s.mu.Lock()
	s.state.Results = append(s.state.Results, Result{ID: "running", Provider: id.Provider, Model: id.Model, Prompt: "milk", Verdict: "running", Time: time.Now()})
	if err := s.saveLocked(); err != nil {
		t.Fatal(err)
	}
	s.mu.Unlock()
	s.Close()
	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ := restored.Snapshot()
	if len(state.Results) != 1 || state.Results[0].Verdict != "unavailable" || state.Results[0].Error == "" {
		t.Fatalf("unfinished check not closed on restart: %+v", state.Results)
	}
	if len(state.Targets) != 1 || !state.Targets[0].Enabled {
		t.Fatal("target monitoring lost")
	}
}
