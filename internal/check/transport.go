package check

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultMaxTokens preserves the generation parameter used before the host
// bridge existed.
const DefaultMaxTokens = 8192

// Usage is the token usage reported by the host. A nil Usage means the host
// did not report usage; consumers must not substitute zero.
type Usage struct {
	InputTokens  int  `json:"input_tokens"`
	OutputTokens int  `json:"output_tokens"`
	TotalTokens  *int `json:"total_tokens,omitempty"`
}

type GenerationError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// Generation is the factual outcome of one host model call. The service maps
// Finish and Error to the record state; the transport never invents a verdict.
type Generation struct {
	Answer string
	Usage  *Usage
	Finish string
	Error  *GenerationError
}

type GenerateParams struct {
	MaxTokens int `json:"max_tokens,omitempty"`
}

// Transport is the model-generation boundary. The plugin forwards these calls
// to the DSH host bridge; model catalog membership arrives separately.
type Transport interface {
	Generate(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error)
}

// hostTransport is the seam used when no bridge is configured. It fails
// explicitly instead of bypassing the host.
type hostTransport struct{}

func (hostTransport) Generate(context.Context, TargetID, string, func(string), GenerateParams) (Generation, error) {
	return Generation{}, errors.New("宿主模型调用桥接尚未接入")
}

// HostBridgeTransport speaks the loopback NDJSON bridge served by the plugin.
// Request: request_id, target, prompt, params. Events: delta, usage, finish.
type HostBridgeTransport struct {
	URL    string
	Token  string
	Client *http.Client
}

func NewHostBridgeTransport(url, token string) *HostBridgeTransport {
	return &HostBridgeTransport{
		URL:    strings.TrimRight(url, "/"),
		Token:  token,
		Client: &http.Client{Timeout: 180 * time.Second},
	}
}

type bridgeRequest struct {
	RequestID string         `json:"request_id"`
	Target    TargetID       `json:"target"`
	Prompt    string         `json:"prompt"`
	Params    GenerateParams `json:"params"`
}

func generationFailure(g Generation) string {
	if g.Error != nil {
		if g.Error.Message != "" {
			return g.Error.Message
		}
		if g.Error.Code != "" {
			return g.Error.Code
		}
	}
	return "模型调用失败"
}

type bridgeEvent struct {
	Type   string           `json:"type"`
	Text   string           `json:"text,omitempty"`
	Usage  *Usage           `json:"usage,omitempty"`
	Reason string           `json:"reason,omitempty"`
	Error  *GenerationError `json:"error,omitempty"`
}

func (t *HostBridgeTransport) Generate(ctx context.Context, id TargetID, prompt string, progress func(string), params GenerateParams) (Generation, error) {
	body, err := json.Marshal(bridgeRequest{RequestID: RandomHex()[:12], Target: id, Prompt: prompt, Params: params})
	if err != nil {
		return Generation{}, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", t.URL+"/generate", bytes.NewReader(body))
	if err != nil {
		return Generation{}, err
	}
	req.Header.Set("Authorization", "Bearer "+t.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.Client.Do(req)
	if err != nil {
		return Generation{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return Generation{}, fmt.Errorf("宿主模型桥接 HTTP %d：%s", resp.StatusCode, strings.TrimSpace(string(message)))
	}
	var out Generation
	var answer strings.Builder
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 8*1024*1024))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event bridgeEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return out, errors.New("宿主模型桥接响应无效")
		}
		switch event.Type {
		case "delta":
			answer.WriteString(event.Text)
			out.Answer = answer.String()
			if progress != nil {
				progress(out.Answer)
			}
		case "usage":
			out.Usage = event.Usage
		case "finish":
			out.Finish, out.Error = event.Reason, event.Error
		default:
			return out, errors.New("宿主模型桥接事件未知")
		}
		if out.Finish != "" {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return out, err
	}
	if out.Finish == "" {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		return out, errors.New("宿主模型桥接未返回完成事件")
	}
	return out, nil
}
