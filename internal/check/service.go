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
	DailyLimit int `json:"daily_limit"`
}

// TargetID is the provider route plus the exact model id. Display names and
// catalog grouping never participate in identity.
type TargetID struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func (id TargetID) validate() error {
	if id.Provider == "" || id.Model == "" {
		return errors.New("请选择模型提供方和模型")
	}
	if len(id.Provider) > 512 || len(id.Model) > 512 || strings.ContainsAny(id.Provider+id.Model, "\r\n") {
		return errors.New("无效模型身份")
	}
	return nil
}

func (id TargetID) key() string { return id.Provider + "\x00" + id.Model }

type Target struct {
	TargetID
	Enabled bool `json:"enabled"`
}

type Model struct {
	Provider     string `json:"provider"`
	ProviderName string `json:"provider_name,omitempty"`
	Model        string `json:"model"`
	Name         string `json:"name,omitempty"`
	Description  string `json:"description,omitempty"`
}

type Result struct {
	ID            string    `json:"id"`
	Provider      string    `json:"provider"`
	Model         string    `json:"model"`
	Prompt        string    `json:"prompt"`
	Answer        string    `json:"answer"`
	Verdict       string    `json:"verdict"`
	Error         string    `json:"error,omitempty"`
	Time          time.Time `json:"time"`
	Usage         *Usage    `json:"usage,omitempty"`
	Batch         string    `json:"batch,omitempty"`
	ExpectedCount int       `json:"expected_count,omitempty"`
	PromptText    string    `json:"prompt_text,omitempty"`
	Review        string    `json:"review,omitempty"`
	ReviewNote    string    `json:"review_note,omitempty"`
	ReviewedAt    time.Time `json:"reviewed_at,omitempty"`
}

type State struct {
	Config       Config                               `json:"config"`
	Targets      []Target                             `json:"targets"`
	Results      []Result                             `json:"results"`
	ClearedUsage map[string]map[string]map[string]int `json:"cleared_usage,omitempty"`
}

// Transport is defined in transport.go. The plugin forwards generation to the
// DSH host bridge; model catalog membership arrives separately.

type Service struct {
	mu          sync.Mutex
	state       State
	catalog     []Model
	running     map[TargetID]bool
	testCancels map[TargetID]context.CancelFunc
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
	s := &Service{store: store, catalog: []Model{}, running: map[TargetID]bool{}}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.state = State{Config: Config{DailyLimit: 120}, Targets: []Target{}, Results: []Result{}}
	if err := store.Load(&s.state); err != nil {
		store.Close()
		return nil, err
	}
	if s.state.Targets == nil {
		s.state.Targets = []Target{}
	}
	if s.state.Results == nil {
		s.state.Results = []Result{}
	}
	if transport == nil {
		transport = hostTransport{}
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
	return out, s.health
}

func (s *Service) SetCatalog(models []Model) error {
	seen := map[string]bool{}
	clean := make([]Model, 0, len(models))
	for _, model := range models {
		id := TargetID{Provider: model.Provider, Model: model.Model}
		if err := id.validate(); err != nil {
			return err
		}
		if seen[id.key()] {
			continue
		}
		seen[id.key()] = true
		clean = append(clean, model)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog = clean
	return nil
}

func (s *Service) Catalog() []Model {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Model(nil), s.catalog...)
}

func (s *Service) Configure(c Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.DailyLimit < 1 || c.DailyLimit > 10000 {
		return errors.New("每日预算须为 1–10000 次")
	}
	s.state.Config = c
	return s.saveLocked()
}

func (s *Service) targetLocked(id TargetID) *Target {
	for i := range s.state.Targets {
		if s.state.Targets[i].TargetID == id {
			return &s.state.Targets[i]
		}
	}
	return nil
}

func (s *Service) SetTarget(id TargetID, enabled bool) error {
	if err := id.validate(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if target := s.targetLocked(id); target != nil {
		target.Enabled = enabled
	} else {
		s.state.Targets = append(s.state.Targets, Target{TargetID: id, Enabled: enabled})
	}
	return s.saveLocked()
}

func (s *Service) DeleteTarget(id TargetID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[id] {
		return errors.New("模型正在检测，请完成后再删除")
	}
	index := -1
	for i := range s.state.Targets {
		if s.state.Targets[i].TargetID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return errors.New("模型未配置")
	}
	previous, _ := json.Marshal(s.state)
	s.state.Targets = append(s.state.Targets[:index], s.state.Targets[index+1:]...)
	if err := s.store.Save(s.state); err != nil {
		json.Unmarshal(previous, &s.state)
		return err
	}
	return nil
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
		s.state.ClearedUsage = make(map[string]map[string]map[string]int)
	}
	kept := make([]Result, 0, len(s.state.Results))
	for _, result := range s.state.Results {
		if !selected[result.ID] {
			kept = append(kept, result)
			continue
		}
		day := result.Time.UTC().Format("2006-01-02")
		if s.state.ClearedUsage[day] == nil {
			s.state.ClearedUsage[day] = make(map[string]map[string]int)
		}
		byProvider := s.state.ClearedUsage[day]
		if byProvider[result.Provider] == nil {
			byProvider[result.Provider] = make(map[string]int)
		}
		byProvider[result.Provider][result.Model]++
	}
	s.state.Results = kept
	if err := s.store.Save(s.state); err != nil {
		json.Unmarshal(previous, &s.state)
		return err
	}
	return nil
}

func (s *Service) Trigger(id TargetID, prompt string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.targetLocked(id) == nil {
		return errors.New("模型未配置")
	}
	if s.running[id] {
		return errors.New("该模型已有检测进行中，请完成后重试")
	}
	p, ok := FindPrompt(prompt)
	if !ok {
		return errors.New("未知题目")
	}
	day := time.Now().UTC().Format("2006-01-02")
	if s.dayCountLocked(id, day) >= s.state.Config.DailyLimit {
		return errors.New("每日请求预算已耗尽")
	}
	s.running[id] = true
	if s.testCancels == nil {
		s.testCancels = make(map[TargetID]context.CancelFunc)
	}
	ctx, cancel := context.WithTimeout(s.ctx, 180*time.Second)
	s.testCancels[id] = cancel
	s.wg.Add(1)
	go s.run(ctx, id, p)
	return nil
}

func (s *Service) dayCountLocked(id TargetID, day string) int {
	count := s.state.ClearedUsage[day][id.Provider][id.Model]
	for _, r := range s.state.Results {
		if r.Provider == id.Provider && r.Model == id.Model && r.Time.UTC().Format("2006-01-02") == day {
			count++
		}
	}
	return count
}

func (s *Service) CancelTest(id TargetID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cancel := s.testCancels[id]
	if cancel == nil {
		return errors.New("该模型没有可取消的质量检测")
	}
	cancel()
	return nil
}

func (s *Service) run(ctx context.Context, id TargetID, p Prompt) {
	defer s.wg.Done()
	for attempt := 0; attempt < 2; attempt++ {
		s.mu.Lock()
		cfg := s.state.Config
		day := time.Now().UTC().Format("2006-01-02")
		if s.dayCountLocked(id, day) >= cfg.DailyLimit {
			s.mu.Unlock()
			break
		}
		r := Result{ID: Secret()[:12], Provider: id.Provider, Model: id.Model, Prompt: p.ID, PromptText: p.Text, Time: time.Now(), Verdict: "running"}
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
		gen, err := s.transport.Generate(ctx, id, p.Text, func(partial string) {
			s.mu.Lock()
			s.state.Results[idx].Answer = partial
			s.mu.Unlock()
		}, GenerateParams{MaxTokens: DefaultMaxTokens})
		r.Answer, r.Usage = gen.Answer, gen.Usage
		switch {
		case err != nil:
			r.Verdict = "unavailable"
			r.Error = err.Error()
			if errors.Is(ctx.Err(), context.Canceled) {
				r.Error = "检测已取消"
			}
		case gen.Finish == "aborted" || (gen.Error != nil && gen.Error.Code == "ABORTED"):
			r.Verdict, r.Error = "unavailable", "检测已取消"
		case gen.Finish == "error" || gen.Error != nil:
			r.Verdict, r.Error = "unavailable", generationFailure(gen)
		case strings.TrimSpace(gen.Answer) == "":
			r.Verdict, r.Error = "empty", "空回答"
		case gen.Finish == "max-tokens":
			r.Verdict, r.Error = "truncated", "回答被截断"
		default:
			r.Verdict = Grade(p.ID, gen.Answer)
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
	delete(s.running, id)
	if cancel := s.testCancels[id]; cancel != nil {
		cancel()
	}
	delete(s.testCancels, id)
}
