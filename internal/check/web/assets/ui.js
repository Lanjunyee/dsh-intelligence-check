import { icons } from './icons.js';

export const $ = selector => document.querySelector(selector);
export function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const [tag, attributes] of icons[name] || []) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
}
export function syncSelect(select, options) {
  const signature = JSON.stringify(options);
  if (select.dataset.options === signature) return;
  const selected = select.value;
  select.replaceChildren(...options.map(([value, label]) => {
    const option = text('option', label);
    option.value = value;
    return option;
  }));
  if (options.some(([value]) => value === selected)) select.value = selected;
  select.dataset.options = signature;
}
export const dateTime = raw => Date.parse(raw) > 0 ? new Date(raw).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未通过';
export const identity = (provider, model) => provider + '\u0000' + model;
export const modelLabel = (provider, model) => `${provider} / ${model}`;
export const names = { passed: '通过', unavailable: '检测不可用', manual: '待人工评价', failed: '未通过', running: '进行中', empty: '空回答', truncated: '回答截断', cancelled: '已取消', skipped: '未开始' };
function reportedTokens(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined;
  if (input === undefined && output === undefined) return undefined;
  return (input || 0) + (output || 0);
}
export function usageLabel(record) {
  if (record?.verdict === 'skipped') return '未开始';
  const total = reportedTokens(record?.usage);
  return total === undefined ? '用量不可用' : `${total} tokens`;
}
export function usageTotals(records) {
  let total = 0, reported = 0, missing = 0;
  for (const record of records) {
    if (record.verdict === 'running' || record.verdict === 'skipped') continue;
    const tokens = reportedTokens(record.usage);
    if (tokens === undefined) missing++;
    else { total += tokens; reported++; }
  }
  return { total, reported, missing };
}
// ModelTrace has three entries per batch; unstarted entries explain a stopped batch.
export function traceBatchState(results) {
  if (results.some(result => result.verdict === 'running')) return 'running';
  if (results.length === 3 && results.every(result => result.verdict === 'manual')) return 'complete';
  if (results.some(result => result.verdict === 'cancelled' || result.verdict === 'skipped')) return 'cancelled';
  if (results.some(result => result.verdict === 'unavailable')) return 'failed';
  return 'incomplete';
}
