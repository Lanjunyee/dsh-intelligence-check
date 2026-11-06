package check

import (
	"context"
	"sync"
	"testing"
)

type fakeTransport struct {
	mu       sync.Mutex
	calls    []TargetID
	prompts  []string
	generate func(context.Context, TargetID, string, func(string)) (string, int, error)
}

func (f *fakeTransport) Generate(ctx context.Context, id TargetID, prompt string, progress func(string)) (string, int, error) {
	f.mu.Lock()
	f.calls = append(f.calls, id)
	f.prompts = append(f.prompts, prompt)
	f.mu.Unlock()
	if f.generate != nil {
		return f.generate(ctx, id, prompt, progress)
	}
	return "46.24 inches", 7, nil
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
