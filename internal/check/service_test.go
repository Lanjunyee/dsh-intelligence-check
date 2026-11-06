package check

import (
	"net/http/httptest"
	"testing"
	"time"
)

func fixture(t *testing.T) *Service {
	t.Helper()
	d := t.TempDir()
	s, e := New(d)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	return s
}

func TestTargetAndRecordPersistence(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	id := TargetID{Provider: "provider-a", Model: "solo"}
	if err := s.SetTarget(id, true); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.state.Results = append(s.state.Results, Result{ID: "one", Provider: id.Provider, Model: id.Model, Answer: "answer", Time: time.Now()})
	err = s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ := restored.Snapshot()
	if len(state.Targets) != 1 || !state.Targets[0].Enabled || len(state.Results) != 1 || state.Results[0].Answer != "answer" {
		t.Fatal("target or record lost across restart")
	}
	if state.Targets[0].Provider != "provider-a" || state.Results[0].Provider != "provider-a" {
		t.Fatal("provider identity lost")
	}
	if _, health := restored.Snapshot(); health != "" {
		t.Fatal(health)
	}
}

func TestGrade(t *testing.T) {
	for _, tt := range []struct{ a, w string }{{"Answer: **46.24 inches**.", "passed"}, {"46.24 inches is incorrect. Final: 48 inches.", "failed"}, {"48 inches", "failed"}, {"46.24", "passed"}, {"Example: 46.24, but my final answer is 48.", "failed"}} {
		if got := Grade("milk", tt.a); got != tt.w {
			t.Fatalf("%q: %s", tt.a, got)
		}
	}
}

func TestHTTPAuthentication(t *testing.T) {
	s := fixture(t)
	h := s.Handler("secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("GET", "/api/state", nil)
	r.Header.Set("Authorization", "Bearer secret")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
}
