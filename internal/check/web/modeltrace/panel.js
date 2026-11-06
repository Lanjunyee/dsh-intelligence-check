import { analyzeGlobalOutputs } from './fingerprint-core.js';
import { $, text, syncSelect, dateTime, identity, modelLabel, names, traceBatchState } from '../assets/ui.js';

let bank, bankLoading, latestData, rendered;
const percent = value => `${(value * 100).toFixed(1)}%`;
const batchLabels = { running: '批次进行中', complete: '批次已完成', failed: '批次未完成：调用失败', cancelled: '批次已取消', incomplete: '批次未完成' };

function selectedTraceTarget(data) {
  return data?.state.targets.find(item => identity(item.provider, item.model) === $('#traceModel').value);
}

export async function runModelTrace(request, data) {
  const target = selectedTraceTarget(data);
  if (!target) throw Error('请先添加检测目标。');
  await request('/api/action', { provider: target.provider, model: target.model, action: 'modeltrace' });
}

export async function cancelModelTrace(request, data) {
  const target = selectedTraceTarget(data);
  if (!target) throw Error('请先添加检测目标。');
  await request('/api/action', { provider: target.provider, model: target.model, action: 'cancel-modeltrace' });
}

$('#traceModel').onchange = $('#traceBatch').onchange = () => renderModelTrace(latestData);

export function renderModelTrace(data) {
  if (!data) return;
  latestData = data;
  const select = $('#traceModel');
  const targets = data.state.targets;
  syncSelect(select, targets.map(t => [identity(t.provider, t.model), modelLabel(t.provider, t.model) + (t.enabled ? '' : '（监测关闭）')]));
  const target = selectedTraceTarget(data);
  const records = target ? data.state.results.filter(r => r.prompt === 'modeltrace' && r.provider === target.provider && r.model === target.model) : [];
  const batches = [...new Set(records.map(r => r.batch))].reverse();
  syncSelect($('#traceBatch'), [['', '最新批次'], ...batches.map(batch => [batch, dateTime(records.find(r => r.batch === batch).time)])]);
  const batch = $('#traceBatch').value || batches[0];
  const results = records.filter(r => r.batch === batch);
  const running = results.some(r => r.verdict === 'running');
  const targetRunning = target && data.state.results.some(r => r.provider === target.provider && r.model === target.model && r.verdict === 'running');
  $('#traceCancel').hidden = !targetRunning;
  $('#traceRun').disabled = $('#traceRun').hasAttribute('aria-busy') || !target || targetRunning;
  const signature = JSON.stringify([select.value, results, Boolean(bank)]);
  if (signature === rendered) return;
  rendered = signature;
  const panel = $('#traceResults');
  const expanded = panel.querySelector('details')?.open;
  panel.replaceChildren();
  if (!batch) { panel.append(text('p', '暂无指纹检测记录', 'empty-state')); return; }
  const ended = results.filter(r => r.verdict !== 'running').length;
  const state = traceBatchState(results);
  const progress = text('div', '', 'trace-progress');
  const segments = text('div', '', 'segments'); segments.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const result = results[i];
    const stateClass = !result || result.verdict === 'running' ? '' : result.verdict === 'manual' ? ' complete' : result.verdict === 'unavailable' ? ' failed' : ' cancelled';
    segments.append(text('span', '', 'segment' + stateClass));
  }
  progress.append(segments, text('span', `${ended}/3 已结束`, 'numeric'), text('span', dateTime(results[0].time), 'meta'));
  panel.append(progress, text('p', batchLabels[state], 'inline-state trace-batch' + (state === 'failed' ? ' error' : '')));
  const items = text('ol', '', 'trace-items');
  for (const [index, result] of results.entries()) {
    const item = text('li', '', 'trace-item');
    item.append(text('span', `挑战 ${index + 1}`, 'label'), text('span', names[result.verdict] || result.verdict, 'state ' + result.verdict));
    if (result.error) item.append(text('span', result.error, 'meta'));
    items.append(item);
  }
  panel.append(items);
  if (running) { panel.append(text('p', '正在等待模型回答…', 'muted')); return; }
  if (state !== 'complete') return;
  if (!bank) {
    panel.append(text('p', '正在读取指纹库', 'muted'));
    if (!bankLoading) {
      bankLoading = fetch('/modeltrace/unified_bank.json').then(async response => {
        if (!response.ok) throw Error(`指纹库读取失败（HTTP ${response.status}）。`);
        bank = await response.json(); rendered = undefined; renderModelTrace(latestData);
      }).catch(error => {
        panel.replaceChildren(text('p', error.message));
        const retry = text('button', '重新读取', 'secondary');
        retry.onclick = () => { rendered = undefined; renderModelTrace(latestData); }; panel.append(retry);
      }).finally(() => { bankLoading = undefined; });
    }
    return;
  }
  try {
    const report = analyzeGlobalOutputs(results.map(r => ({ text: r.answer, expected_count: r.expected_count })), bank);
    if (report.used_outputs !== 3) {
      panel.append(text('p', `仅 ${report.used_outputs}/3 条有效数字回答，本轮不作归因。`));
      const diagnostics = text('ol', '', 'trace-items');
      for (const item of report.diagnostics) {
        diagnostics.append(text('li', `挑战 ${item.index + 1}：解析 ${item.parsed_numbers} 个数字（至少 ${item.minimum_numbers}）`, 'trace-item meta'));
      }
      panel.append(diagnostics);
      return;
    }
    const reportNode = text('div', '', 'trace-report');
    for (const [label, name, probability] of [['最相似候选', report.prediction_name, report.probability], ['最相似家族', report.family_prediction_name, report.family_probability]]) {
      const item = text('div', '', 'trace-prediction');
      item.append(text('span', label, 'label'), text('span', name, 'prediction'), text('span', percent(probability), 'probability')); reportNode.append(item);
    }
    panel.append(reportNode);
    panel.append(text('p', `以上为当前 ${report.results.length} 个候选内的闭集行为相似性排序，不能证明模型身份，也不用于自动封锁。`, 'disclaimer'));
    const candidates = text('div', '', 'candidate-list');
    for (const candidate of report.results.slice(0, 3)) {
      const row = text('div', '', 'candidate-row'); const bar = text('div', '', 'bar');
      const fill = text('span', ''); fill.style.width = percent(candidate.probability); bar.append(fill);
      row.append(text('span', candidate.display_name, 'model-id'), bar, text('span', percent(candidate.probability), 'numeric')); candidates.append(row);
    }
    panel.append(candidates);
    const details = document.createElement('details'); details.open = Boolean(expanded);
    details.append(text('summary', `全部 ${report.results.length} 个候选`));
    const table = text('table', '', 'ranking');
    const header = document.createElement('tr'); header.append(text('th', '候选模型'), text('th', '家族'), text('th', '闭集概率'));
    const head = document.createElement('thead'); head.append(header);
    const body = document.createElement('tbody');
    for (const candidate of report.results) {
      const row = document.createElement('tr'); row.append(text('td', candidate.display_name), text('td', candidate.family_name), text('td', percent(candidate.probability))); body.append(row);
    }
    table.append(head, body); details.append(table); panel.append(details);
  } catch (error) { panel.append(text('p', `本轮无法归因：${error.message}`)); }
}
