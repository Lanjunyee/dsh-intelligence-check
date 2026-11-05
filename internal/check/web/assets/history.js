import { $, text, icon, syncSelect, dateTime, names } from './ui.js';

let signature;
let limit = 30;

export function filteredHistory(data) {
  return [...data.state.results].reverse().filter(r => (!$('#historyModel').value || r.model === $('#historyModel').value) && (!$('#historyVerdict').value || r.verdict === $('#historyVerdict').value) && (!$('#historyPrompt').value || r.prompt === $('#historyPrompt').value) && (!$('#historyReview').value || (r.review || 'pending') === $('#historyReview').value));
}

export function renderHistory(data) {
  syncSelect($('#historyPrompt'), [['', '全部题目'], ...data.prompts.map(p => [p.id, p.name]), ['modeltrace', 'ModelTrace']]);
  const filtered = filteredHistory(data);
  const candidates = filtered.filter(r => r.answer && r.verdict !== 'running');
  for (const side of ['A', 'B']) syncSelect($('#compare' + side), [['', '选择回答'], ...candidates.map(r => [r.id, `${r.model} / ${r.prompt} / ${dateTime(r.time)}`])]);
  renderComparison(data);
  $('#historyCount').textContent = `${filtered.length} 条记录`;
  $('#loadHistory').hidden = filtered.length <= limit;
  const records = filtered.slice(0, limit);
  const nextSignature = JSON.stringify(records);
  if (nextSignature === signature) return;
  signature = nextSignature;
  const expanded = new Set([...$('#results').querySelectorAll('details[open]')].map(d => d.dataset.id));
  $('#results').replaceChildren(...records.map(record => {
    const details = text('details', '', 'record'); details.dataset.id = record.id; details.open = expanded.has(record.id);
    const summary = text('summary', '', 'history-summary');
    summary.append(text('span', dateTime(record.time), 'record-date'), text('span', record.model, 'record-model model-id'), text('span', data.prompts.find(p => p.id === record.prompt)?.name || 'ModelTrace', 'record-type'), text('span', names[record.verdict] || record.verdict, 'state ' + record.verdict), text('span', `${record.tokens || 0} tokens`, 'record-tokens numeric'));
    const body = text('div', '', 'record-body');
    if (record.error) body.append(text('p', record.error, 'inline-state error'));
    if (record.review) body.append(text('p', `人工审核：${({ accepted: '确认通过', rejected: '标记问题', pending: '待确认' })[record.review]}${record.review_note ? ' / ' + record.review_note : ''}`, 'inline-state'));
    body.append(text('pre', record.answer || (record.verdict === 'running' ? '等待回答' : '未返回回答正文')));
    const download = text('a', '下载原始回答', 'download'); download.prepend(icon('Download'));
    download.href = '/api/results/' + encodeURIComponent(record.id) + '/download'; body.append(download);
    const prompt = record.prompt_text || data.prompts.find(p => p.id === record.prompt)?.text;
    if (prompt) body.append(text('p', '提示词原文', 'prompt-label'), text('pre', prompt));
    details.append(summary, body); return details;
  }));
  if (!records.length) $('#results').append(text('p', '暂无符合条件的记录', 'empty-state'));
}

export function renderComparison(data) {
  for (const side of ['A', 'B']) {
    const record = data?.state.results.find(r => r.id === $('#compare' + side).value);
    $('#compareText' + side).textContent = record?.answer || '尚未选择回答';
    $('#compareMeta' + side).textContent = record ? `${record.model} / ${record.prompt} / ${dateTime(record.time)} / ${record.tokens || 0} tokens / ${{ accepted: '确认通过', rejected: '标记问题', pending: '待确认' }[record.review || 'pending']}${record.review_note ? ' / ' + record.review_note : ''}` : '';
  }
}

export function exportFilteredHistory(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), results: filteredHistory(data) }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'intelligence-check-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function resetHistoryLimit() {
  limit = 30;
}

export function loadMoreHistory() {
  limit += 30;
}
