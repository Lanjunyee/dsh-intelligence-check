package check

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Config struct {
	GatewayURL string `json:"gateway_url"`
	GatewayKey string `json:"gateway_key"`
	DailyLimit int    `json:"daily_limit"`
}
type Target struct {
	Model   string `json:"model"`
	Enabled bool   `json:"enabled"`
}
type Result struct {
	ID            string    `json:"id"`
	Model         string    `json:"model"`
	Prompt        string    `json:"prompt"`
	Answer        string    `json:"answer"`
	Verdict       string    `json:"verdict"`
	Error         string    `json:"error,omitempty"`
	Time          time.Time `json:"time"`
	Tokens        int       `json:"tokens"`
	Batch         string    `json:"batch,omitempty"`
	ExpectedCount int       `json:"expected_count,omitempty"`
	PromptText    string    `json:"prompt_text,omitempty"`
	Review        string    `json:"review,omitempty"`
	ReviewNote    string    `json:"review_note,omitempty"`
	ReviewedAt    time.Time `json:"reviewed_at,omitempty"`
}

func (s *Service) ReviewResult(id, decision, note string) error {
	if decision != "accepted" && decision != "rejected" && decision != "pending" {
		return errors.New("无效审核结论")
	}
	if len(note) > 4000 {
		return errors.New("审核备注不能超过 4000 字节")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Results {
		r := &s.state.Results[i]
		if r.ID != id {
			continue
		}
		if r.Verdict == "running" || r.Answer == "" {
			return errors.New("尚无可审核的回答")
		}
		previous := *r
		r.Review, r.ReviewNote, r.ReviewedAt = decision, note, time.Now()
		if err := s.store.Save(s.state); err != nil {
			*r = previous
			return err
		}
		return nil
	}
	return errors.New("检测记录不存在")
}

func (s *Service) DeleteTarget(model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[model] {
		return errors.New("模型正在检测，请完成后再删除")
	}
	t, ok := s.state.Targets[model]
	if !ok {
		return errors.New("模型未配置")
	}
	delete(s.state.Targets, model)
	if err := s.saveLocked(); err != nil {
		s.state.Targets[model] = t
		return err
	}
	return nil
}

type State struct {
	Config       Config                    `json:"config"`
	Targets      map[string]*Target        `json:"targets"`
	Results      []Result                  `json:"results"`
	ClearedUsage map[string]map[string]int `json:"cleared_usage,omitempty"`
}

func (s *Service) ClearResults(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.running) > 0 {
		return errors.New("检测进行中，请完成或取消后再清理记录")
	}
	selected := make(map[string]bool)
	for _, id := range ids {
		selected[id] = true
	}
	previous, _ := json.Marshal(s.state)
	if s.state.ClearedUsage == nil {
		s.state.ClearedUsage = make(map[string]map[string]int)
	}
	kept := make([]Result, 0, len(s.state.Results))
	for _, result := range s.state.Results {
		if !selected[result.ID] {
			kept = append(kept, result)
			continue
		}
		day := result.Time.UTC().Format("2006-01-02")
		if s.state.ClearedUsage[day] == nil {
			s.state.ClearedUsage[day] = make(map[string]int)
		}
		s.state.ClearedUsage[day][result.Model]++
	}
	s.state.Results = kept
	if err := s.store.Save(s.state); err != nil {
		json.Unmarshal(previous, &s.state)
		return err
	}
	return nil
}

type Service struct {
	mu          sync.Mutex
	state       State
	running     map[string]bool
	testCancels map[string]context.CancelFunc
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
	store       *Store
	transport   Transport
	health      string
}

func Secret() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func New(dir string) (*Service, error) {
	return newService(dir, nil)
}

// NewWithTransport replaces the gateway transport with a host-provided one.
func NewWithTransport(dir string, transport Transport) (*Service, error) {
	return newService(dir, transport)
}

func newService(dir string, transport Transport) (*Service, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	store, err := OpenStore(filepath.Join(dir, "check.db"))
	if err != nil {
		return nil, err
	}
	s := &Service{store: store, running: map[string]bool{}}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.state = State{Config: Config{DailyLimit: 120}, Targets: map[string]*Target{}, Results: []Result{}}
	if err := store.Load(&s.state); err != nil {
		store.Close()
		return nil, err
	}
	if transport == nil {
		transport = gatewayTransport{config: s.config}
	}
	s.transport = transport
	for i := range s.state.Results {
		if s.state.Results[i].Verdict == "running" {
			s.state.Results[i].Verdict = "unavailable"
			s.state.Results[i].Error = "检测服务重启，请重试"
		}
	}
	if err := s.saveLocked(); err != nil {
		store.Close()
		return nil, err
	}
	return s, nil
}

func (s *Service) Close() { s.cancel(); s.wg.Wait(); s.store.Close() }

func (s *Service) config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Config
}

func (s *Service) saveLocked() error {
	if err := s.store.Save(s.state); err != nil {
		s.health = err.Error()
		return err
	}
	s.health = ""
	return nil
}

func (s *Service) Snapshot() (State, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(s.state)
	var out State
	json.Unmarshal(b, &out)
	out.Config.GatewayKey = ""
	return out, s.health
}

func (s *Service) Configure(c Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.configureLocked(c)
}

func (s *Service) ConfigureInitial(c Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Config.GatewayURL != "" {
		return nil
	}
	return s.configureLocked(c)
}

func (s *Service) configureLocked(c Config) error {
	if c.GatewayKey == "" {
		c.GatewayKey = s.state.Config.GatewayKey
	}
	if c.DailyLimit < 1 || c.DailyLimit > 10000 {
		return errors.New("每日预算须为 1–10000 次")
	}
	if err := ValidateGateway(c.GatewayURL); err != nil {
		return err
	}
	if c.GatewayKey == "" {
		return errors.New("请输入 Magpie 网关 Key；本机默认 Key 为 magpie")
	}
	s.state.Config = c
	return s.saveLocked()
}

func (s *Service) SetTarget(model string, enabled bool) error {
	if model == "" || len(model) > 512 || strings.ContainsAny(model, "\r\n") {
		return errors.New("无效模型 ID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.state.Targets[model]
	if t == nil {
		t = &Target{Model: model}
		s.state.Targets[model] = t
	}
	t.Enabled = enabled
	return s.saveLocked()
}

func (s *Service) Trigger(model, prompt string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Targets[model] == nil {
		return errors.New("模型未配置")
	}
	if s.running[model] {
		return errors.New("该模型已有检测进行中，请完成后重试")
	}
	p, ok := FindPrompt(prompt)
	if !ok {
		return errors.New("未知题目")
	}
	day := time.Now().UTC().Format("2006-01-02")
	if s.dayCountLocked(model, day) >= s.state.Config.DailyLimit {
		return errors.New("每日请求预算已耗尽")
	}
	s.running[model] = true
	if s.testCancels == nil {
		s.testCancels = make(map[string]context.CancelFunc)
	}
	ctx, cancel := context.WithTimeout(s.ctx, 180*time.Second)
	s.testCancels[model] = cancel
	s.wg.Add(1)
	go s.run(ctx, model, p)
	return nil
}

func (s *Service) dayCountLocked(model, day string) int {
	count := s.state.ClearedUsage[day][model]
	for _, r := range s.state.Results {
		if r.Model == model && r.Time.UTC().Format("2006-01-02") == day {
			count++
		}
	}
	return count
}

func (s *Service) CancelTest(model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cancel := s.testCancels[model]
	if cancel == nil {
		return errors.New("该模型没有可取消的质量检测")
	}
	cancel()
	return nil
}

func (s *Service) run(ctx context.Context, model string, p Prompt) {
	defer s.wg.Done()
	for attempt := 0; attempt < 2; attempt++ {
		s.mu.Lock()
		cfg := s.state.Config
		day := time.Now().UTC().Format("2006-01-02")
		if s.dayCountLocked(model, day) >= cfg.DailyLimit {
			s.mu.Unlock()
			break
		}
		r := Result{ID: Secret()[:12], Model: model, Prompt: p.ID, PromptText: p.Text, Time: time.Now(), Verdict: "running"}
		s.state.Results = append(s.state.Results, r)
		idx := len(s.state.Results) - 1
		err := s.store.Save(s.state)
		s.mu.Unlock()
		if err != nil {
			s.mu.Lock()
			s.health = err.Error()
			s.mu.Unlock()
			break
		}
		answer, tokens, err := s.transport.Generate(ctx, model, p.Text, func(partial string) {
			s.mu.Lock()
			s.state.Results[idx].Answer = partial
			s.mu.Unlock()
		})
		r.Answer = answer
		r.Tokens = tokens
		if err != nil {
			r.Verdict = "unavailable"
			r.Error = err.Error()
			if errors.Is(ctx.Err(), context.Canceled) {
				r.Error = "检测已取消"
			}
		} else {
			r.Verdict = Grade(p.ID, answer)
		}
		s.mu.Lock()
		s.state.Results[idx] = r
		if err := s.store.Save(s.state); err != nil {
			s.health = err.Error()
		}
		s.mu.Unlock()
		if r.Verdict == "passed" || r.Verdict == "manual" || r.Error != "" {
			break
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.running, model)
	if cancel := s.testCancels[model]; cancel != nil {
		cancel()
	}
	delete(s.testCancels, model)
}
