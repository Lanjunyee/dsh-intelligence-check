package check

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCompositeTargetsAndCatalogPersistIndependently(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	catalog := []Model{
		{Provider: "provider-one", ProviderName: "Provider One", Model: "shared-model", Name: "Shared Model"},
		{Provider: "provider-two", ProviderName: "Provider Two", Model: "shared-model", Name: "Shared Model"},
	}
	if err := s.SetCatalog(catalog); err != nil {
		t.Fatal(err)
	}
	h := s.Handler("control")
	post := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer control")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, provider := range []string{"provider-one", "provider-two"} {
		w := post("/api/target", `{"provider":"`+provider+`","model":"shared-model"}`)
		if w.Code != 200 {
			t.Fatalf("%s target rejected: %d %s", provider, w.Code, w.Body.String())
		}
	}
	state, _ := s.Snapshot()
	if len(state.Targets) != 2 {
		t.Fatalf("same model names merged: %+v", state.Targets)
	}
	for _, target := range state.Targets {
		if target.Enabled {
			t.Fatal("adding a target enabled monitoring by default")
		}
	}
	if w := post("/api/config/initial", `{}`); w.Code == http.StatusOK {
		t.Fatal("legacy connection initialization still exposed", w.Code)
	}
	if w := post("/api/connection/check", `{}`); w.Code == http.StatusOK {
		t.Fatal("legacy connection check still exposed", w.Code)
	}
	s.Close()

	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	state, _ = restored.Snapshot()
	if len(state.Targets) != 2 {
		t.Fatalf("composite targets lost across restart: %+v", state.Targets)
	}
	seen := map[string]bool{}
	for _, target := range state.Targets {
		seen[target.Provider+"|"+target.Model] = true
		if target.Enabled {
			t.Fatal("restart enabled monitoring")
		}
	}
	if !seen["provider-one|shared-model"] || !seen["provider-two|shared-model"] {
		t.Fatalf("target identity lost: %+v", state.Targets)
	}
	if err := restored.SetCatalog(catalog); err != nil {
		t.Fatal(err)
	}
	h = restored.Handler("control")
	r := httptest.NewRequest("GET", "/api/models", nil)
	r.Header.Set("Authorization", "Bearer control")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	for _, want := range []string{`"provider":"provider-one"`, `"provider":"provider-two"`, `"model":"shared-model"`} {
		if !strings.Contains(w.Body.String(), want) {
			t.Fatalf("catalog missing %s: %s", want, w.Body.String())
		}
	}
}

func TestCatalogPushRequiresControlAndStateHasNoGatewayConfig(t *testing.T) {
	s := fixture(t)
	a := NewAccess("control", "http://example.com")
	session, _ := a.Exchange(a.Ticket())
	h := s.ManagedHandler(a, nil)
	body := `{"models":[{"provider":"p","model":"m","name":"M"}]}`
	r := httptest.NewRequest("POST", "/api/catalog", strings.NewReader(body))
	r.AddCookie(&http.Cookie{Name: "quality_session", Value: session})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatal("browser can replace the host catalog", w.Code)
	}
	r = httptest.NewRequest("POST", "/api/catalog", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer control")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	r = httptest.NewRequest("GET", "/api/state", nil)
	r.AddCookie(&http.Cookie{Name: "quality_session", Value: session})
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if _, ok := response["gateway_configured"]; ok {
		t.Fatal("gateway configuration is still reported")
	}
	if strings.Contains(w.Body.String(), "gateway") {
		t.Fatalf("gateway configuration leaked into state: %s", w.Body.String())
	}
	catalog, _ := response["catalog"].([]any)
	if len(catalog) != 1 {
		t.Fatalf("catalog missing from state: %v", response["catalog"])
	}
	if err := s.Configure(Config{DailyLimit: 7}); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if state.Config.DailyLimit != 7 {
		t.Fatal("budget not saved")
	}
}

type gatedTransport struct {
	mu      sync.Mutex
	started map[TargetID]chan struct{}
	release map[TargetID]chan struct{}
	answers map[TargetID]string
}

func (g *gatedTransport) Generate(ctx context.Context, id TargetID, _ string, _ func(string)) (string, int, error) {
	g.mu.Lock()
	started := g.started[id]
	release := g.release[id]
	answer := g.answers[id]
	g.mu.Unlock()
	if started != nil {
		close(started)
	}
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return "", 0, ctx.Err()
		}
	}
	return answer, 3, nil
}

func TestRunCancelAndBudgetUseProviderAndModelIdentity(t *testing.T) {
	one := TargetID{Provider: "provider-one", Model: "shared-model"}
	two := TargetID{Provider: "provider-two", Model: "shared-model"}
	transport := &gatedTransport{
		started: map[TargetID]chan struct{}{one: make(chan struct{}), two: make(chan struct{})},
		release: map[TargetID]chan struct{}{one: make(chan struct{}), two: make(chan struct{})},
		answers: map[TargetID]string{one: "46.24 inches", two: "46.24 inches"},
	}
	s, err := NewWithTransport(t.TempDir(), transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Configure(Config{DailyLimit: 5}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []TargetID{one, two} {
		if err := s.SetTarget(id, false); err != nil {
			t.Fatal(err)
		}
		if err := s.Trigger(id, "milk"); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-transport.started[one]:
	case <-time.After(3 * time.Second):
		t.Fatal("provider-one check did not start")
	}
	select {
	case <-transport.started[two]:
	case <-time.After(3 * time.Second):
		t.Fatal("same model at provider-two was blocked")
	}
	if err := s.CancelTest(one); err != nil {
		t.Fatal(err)
	}
	close(transport.release[two])
	waitIdle(t, s)
	state, _ := s.Snapshot()
	if len(state.Results) != 2 {
		t.Fatalf("results lost: %+v", state.Results)
	}
	byProvider := map[string]Result{}
	for _, result := range state.Results {
		byProvider[result.Provider] = result
	}
	if byProvider["provider-one"].Error != "检测已取消" || byProvider["provider-two"].Verdict != "passed" {
		t.Fatalf("cancel crossed provider identity: %+v", state.Results)
	}
}

func TestBudgetAndDeleteUseCompositeIdentity(t *testing.T) {
	one := TargetID{Provider: "provider-one", Model: "shared-model"}
	two := TargetID{Provider: "provider-two", Model: "shared-model"}
	transport := &gatedTransport{answers: map[TargetID]string{one: "46.24 inches", two: "46.24 inches"}}
	s, err := NewWithTransport(t.TempDir(), transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Configure(Config{DailyLimit: 1}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []TargetID{one, two} {
		if err := s.SetTarget(id, false); err != nil {
			t.Fatal(err)
		}
		if err := s.Trigger(id, "milk"); err != nil {
			t.Fatal(err)
		}
		waitIdle(t, s)
	}
	if err := s.Trigger(one, "milk"); err == nil || !strings.Contains(err.Error(), "预算") {
		t.Fatal("provider-one budget not exhausted", err)
	}
	if err := s.DeleteTarget(one); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if len(state.Targets) != 1 || state.Targets[0].Provider != "provider-two" {
		t.Fatalf("delete removed the wrong provider identity: %+v", state.Targets)
	}
	if state.Results[0].Provider == "" || state.Results[1].Provider == "" {
		t.Fatal("results do not retain provider identity")
	}
}
