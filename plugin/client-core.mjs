// Pure presentation helpers for the native quality-check page. This module has
// no React or DOM dependencies, so it is testable on its own and inlined into
// the browser bundle by scripts/build-client.mjs.

const identity = (provider, model) => `${provider}\u0000${model}`;
const modelLabel = (provider, model) => `${provider} / ${model}`;
const names = {
  passed: '通过', unavailable: '检测不可用', manual: '待人工评价', failed: '未通过',
  running: '进行中', empty: '空回答', truncated: '回答截断', cancelled: '已取消', skipped: '未开始',
};
const reviewNames = {pending: '待确认', accepted: '确认通过', rejected: '标记问题'};

// 用户取消的质量检测以 verdict "unavailable" 并附带取消标记的形式存储。
// 呈现层将其读取为已取消，但不改写存储记录或导出数据。
function isCancelled(record) {
  return record?.finish === 'aborted' || record?.error === '检测已取消';
}

function displayVerdict(record) {
  return isCancelled(record) ? 'cancelled' : record?.verdict;
}

function dateTime(raw, seconds = false) {
  return Date.parse(raw) > 0
    ? new Date(raw).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      ...(seconds ? {second: '2-digit'} : {}), hour12: false,
    })
    : '未通过';
}

function reportedTokens(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const counts = [usage.input_tokens, usage.output_tokens, usage.cache_read_tokens, usage.cache_write_tokens]
    .filter(Number.isFinite);
  return counts.length === 0 ? undefined : counts.reduce((sum, count) => sum + count, 0);
}

function usageLabel(record) {
  if (record?.verdict === 'skipped') return '未开始';
  const total = reportedTokens(record?.usage);
  return total === undefined ? '用量不可用' : `${total} tokens`;
}

function usageTotals(records) {
  let total = 0;
  let reported = 0;
  let missing = 0;
  for (const record of records) {
    if (record.verdict === 'running' || record.verdict === 'skipped') continue;
    const tokens = reportedTokens(record.usage);
    if (tokens === undefined) missing++;
    else { total += tokens; reported++; }
  }
  return {total, reported, missing};
}

function dayCount(state, provider, model) {
  const day = new Date().toISOString().slice(0, 10);
  const cleared = state.cleared_usage?.[day] || {};
  const count = state.results.filter(record => record.verdict !== 'skipped'
    && (!provider || (record.provider === provider && record.model === model))
    && new Date(record.time).toISOString().slice(0, 10) === day).length;
  if (provider) return count + (cleared[provider]?.[model] || 0);
  return count + Object.values(cleared).reduce(
    (total, byModel) => total + Object.values(byModel).reduce((a, b) => a + b, 0), 0);
}

function traceRunning(results) {
  return results.some(result => result.prompt === 'modeltrace' && result.verdict === 'running');
}

// ModelTrace 按顺序追加三条挑战，因此批次内位置即为现有挑战编号。
// 返回 0 表示记录不属于已知批次，无需挑战标签。
function traceChallenge(results, record) {
  if (record?.prompt !== 'modeltrace' || !record.batch) return 0;
  return results
    .filter(item => item.prompt === 'modeltrace' && item.batch === record.batch)
    .findIndex(item => item.id === record.id) + 1;
}

function traceBatchState(results) {
  if (results.some(result => result.verdict === 'running')) return 'running';
  if (results.length === 3 && results.every(result => result.verdict === 'manual')) return 'complete';
  if (results.some(result => result.verdict === 'cancelled' || result.verdict === 'skipped')) return 'cancelled';
  if (results.some(result => result.verdict === 'unavailable')) return 'failed';
  return 'incomplete';
}

function filterResults(state, filters) {
  return [...state.results].reverse().filter(record =>
    (!filters.model || identity(record.provider, record.model) === filters.model)
    && (!filters.verdict || displayVerdict(record) === filters.verdict)
    && (!filters.prompt || record.prompt === filters.prompt)
    && (!filters.review || (record.review || 'pending') === filters.review));
}

function analyzeAnswer(record, prompt) {
  const answer = record.answer || '';
  const checks = [];
  if (!answer.trim()) return checks;
  checks.push(['回答长度', `${Array.from(answer).length} 字符 / ${answer.split(/\r?\n/).length} 行`]);
  if (record.error) checks.push(['完整性', '调用异常或截断，请结合已返回正文复核']);
  if (record.prompt === 'repeat') {
    const items = [...(prompt?.text || record.prompt_text || '').matchAll(/^\d+\. (.+)$/gm)].map(match => match[1].trim());
    const missing = items.filter(item => !answer.includes(item));
    if (items.length) {
      checks.push(['逐字覆盖', `${items.length - missing.length}/${items.length} 个条目包含完整原文`]);
      if (missing.length) checks.push(['未完整出现', missing.join('\n')]);
      checks.push(['评价边界', '包含原文不代表涵义解释正确，也不能识别模型身份']);
    }
  } else if (record.prompt === 'milk') {
    checks.push(['自动题结论', record.verdict === 'passed' ? '最终数字符合 46.24 判定规则' : '未通过最终数字判定；请核对推理与答案']);
  } else if (record.prompt === 'html' || record.prompt === 'svg') {
    checks.push(['输出结构线索', /<svg\b/i.test(answer) ? '检测到 SVG 标记' : '未检测到 SVG 标记']);
    checks.push(['评价边界', '仅检查文本标记，未执行代码；画面、结构与动画仍需人工确认']);
  } else {
    checks.push(['评价边界', '本题没有可靠的自动评分标准，请根据参考说明复核正文']);
  }
  return checks;
}

// SVG image mode disables scripts; also remove active and remote content so a
// generated answer never becomes page markup or a network client.
function sanitizeSVG(answer) {
  const start = answer.search(/<svg\b/i);
  if (start < 0) return undefined;
  const end = answer.toLowerCase().indexOf('</svg>', start);
  if (end < 0) throw new Error('SVG 尚未完整返回，请查看原始回答。');
  const parsed = new DOMParser().parseFromString(answer.slice(start, end + 6), 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('SVG 格式无效，请查看原始回答。');
  }
  const root = parsed.documentElement;
  root.querySelectorAll('script,foreignObject,iframe,object,embed,image,a,animate,set,animateMotion,animateTransform')
    .forEach(node => node.remove());
  root.querySelectorAll('style').forEach(node => {
    if (/@import|url\s*\(\s*['"]?(?!#)/i.test(node.textContent)) node.remove();
  });
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      if (name.startsWith('on') || name === 'src'
        || (name === 'href' && !attribute.value.startsWith('#'))
        || /url\s*\(\s*['"]?(?!#)|@import/i.test(attribute.value)) element.removeAttributeNode(attribute);
    }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

export const core = {
  identity, modelLabel, names, reviewNames, isCancelled, displayVerdict,
  dateTime, reportedTokens, usageLabel, usageTotals,
  dayCount, traceRunning, traceBatchState, traceChallenge, filterResults, analyzeAnswer, sanitizeSVG,
};
