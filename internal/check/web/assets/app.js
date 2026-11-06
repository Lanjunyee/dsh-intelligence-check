import { $, text, icon, hydrateIcons, syncSelect, dateTime, names, identity, modelLabel, usageLabel } from './ui.js';
import { filteredHistory, renderHistory, renderComparison, exportFilteredHistory, resetHistoryLimit, loadMoreHistory } from './history.js';
import { renderModelTrace, runModelTrace } from '../modeltrace/panel.js';
import { analyzeAnswer } from './answer-analysis.js';
import { renderSVGPreview } from './svg-preview.js';
import { renderHTMLPreview, stopHTMLPreview } from './html-preview.js';

let data, polling = false, stopped = false, pollError = '', targetSignature;
const config = $('#config');
let configDirty = false;
let awaitingTest;
const testErrors = new Map();
let shownRecord, reviewDirty = false, analysisSignature;
hydrateIcons();

function feedback(value, success = false) {
  $('#message').textContent = value;
  $('#message').className = 'feedback' + (success ? ' success' : '');
}
async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text();
    if (response.status === 401) throw Error('管理会话已失效，请从插件重新打开控制台。');
    if (/<!doctype|<html/i.test(raw)) throw Error(`控制台连接暂时不可用（HTTP ${response.status}），请稍后重试；持续失败请从插件重新打开远程入口。`);
    throw Error(raw.trim() || `请求失败（HTTP ${response.status}）`);
  }
  return response.json();
}
async function pending(button, work, output = $('#message')) {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try { await work(); }
  catch (error) { output.textContent = error.message; output.classList.remove('success'); output.classList.add('error'); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); renderControls(); }
}
function selectView(name, focus = false) {
  if (name !== 'tests') stopHTMLPreview();
  document.querySelectorAll('[role=tab]').forEach(tab => {
    const active = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`#view-${tab.dataset.view}`).hidden = !active;
    if (active && focus) tab.focus();
  });
}
const tabs = [...document.querySelectorAll('[role=tab]')];
tabs.forEach((tab, i) => {
  tab.onclick = () => selectView(tab.dataset.view);
  tab.onkeydown = event => {
    const index = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (index !== undefined) { event.preventDefault(); selectView(tabs[index].dataset.view, true); }
  };
});
function theme(mode) {
  document.documentElement.dataset.theme = mode;
  const label = mode === 'dark' ? '切换为亮色' : '切换为暗色';
  $('#theme').setAttribute('aria-label', label);
  $('#theme').dataset.tooltip = label;
  $('#theme').replaceChildren(icon(mode === 'dark' ? 'Sun' : 'Moon'));
}
try { theme(localStorage.getItem('theme') === 'light' ? 'light' : 'dark'); } catch { theme('dark'); }
$('#theme').onclick = () => {
  const mode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  theme(mode);
  try { localStorage.setItem('theme', mode); } catch {}
};
function openSettings() {
  if (!$('#settingsDialog').open) $('#settingsDialog').showModal();
}
$('#settings').onclick = openSettings;
$('#closeSettings').onclick = () => $('#settingsDialog').close();
$('#settingsDialog').onclick = event => { if (event.target === $('#settingsDialog')) {
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
} };
config.oninput = () => { configDirty = true; };
function selectedTarget() {
  const key = $('#model').value;
  return data?.state.targets.find(target => identity(target.provider, target.model) === key);
}
function modelRunning(provider, model) {
  return data?.state.results?.some(r => r.provider === provider && r.model === model && r.verdict === 'running');
}
function renderControls() {
  if (!data) return;
  const target = selectedTarget();
  $('#run').disabled = $('#run').hasAttribute('aria-busy') || !target || modelRunning(target.provider, target.model);
  renderTestAnswer();
  renderModelTrace(data);
}
function renderTestAnswer() {
  if (!data) return;
  const target = selectedTarget();
  const provider = target?.provider, model = target?.model;
  const prompt = $('#prompt').value;
  const submissionError = testErrors.get(JSON.stringify([provider, model, prompt]));
  const records = data.state.results.filter(r => r.provider === provider && r.model === model && r.prompt === prompt).reverse();
  if (awaitingTest?.provider === provider && awaitingTest?.model === model && awaitingTest?.prompt === prompt && records.some(r => !awaitingTest.ids.has(r.id))) awaitingTest = undefined;
  const waiting = awaitingTest?.provider === provider && awaitingTest?.model === model && awaitingTest?.prompt === prompt;
  syncSelect($('#testRecord'), [['', '最新回答'], ...records.map(r => [r.id, `${dateTime(r.time)} / ${names[r.verdict] || r.verdict}`])]);
  $('#testRecord').disabled = waiting || !records.length;
  const record = waiting ? undefined : records.find(r => r.id === $('#testRecord').value) || records[0];
  const running = waiting || record?.verdict === 'running';
  $('#cancelTest').hidden = !data.state.results.some(r => r.provider === provider && r.model === model && r.verdict === 'running' && r.prompt !== 'modeltrace');
  const answer = record?.answer || '';
  const elapsed = record ? Math.max(0, Math.floor((Date.now() - Date.parse(record.time)) / 1000)) : 0;
  const incomplete = record && ['unavailable', 'empty', 'truncated'].includes(record.verdict);
  $('#testStatus').textContent = running ? `检测进行中，已等待 ${elapsed} 秒（最长 180 秒）。` : record ? (incomplete ? '检测未完成' : '检测完成') : modelRunning(model) ? '该模型正在运行其他检测。' : '';
  $('#testStatus').className = 'inline-state' + (incomplete ? ' error' : '');
  $('#answerMeta').textContent = record ? `${modelLabel(record.provider, record.model)} / ${dateTime(record.time)} / ${names[record.verdict] || record.verdict} / ${usageLabel(record)}` : target ? `${modelLabel(provider, model)} / ${data.prompts.find(p => p.id === prompt)?.name || ''}` : '尚未添加检测目标';
  $('#answerError').hidden = !record?.error && !submissionError;
  $('#answerError').textContent = submissionError || record?.error || '';
  const content = answer || (running ? '正在等待模型回答…' : record ? record.verdict === 'empty' ? '本次回答为空。' : record.error ? '本次请求未返回回答正文。' : '本次回答为空。' : '当前模型和题目暂无回答');
  if ($('#testAnswer').textContent !== content) $('#testAnswer').textContent = content;
  $('#testAnswer').setAttribute('aria-busy', String(Boolean(running)));
  $('#copyAnswer').disabled = !answer;
  $('#downloadAnswer').hidden = !answer;
  if (record) $('#downloadAnswer').href = '/api/results/' + encodeURIComponent(record.id) + '/download';
  const review = $('#answerReview');
  review.hidden = !answer || running;
  if (shownRecord !== record?.id) { reviewDirty = false; $('#reviewMessage').textContent = ''; }
  shownRecord = record?.id;
  if (record && !reviewDirty) {
    review.elements.decision.value = record.review || 'pending';
    review.elements.note.value = record.review_note || '';
  }
  $('#reviewStatus').textContent = record?.review ? ({ accepted: '已确认通过', rejected: '已标记问题', pending: '待确认' }[record.review] + ' / ' + dateTime(record.reviewed_at)) : '未审核';
  const signature = JSON.stringify([record?.id, record?.answer, record?.error, record?.verdict]);
  if (analysisSignature !== signature) {
    analysisSignature = signature;
    renderSVGPreview(running ? undefined : record);
    renderHTMLPreview(running ? undefined : record);
    const panel = $('#answerAnalysis'); panel.replaceChildren(); panel.hidden = !answer;
    if (answer) {
      panel.append(text('h3', '自动辅助检查'));
      for (const [label, value] of analyzeAnswer(record, data.prompts.find(p => p.id === prompt))) {
        const row = text('div', '', 'analysis-row'); row.append(text('span', label, 'muted'), text('span', value)); panel.append(row);
      }
    }
  }
}
function showPrompt() {
  $('#promptText').textContent = data?.prompts.find(p => p.id === $('#prompt').value)?.text || '';
  $('#guidance').textContent = data?.guidance?.[$('#prompt').value] || '';
}
function dayCount(provider, model) {
  const day = new Date().toISOString().slice(0, 10);
  const cleared = data.state.cleared_usage?.[day] || {};
  const count = data.state.results.filter(r => (!provider || (r.provider === provider && r.model === model)) && new Date(r.time).toISOString().slice(0, 10) === day).length;
  if (provider) return count + (cleared[provider]?.[model] || 0);
  return count + Object.values(cleared).reduce((total, byModel) => total + Object.values(byModel).reduce((a, b) => a + b, 0), 0);
}
function renderTargets() {
  const targets = data.state.targets;
  const signature = JSON.stringify([targets, data.state.results.filter(r => r.verdict === 'running').map(r => identity(r.provider, r.model)), data.state.config.daily_limit, targets.map(t => dayCount(t.provider, t.model))]);
  if (signature === targetSignature) return;
  targetSignature = signature;
  const rows = targets.map(target => {
    const row = document.createElement('tr');
    const provider = text('td', target.provider, 'model-id');
    provider.dataset.label = '提供方';
    const model = text('td', target.model, 'model-id');
    model.dataset.label = '模型';
    const budget = text('td', `${dayCount(target.provider, target.model)} / ${data.state.config.daily_limit}`, 'numeric');
    budget.dataset.label = '今日预算 (UTC)';
    const actions = text('td', '');
    actions.dataset.label = '操作';
    const tools = text('div', '', 'actions');
    const label = modelLabel(target.provider, target.model);
    const retest = text('button', '', 'icon-button');
    retest.type = 'button'; retest.append(icon('RefreshCw'));
    retest.setAttribute('aria-label', `重新检测 ${label}`);
    retest.dataset.tooltip = '重新检测'; retest.title = '重新检测';
    retest.disabled = modelRunning(target.provider, target.model);
    retest.onclick = () => pending(retest, async () => {
      await request('/api/action', { provider: target.provider, model: target.model, action: 'test' });
      feedback(`${label}：已开始检测`, true);
      await refresh();
    });
    tools.append(retest);
    const toggle = text('label', '', 'toggle');
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = target.enabled;
    input.setAttribute('aria-label', `监测 ${label}`);
    input.onchange = async () => {
      input.disabled = true;
      try { await request('/api/target', { provider: target.provider, model: target.model, enabled: input.checked }); await refresh(); }
      catch (error) { input.checked = target.enabled; feedback(error.message); }
      finally { input.disabled = false; }
    };
    toggle.append(input, text('span', '', 'toggle-track')); tools.append(toggle); actions.append(tools);
    const remove = text('button', '', 'icon-button'); remove.append(icon('Trash2'));
    remove.setAttribute('aria-label', `删除 ${label}`); remove.dataset.tooltip = '删除检测目标'; remove.disabled = modelRunning(target.provider, target.model);
    remove.onclick = () => {
      if (!confirm(`删除 ${label}？历史记录和预算计数保留。`)) return;
      pending(remove, async () => { await request('/api/target/delete', { provider: target.provider, model: target.model }); feedback('已删除检测目标，历史记录保留', true); await refresh(); });
    };
    tools.append(remove);
    row.append(provider, model, budget, actions);
    return row;
  });
  if (!rows.length) {
    const row = text('tr', '', 'empty-row'); const cell = text('td', '从 DSH 模型目录添加一个检测目标开始测试', 'empty-state'); cell.colSpan = 4; row.append(cell); rows.push(row);
  }
  $('#targets').replaceChildren(...rows);
}
function renderHistoryView() {
  if (!data) return;
  renderHistory(data);
}
$('#compareA').onchange = $('#compareB').onchange = () => renderComparison(data);
function syncTargetForm() {
  const form = $('#target');
  const providers = new Map();
  for (const entry of data?.catalog || []) providers.set(entry.provider, entry.provider_name || entry.provider);
  syncSelect(form.elements.provider, [...providers].map(([id, name]) => [id, name === id ? id : `${name} (${id})`]));
  const provider = form.elements.provider.value;
  syncSelect(form.elements.model, (data?.catalog || []).filter(entry => entry.provider === provider).map(entry => [entry.model, entry.name && entry.name !== entry.model ? `${entry.name} — ${entry.model}` : entry.model]));
}
$('#target').elements.provider.onchange = syncTargetForm;
async function refresh() {
  if (polling || stopped) return;
  polling = true;
  try {
    data = await request('/api/state');
    if (pollError && $('#message').textContent === pollError) feedback('');
    pollError = '';
    $('#health').textContent = data.health ? '服务异常' : '宿主目录已连接';
    $('#health').className = 'service-state ' + (data.health ? 'warning' : 'connected');
    $('#health').title = data.health || '';
    if (!configDirty) config.elements.daily_limit.value = data.state.config.daily_limit;
    const targets = data.state.targets;
    $('#targetCount').textContent = targets.length;
    $('#statEnabled').textContent = targets.filter(t => t.enabled).length;
    $('#statRequests').textContent = dayCount();
    syncSelect($('#model'), targets.map(t => [identity(t.provider, t.model), modelLabel(t.provider, t.model) + (t.enabled ? '' : '（监测关闭）')]));
    syncSelect($('#prompt'), data.prompts.map(p => [p.id, p.name]));
    const reported = new Map();
    for (const item of [...targets, ...data.state.results]) reported.set(identity(item.provider, item.model), modelLabel(item.provider, item.model));
    syncSelect($('#historyModel'), [['', '全部模型'], ...reported]);
    syncTargetForm();
    showPrompt(); renderTargets(); renderControls(); renderHistoryView();
    $('#lastSync').textContent = '更新于 ' + dateTime(new Date().toISOString());
  } catch (error) {
    pollError = error.message; feedback(pollError);
    $('#health').textContent = '连接中断'; $('#health').className = 'service-state warning';
  } finally { polling = false; }
}
function changeTest() { $('#testRecord').value = ''; showPrompt(); renderControls(); }
$('#prompt').onchange = changeTest;
$('#model').onchange = changeTest;
$('#testRecord').onchange = renderTestAnswer;
$('#answerReview').oninput = () => { reviewDirty = true; };
$('#answerReview').onsubmit = event => {
  event.preventDefault();
  const id = shownRecord;
  const values = Object.fromEntries(new FormData(event.target));
  pending(event.target.querySelector('button'), async () => {
    await request('/api/results/' + encodeURIComponent(id) + '/review', values);
    if (shownRecord === id) { reviewDirty = false; $('#reviewMessage').textContent = '审核已保存'; }
    await refresh();
  }, $('#reviewMessage'));
};
$('#copyAnswer').onclick = () => pending($('#copyAnswer'), async () => {
  await navigator.clipboard.writeText($('#testAnswer').textContent);
  feedback('回答已复制', true);
});
for (const id of ['historyModel', 'historyVerdict', 'historyPrompt', 'historyReview']) $('#' + id).onchange = () => { resetHistoryLimit(); renderHistoryView(); };
$('#exportHistory').onclick = () => {
  if (!data) return;
  exportFilteredHistory(data);
};
$('#clearHistory').onclick = () => pending($('#clearHistory'), async () => {
  const records = filteredHistory(data);
  if (!records.length) return;
  if (!confirm(`永久清理当前筛选的 ${records.length} 条记录？原始回答与审核将删除，已消耗预算保持不变。`)) return;
  await request('/api/results/clear', { ids: records.map(r => r.id) });
  await refresh();
  feedback('记录已清理，已消耗预算保持不变', true);
});
$('#loadHistory').onclick = () => { loadMoreHistory(); renderHistoryView(); };
$('#run').onclick = () => pending($('#run'), async () => {
  const target = selectedTarget(), prompt = $('#prompt').value;
  if (!target) { feedback('请先从 DSH 模型目录添加检测目标'); return; }
  testErrors.delete(JSON.stringify([target.provider, target.model, prompt]));
  awaitingTest = { provider: target.provider, model: target.model, prompt, ids: new Set(data.state.results.map(r => r.id)) };
  $('#testRecord').value = ''; renderTestAnswer();
  try {
    await request('/api/action', { provider: target.provider, model: target.model, action: 'test', prompt });
    feedback('已开始检测', true); await refresh();
  } catch (error) {
    awaitingTest = undefined;
    testErrors.set(JSON.stringify([target.provider, target.model, prompt]), error.message);
    renderTestAnswer();
    throw error;
  }
});
$('#cancelTest').onclick = () => pending($('#cancelTest'), async () => {
  const target = selectedTarget();
  if (!target) return;
  await request('/api/action', { provider: target.provider, model: target.model, action: 'cancel-test' });
  await refresh();
});
$('#traceRun').onclick = () => pending($('#traceRun'), async () => {
  await runModelTrace(request, data); feedback('已开始三条指纹挑战', true); await refresh();
});
$('#target').onsubmit = event => {
  event.preventDefault();
  const form = event.target;
  pending(form.querySelector('button:last-child'), async () => {
    const provider = form.elements.provider.value, model = form.elements.model.value;
    if (!provider || !model) { feedback('请选择模型提供方和模型'); return; }
    await request('/api/target', { provider, model, enabled: false });
    feedback('已添加检测目标，自动监测保持关闭', true); await refresh();
  });
};
config.onsubmit = event => {
  event.preventDefault();
  pending(config.querySelector('button.primary'), async () => {
    const values = Object.fromEntries(new FormData(config));
    await request('/api/config', { daily_limit: Number(values.daily_limit) });
    configDirty = false; await refresh();
    $('#configMessage').textContent = '预算已保存';
    $('#configMessage').className = 'inline-state success';
  }, $('#configMessage'));
};
$('#closeRemote').onclick = () => pending($('#closeRemote'), async () => {
  await request('/api/console/close', {}); stopped = true;
  feedback('远程访问已结束，请从插件重新打开。');
});
await refresh();
setInterval(refresh, 3000);
