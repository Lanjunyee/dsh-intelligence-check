package check

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConfigStoresDetectionSettingsWithoutLegacyCredentials(t *testing.T) {
	s := fixture(t)
	if err := s.Configure(Config{DailyLimit: 0}); err == nil {
		t.Fatal("accepted an invalid budget")
	}
	if err := s.Configure(Config{DailyLimit: 45}); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if state.Config.DailyLimit != 45 {
		t.Fatal("budget not saved")
	}
	if state.Config.AutoEnabled || state.Config.IntervalSeconds != 900 {
		t.Fatalf("automatic settings defaults changed: %+v", state.Config)
	}
	body, _ := json.Marshal(state.Config)
	if strings.Contains(string(body), "gateway") || strings.Contains(string(body), "key") {
		t.Fatalf("legacy model credential config remains: %s", body)
	}
}

func TestManagedAssetsRequireAuthentication(t *testing.T) {
	s := fixture(t)
	a := NewAccess("control", "http://example.com")
	session, _ := a.Exchange(a.Ticket())
	h := s.ManagedHandler(a, nil)
	for _, asset := range []string{"/assets/app.js", "/assets/app.css", "/assets/icon.png", "/assets/fonts/space-mono-regular.ttf"} {
		r := httptest.NewRequest("GET", asset, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatal("public asset", asset, w.Code)
		}
		r.AddCookie(&http.Cookie{Name: "quality_session", Value: session})
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Body.Len() == 0 {
			t.Fatal("asset missing", asset, w.Code)
		}
	}
}
