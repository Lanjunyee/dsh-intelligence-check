package check

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"
)

// Port of ModelTrace's generate_challenges; scoring uses its unmodified JS.
func traceChoice(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err)
	}
	return int(v.Int64())
}

func traceChallenges() []Result {
	openings := []string{"这是一次独立的数值选择记录", "请完成下面的无语义整数选择任务", "执行一次第一反应取值记录", "生成一组不承载语义的整数选择", "进行一轮快速逐项取值"}
	actions := []string{"为各个位置分别凭第一反应选择", "逐项选择", "每次只决定当前一项，共给出", "分别凭第一反应给出", "逐个直接选择"}
	endings := []string{"允许某个数字再次出现；每项写出后不要回头排序、去重或替换。", "偶然重复是有效的；不要重新排列或修正已经写出的项目。", "相同值可以再次出现；输出过程中不要整理或改写前面的项目。", "重复值无需删除；不要筛选、重排或补成某种规律。", "不必赋予数字任何含义；已经给出的值保持不变。"}
	separators := []string{"数字之间用逗号或空格分隔均可。", "使用一种一致的常见分隔符即可。", "可以用逗号、空格或换行分隔。", "只要每个整数边界清楚，格式可自行选择。"}
	available := make([]int, 41)
	for i := range available {
		available[i] = 292 + i
	}
	batch := Secret()[:12]
	out := make([]Result, 3)
	for i := range out {
		index := traceChoice(len(available))
		count := available[index]
		available = append(available[:index], available[index+1:]...)
		prompt := fmt.Sprintf("%s。%s %d 个 1 到 355（含端点）的整数。", openings[traceChoice(len(openings))], actions[traceChoice(len(actions))], count) +
			"每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。" +
			"本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。" +
			endings[traceChoice(len(endings))] + separators[traceChoice(len(separators))] +
			"直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。"
		out[i] = Result{ID: Secret()[:12], Prompt: "modeltrace", Batch: batch, ExpectedCount: count, PromptText: prompt, Verdict: "running"}
	}
	return out
}

func (s *Service) TriggerModelTrace(id TargetID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.targetLocked(id) == nil {
		return errors.New("模型未配置")
	}
	if s.running[id] {
		return errors.New("该模型已有检测进行中，请完成后重试")
	}
	cfg := s.state.Config
	day := time.Now().UTC().Format("2006-01-02")
	if s.dayCountLocked(id, day)+3 > cfg.DailyLimit {
		return errors.New("ModelTrace 需要 3 次请求，今日剩余预算不足")
	}
	probes := traceChallenges()
	start := len(s.state.Results)
	for i := range probes {
		probes[i].Provider = id.Provider
		probes[i].Model = id.Model
		probes[i].Time = time.Now()
	}
	s.state.Results = append(s.state.Results, probes...)
	if err := s.store.Save(s.state); err != nil {
		s.state.Results = s.state.Results[:start]
		return err
	}
	if s.testCancels == nil {
		s.testCancels = make(map[TargetID]context.CancelFunc)
	}
	batchCtx, cancel := context.WithCancel(s.ctx)
	s.testCancels[id] = cancel
	s.running[id] = true
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer func() {
			cancel()
			s.mu.Lock()
			delete(s.running, id)
			delete(s.testCancels, id)
			s.mu.Unlock()
		}()
		markSkipped := func(from int, reason string) {
			s.mu.Lock()
			for j := from; j < len(probes); j++ {
				if s.state.Results[start+j].Verdict == "running" {
					s.state.Results[start+j].Verdict = "skipped"
					s.state.Results[start+j].Error = reason
				}
			}
			if err := s.store.Save(s.state); err != nil {
				s.health = err.Error()
			}
			s.mu.Unlock()
		}
		for i, r := range probes {
			if batchCtx.Err() != nil {
				markSkipped(i, "批次已取消，未开始")
				break
			}
			callCtx, callCancel := context.WithTimeout(batchCtx, 180*time.Second)
			gen, err := s.transport.Generate(callCtx, id, r.PromptText, nil, GenerateParams{MaxTokens: DefaultMaxTokens})
			timedOut := errors.Is(callCtx.Err(), context.DeadlineExceeded)
			cancelled := batchCtx.Err() != nil
			callCancel()
			r.Answer, r.Usage, r.Finish, r.Verdict = gen.Answer, gen.Usage, gen.Finish, "manual"
			if gen.Error != nil {
				r.ErrorCode = gen.Error.Code
			}
			switch {
			case err != nil && cancelled:
				r.Verdict, r.Error = "cancelled", "检测已取消"
			case err != nil && timedOut:
				r.Verdict, r.Error = "unavailable", "检测超时"
			case err != nil:
				r.Verdict, r.Error = "unavailable", err.Error()
			case (gen.Finish == "aborted" || (gen.Error != nil && gen.Error.Code == "ABORTED")) && cancelled:
				r.Verdict, r.Error = "cancelled", "检测已取消"
			case gen.Finish == "aborted" || (gen.Error != nil && gen.Error.Code == "ABORTED"):
				r.Verdict, r.Error = "unavailable", "检测已取消"
			case gen.Finish == "error" || gen.Error != nil:
				r.Verdict, r.Error = "unavailable", generationFailure(gen)
			}
			s.mu.Lock()
			s.state.Results[start+i] = r
			err = s.store.Save(s.state)
			if err != nil {
				s.health = err.Error()
			}
			s.mu.Unlock()
			if cancelled {
				markSkipped(i+1, "批次已取消，未开始")
				break
			}
		}
	}()
	return nil
}
