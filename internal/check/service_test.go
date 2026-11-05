package check

import (
	"context"
	"net/http"
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
	if err := s.SetTarget("a/solo", true); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.state.Results = append(s.state.Results, Result{ID: "one", Model: "a/solo", Answer: "answer", Time: time.Now()})
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
	if len(state.Targets) != 1 || !state.Targets["a/solo"].Enabled || len(state.Results) != 1 || state.Results[0].Answer != "answer" {
		t.Fatal("target or record lost across restart")
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
func TestClient(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("auth missing")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"46.24 inches"},"finish_reason":"stop"}],"usage":{"total_tokens":4}}`))
	}))
	defer up.Close()
	a, n, e := Call(context.Background(), Config{GatewayURL: up.URL, GatewayKey: "secret"}, "a/solo", "test")
	if e != nil || n != 4 || a != "46.24 inches" {
		t.Fatal(a, n, e)
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
