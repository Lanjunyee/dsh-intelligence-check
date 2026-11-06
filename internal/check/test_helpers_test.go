package check

import (
	"context"
	"sync"
	"testing"
)

func usage(total int) *Usage {
	v := total
	return &Usage{InputTokens: v, OutputTokens: 0, TotalTokens: &v}
}

type fakeTransport struct {
	mu       sync.Mutex
	calls    []TargetID
	prompts  []string
	params   []GenerateParams
	generate func(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error)
}

func (f *fakeTransport) Generate(ctx context.Context, id TargetID, prompt string, progress func(string), params GenerateParams) (Generation, error) {
	f.mu.Lock()
	f.calls = append(f.calls, id)
	f.prompts = append(f.prompts, prompt)
	f.params = append(f.params, params)
	f.mu.Unlock()
	if f.generate != nil {
		return f.generate(ctx, id, prompt, progress, params)
	}
	return Generation{Answer: "46.24 inches", Usage: usage(7), Finish: "stop"}, nil
}

func (f *fakeTransport) snapshot() ([]TargetID, []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]TargetID(nil), f.calls...), append([]string(nil), f.prompts...)
}

func fixtureWithTransport(t *testing.T, transport Transport) *Service {
	t.Helper()
	s, err := NewWithTransport(t.TempDir(), transport)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}
