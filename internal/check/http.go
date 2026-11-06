package check

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

//go:embed web/*
var web embed.FS

func (s *Service) Handler(token string) http.Handler {
	return s.ManagedHandler(NewAccess(token, ""), nil)
}
func (s *Service) ManagedHandler(access *Access, console *Console) http.Handler {
	mux := http.NewServeMux()
	root, _ := fs.Sub(web, "web")
	mux.Handle("GET /assets/", http.FileServer(http.FS(root)))
	mux.HandleFunc("GET /modeltrace/{file}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("file")
		if name != "fingerprint-core.js" && name != "unified_bank.json" && name != "panel.js" {
			http.NotFound(w, r)
			return
		}
		b, err := web.ReadFile("web/modeltrace/" + name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(name, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		} else {
			w.Header().Set("Content-Type", "application/json")
		}
		w.Write(b)
	})
	mux.HandleFunc("POST /api/console", func(w http.ResponseWriter, r *http.Request) {
		if console == nil {
			http.Error(w, "控制台管理未启用", 503)
			return
		}
		var input struct {
			Remote bool   `json:"remote"`
			Binary string `json:"binary"`
		}
		if !decode(w, r, &input) {
			return
		}
		if input.Binary != "" {
			console.SetBinary(input.Binary)
		}
		link, err := console.Open(r.Context(), input.Remote)
		if err != nil {
			http.Error(w, err.Error(), 503)
			return
		}
		writeJSON(w, map[string]string{"url": link})
	})
	mux.HandleFunc("POST /api/console/close", func(w http.ResponseWriter, r *http.Request) {
		if console != nil {
			// Let the tunnel deliver the acknowledgement before ending transport.
			time.AfterFunc(300*time.Millisecond, console.Close)
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		b, _ := web.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(b)
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		state, health := s.Snapshot()
		writeJSON(w, map[string]any{"state": state, "health": health, "catalog": s.Catalog(), "prompts": Prompts, "guidance": Guidance})
	})
	mux.HandleFunc("POST /api/catalog", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Models []Model `json:"models"`
		}
		if !decode(w, r, &input) {
			return
		}
		if err := s.SetCatalog(input.Models); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/results/{id}/download", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		var result *Result
		for _, v := range s.state.Results {
			if v.ID == r.PathValue("id") {
				copy := v
				result = &copy
				break
			}
		}
		s.mu.Unlock()
		if result == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="result-`+result.ID+`.txt"`)
		io.WriteString(w, result.Answer)
	})
	mux.HandleFunc("GET /api/results/{id}/preview", s.htmlPreview)
	mux.HandleFunc("POST /api/results/clear", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs []string `json:"ids"`
		}
		if !decode(w, r, &input) {
			return
		}
		if err := s.ClearResults(input.IDs); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/results/{id}/review", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Decision string `json:"decision"`
			Note     string `json:"note"`
		}
		if !decode(w, r, &input) {
			return
		}
		if err := s.ReviewResult(r.PathValue("id"), input.Decision, input.Note); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/target/delete", func(w http.ResponseWriter, r *http.Request) {
		var input TargetID
		if !decode(w, r, &input) {
			return
		}
		if err := s.DeleteTarget(input); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/models", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.Catalog())
	})
	mux.HandleFunc("POST /api/config", func(w http.ResponseWriter, r *http.Request) {
		var c Config
		if !decode(w, r, &c) {
			return
		}
		if err := s.Configure(c); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/target", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
			Enabled  bool   `json:"enabled"`
		}
		if !decode(w, r, &input) {
			return
		}
		if err := s.SetTarget(TargetID{Provider: input.Provider, Model: input.Model}, input.Enabled); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/action", func(w http.ResponseWriter, r *http.Request) {
		var a struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
			Action   string `json:"action"`
			Prompt   string `json:"prompt"`
		}
		if !decode(w, r, &a) {
			return
		}
		id := TargetID{Provider: a.Provider, Model: a.Model}
		var err error
		if a.Action == "cancel-test" {
			err = s.CancelTest(id)
		} else if a.Action == "cancel-modeltrace" {
			err = s.CancelModelTrace(id)
		} else if a.Action == "modeltrace" {
			err = s.TriggerModelTrace(id)
		} else if a.Action == "test" {
			if a.Prompt == "" {
				a.Prompt = "milk"
			}
			err = s.Trigger(id, a.Prompt)
		} else {
			err = errors.New("未知操作")
		}
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; frame-src 'self'; frame-ancestors 'none'; connect-src 'self'")
		// A public readiness probe exposes no management state or credentials.
		if r.Method == "GET" && r.URL.Path == "/health" {
			w.Header().Set("X-DSH-Intelligence-Check", "ready")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		supplied := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		cookie, e := r.Cookie("quality_session")
		if e == nil && supplied == "" {
			supplied = cookie.Value
		}
		if strings.HasPrefix(r.URL.Path, "/open/") && r.Method == "GET" {
			if !access.Origin("http://"+r.Host) && !access.Origin("https://"+r.Host) {
				http.Error(w, "管理域名不匹配", 403)
				return
			}
			session, valid := access.Exchange(strings.TrimPrefix(r.URL.Path, "/open/"))
			if !valid {
				http.Error(w, "管理链接已失效，请重新启动入口", 401)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "quality_session", Value: session, Path: "/", HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode, MaxAge: 1800})
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		control := subtle.ConstantTimeCompare([]byte(supplied), []byte(access.control)) == 1
		if !control && !access.Session(supplied) {
			http.Error(w, "请使用插件生成的完整管理链接", 401)
			return
		}
		if r.URL.Path == "/api/catalog" && !control {
			http.Error(w, "仅插件可同步宿主模型目录", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/console") && !control {
			if r.URL.Path != "/api/console/close" {
				http.Error(w, "仅插件可签发管理入口", 403)
				return
			}
		}
		if r.Method != "GET" {
			origin := r.Header.Get("Origin")
			if origin != "" && !access.Origin(origin) {
				http.Error(w, "Origin 不匹配", 403)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	if err := d.Decode(v); err != nil {
		http.Error(w, "无效请求", 400)
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		http.Error(w, "无效请求", 400)
		return false
	}
	return true
}
