// Native DSH main-area page. The factory receives React from the shared
// module table; every value below is plain data or a callback from the
// same-origin page API. scripts/build-client.mjs wraps this file together
// with client-core.mjs and the ModelTrace fingerprint core.

const h = React.createElement;
const useState = React.useState;
const useEffect = React.useEffect;
const useRef = React.useRef;
const useCallback = React.useCallback;

const API = '/dsh-intelligence-check/api';
const PANEL_ID = 'dsh-intelligence-check';

const ICON_PATHS = {
  activity: [['path', {d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'}]],
  settings: [['path', {d: 'M14 17H5'}], ['path', {d: 'M19 7h-9'}], ['circle', {cx: '17', cy: '17', r: '3'}], ['circle', {cx: '7', cy: '7', r: '3'}]],
  refresh: [['path', {d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'}], ['path', {d: 'M21 3v5h-5'}], ['path', {d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'}], ['path', {d: 'M8 16H3v5'}]],
  plus: [['path', {d: 'M5 12h14'}], ['path', {d: 'M12 5v14'}]],
  play: [['path', {d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'}]],
  download: [['path', {d: 'M12 15V3'}], ['path', {d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'}], ['path', {d: 'm7 10 5 5 5-5'}]],
  copy: [['rect', {width: '14', height: '14', x: '8', y: '8', rx: '2'}], ['path', {d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'}]],
  trash: [['path', {d: 'M10 11v6'}], ['path', {d: 'M14 11v6'}], ['path', {d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'}], ['path', {d: 'M3 6h18'}], ['path', {d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'}]],
  x: [['path', {d: 'M18 6 6 18'}], ['path', {d: 'm6 6 12 12'}]],
  check: [['path', {d: 'M20 6 9 17l-5-5'}]],
  fingerprint: [['path', {d: 'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4'}], ['path', {d: 'M14 13.12c0 2.38 0 6.38-1 8.88'}], ['path', {d: 'M17.29 21.02c.12-.6.43-2.3.5-3.02'}], ['path', {d: 'M2 12a10 10 0 0 1 18-6'}], ['path', {d: 'M2 16h.01'}], ['path', {d: 'M21.8 16c.2-2 .131-5.354 0-6'}], ['path', {d: 'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2'}], ['path', {d: 'M8.65 22c.21-.66.45-1.32.57-2'}], ['path', {d: 'M9 6.8a6 6 0 0 1 9 5.2v2'}]],
  flask: [['path', {d: 'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2'}], ['path', {d: 'M6.453 15h11.094'}], ['path', {d: 'M8.5 2h7'}]],
  history: [['path', {d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'}], ['path', {d: 'M3 3v5h5'}], ['path', {d: 'M12 7v5l4 2'}]],
  monitor: [['rect', {width: '20', height: '14', x: '2', y: '3', rx: '2'}], ['line', {x1: '8', x2: '16', y1: '21', y2: '21'}], ['line', {x1: '12', x2: '12', y1: '17', y2: '21'}]],
  power: [['path', {d: 'M12 2v10'}], ['path', {d: 'M18.4 6.6a9 9 0 1 1-12.77.04'}]],
  eye: [['path', {d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'}], ['circle', {cx: '12', cy: '12', r: '3'}]],
};

function Icon(props) {
  const attributes = {
    width: props.size || 16, height: props.size || 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  };
  return h('svg', attributes, ...(ICON_PATHS[props.name] || []).map(([tag, data], index) => h(tag, {...data, key: index})));
}

function PanelIcon(props) {
  return h(Icon, {name: 'activity', size: props.size || 20});
}

async function request(pathname, body) {
  const response = await fetch(API + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'content-type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) throw new Error('管理会话已失效，请重新打开页面。');
    throw new Error(text.trim() || `请求失败（HTTP ${response.status}）`);
  }
  return response.json();
}

function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Button(props) {
  return h('button', {
    type: props.type || 'button',
    className: `dic-btn${props.primary ? ' dic-btn-primary' : ''}${props.icon && !props.children ? ' dic-btn-icon' : ''}${props.className ? ` ${props.className}` : ''}`,
    disabled: props.disabled || props.busy,
    'aria-busy': props.busy ? 'true' : undefined,
    'aria-label': props.label,
    title: props.title || props.label,
    onClick: props.onClick,
  }, props.icon ? h(Icon, {name: props.icon, size: props.iconSize || 16}) : null, props.children);
}

function Field(props) {
  return h('label', {className: 'dic-field'}, h('span', null, props.label), props.children);
}

function StateBadge(props) {
  return h('span', {className: `dic-state dic-state-${props.verdict || 'pending'}`}, props.children || core.names[props.verdict] || props.verdict);
}

function SvgPreview(props) {
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const record = props.record;
  useEffect(() => {
    setSource('');
    setStatus('');
    if (!record?.answer || record.prompt !== 'svg') return undefined;
    try {
      const svg = core.sanitizeSVG(record.answer);
      if (!svg) return undefined;
      const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
      setSource(url);
      setStatus('静态预览；脚本、外部资源和动画不执行。');
      return () => URL.revokeObjectURL(url);
    } catch (error) {
      setStatus(error.message);
      return undefined;
    }
  }, [record?.id, record?.answer, record?.prompt]);
  if (!record?.answer || record.prompt !== 'svg') return null;
  return h('section', {className: 'dic-preview'},
    h('h3', null, 'SVG 预览'),
    source ? h('img', {src: source, alt: '模型生成的 SVG 回答预览'}) : null,
    h('p', {className: 'dic-hint', role: 'status'}, status));
}

function HtmlPreview(props) {
  const record = props.record;
  const [candidates, setCandidates] = useState({count: 0, combined: false});
  const [candidate, setCandidate] = useState('');
  const [size, setSize] = useState('');
  const [status, setStatus] = useState('');
  const [stopped, setStopped] = useState(false);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    setCandidate('');
    setStopped(false);
    setStatus('');
    setReload(0);
    setExpanded(false);
    setCandidates({count: 0, combined: false});
    if (!record?.answer || record.prompt !== 'html') return undefined;
    const ticket = ++generation.current;
    const controller = new AbortController();
    const url = `${API}/results/${encodeURIComponent(record.id)}/preview`;
    fetch(url, {signal: controller.signal}).then(async response => {
      await response.body?.cancel();
      if (ticket !== generation.current) return;
      if (!response.ok) { setStatus(`预览加载失败（HTTP ${response.status}）`); return; }
      setCandidates({
        count: Number(response.headers.get('X-Preview-Candidates')) || 0,
        combined: response.headers.get('X-Preview-Combined') === 'true',
      });
      setStatus('正在加载…');
    }).catch(error => {
      if (ticket === generation.current && error.name !== 'AbortError') setStatus(error.message);
    });
    return () => controller.abort();
  }, [record?.id, record?.answer, record?.prompt]);
  useEffect(() => {
    const handler = event => {
      if (event.data?.type !== 'intelligence-preview-ready') return;
      if (!event.source || event.source !== document.getElementById(`dic-preview-${record?.id}`)?.contentWindow) return;
      setStatus('预览已加载');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [record?.id]);
  useEffect(() => {
    if (stopped || !record?.answer || record.prompt !== 'html') return undefined;
    const timer = setTimeout(() => setStatus(current => current === '正在加载…' ? '预览未确认加载，请重新加载或查看原始回答。' : current), 15000);
    return () => clearTimeout(timer);
  }, [stopped, reload, record?.id, record?.answer, record?.prompt]);
  if (!record?.answer || record.prompt !== 'html') return null;
  const url = `${API}/results/${encodeURIComponent(record.id)}/preview${candidate === '' ? '' : `?candidate=${candidate}`}`;
  return h('section', {className: `dic-preview${expanded ? ' dic-preview-expanded' : ''}`},
    h('div', {className: 'dic-preview-head'},
      h('h3', null, 'HTML 实时预览'),
      h('div', {className: 'dic-preview-tools'},
        candidates.count >= 2 ? h('select', {
          className: 'dic-select', value: candidate, 'aria-label': '预览代码块',
          onChange: event => { setCandidate(event.target.value); setStopped(false); },
        }, ...Array.from({length: candidates.count}, (_, index) => h('option', {value: String(index), key: index},
          candidates.combined && index === candidates.count - 1 ? '组合 HTML + CSS / JS' : `HTML ${index + 1}`))) : null,
        h('select', {
          className: 'dic-select', value: size, 'aria-label': '预览尺寸',
          onChange: event => setSize(event.target.value),
        }, ...['', '390', '768', '1280'].map(value => h('option', {value, key: value},
          value === '' ? '自适应' : value === '390' ? '手机' : value === '768' ? '平板' : '桌面'))),
        h(Button, {icon: 'refresh', label: '重新加载预览', title: '重新加载预览', onClick: () => { setStopped(false); setReload(value => value + 1); }}),
        h(Button, {icon: 'power', label: '停止预览', title: '停止预览', onClick: () => { setStopped(true); setStatus('预览已停止'); }}),
        h(Button, {icon: 'eye', label: expanded ? '退出放大预览' : '放大预览', title: expanded ? '退出放大预览' : '放大预览', onClick: () => setExpanded(value => !value)}))),
    stopped ? null : h('div', {className: 'dic-preview-frame', style: size ? {width: `${size}px`} : undefined},
      h('iframe', {
        id: `dic-preview-${record.id}`,
        key: `${url}-${reload}`,
        title: '模型生成的 HTML 实时预览',
        sandbox: 'allow-scripts',
        referrerPolicy: 'no-referrer',
        src: url,
      })),
    h('p', {className: 'dic-hint', role: 'status'}, status));
}

function SettingsDialog(props) {
  const {draft, setDraft, dirty, setDirty, onClose, onSave, busy, message} = props;
  const ref = useRef(null);
  useEffect(() => {
    const handler = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
  }, []);
  return h('div', {className: 'dic-modal-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) onClose(); }},
    h('div', {className: 'dic-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dic-settings-title', ref},
      h('div', {className: 'dic-modal-head'},
        h('h2', {id: 'dic-settings-title'}, '检测设置'),
        h(Button, {icon: 'x', label: '关闭设置', onClick: onClose})),
      h('form', {onSubmit: event => { event.preventDefault(); onSave(draft); }},
        h('label', {className: 'dic-check-row'},
          h('input', {
            type: 'checkbox', checked: draft.auto_enabled,
            onChange: event => { setDirty(true); setDraft({...draft, auto_enabled: event.target.checked}); },
          }),
          h('span', null, '开启定时自动检测')),
        h(Field, {label: '自动检测间隔（秒）'},
          h('input', {
            className: 'dic-input', type: 'number', min: 1, max: 86400, required: true, value: draft.interval_seconds,
            onChange: event => { setDirty(true); setDraft({...draft, interval_seconds: Number(event.target.value)}); },
          })),
        h('p', {className: 'dic-hint'}, '开启后仅对已打开“监测”的检测目标执行 milk，默认每 900 秒（15 分钟）一次；不依赖业务对话，关闭或移除目标后停止后续调用。'),
        h(Field, {label: '每日每模型请求上限'},
          h('input', {
            className: 'dic-input', type: 'number', min: 1, max: 10000, required: true, value: draft.daily_limit,
            onChange: event => { setDirty(true); setDraft({...draft, daily_limit: Number(event.target.value)}); },
          })),
        h('p', {className: 'dic-hint'}, '模型目录与凭据由 DSH 桌面应用提供，页面不保存网关地址或模型 API Key。'),
        message?.text ? h('p', {className: message.ok ? 'dic-hint' : 'dic-error', role: message.ok ? 'status' : 'alert'}, message.text) : null,
        h('div', {className: 'dic-modal-actions'},
          h('span', {className: 'dic-hint'}, dirty ? '有未保存的修改' : '预算约束自动与手动检测的请求次数。'),
          h(Button, {primary: true, type: 'submit', busy, label: '保存设置'}, '保存设置')))));
}

function CheckPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState({text: '', ok: true});
  const [tab, setTab] = useState('tests');
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState('milk');
  const [recordId, setRecordId] = useState('');
  const [pending, setPending] = useState(null);
  const [review, setReview] = useState({decision: 'pending', note: '', dirty: false});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState({text: '', ok: true});
  const [draft, setDraft] = useState({daily_limit: 120, auto_enabled: false, interval_seconds: 900});
  const [configDirty, setConfigDirty] = useState(false);
  const [traceModel, setTraceModel] = useState('');
  const [traceBatch, setTraceBatch] = useState('');
  const [bank, setBank] = useState(null);
  const [bankError, setBankError] = useState('');
  const [history, setHistory] = useState({model: '', verdict: '', prompt: '', review: ''});
  const [limit, setLimit] = useState(30);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [addProvider, setAddProvider] = useState('');
  const [addModel, setAddModel] = useState('');
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await request('/state');
      if (!alive.current) return;
      setData(next);
      setError('');
    } catch (failure) {
      if (alive.current) setError(failure.message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!configDirty && data) {
      setDraft({...data.state.config});
    }
  }, [data, configDirty]);

  const state = data?.state;
  const targets = state?.targets || [];
  const catalog = data?.catalog || [];
  const prompts = data?.prompts || [];
  const effectivePrompt = prompts.some(item => item.id === prompt) ? prompt : (prompts[0]?.id || 'milk');
  const effectiveSelected = targets.some(target => core.identity(target.provider, target.model) === selected)
    ? selected
    : (targets[0] ? core.identity(targets[0].provider, targets[0].model) : '');
  const target = targets.find(item => core.identity(item.provider, item.model) === effectiveSelected);
  const modelResults = target
    ? state.results.filter(record => record.provider === target.provider && record.model === target.model)
    : [];
  const promptRecords = target
    ? state.results.filter(record => record.provider === target.provider && record.model === target.model && record.prompt === effectivePrompt).reverse()
    : [];
  const waiting = pending && target && pending.provider === target.provider
    && pending.model === target.model && pending.prompt === effectivePrompt;
  const record = waiting ? undefined : (promptRecords.find(item => item.id === recordId) || promptRecords[0]);
  const running = Boolean(waiting) || Boolean(record?.verdict === 'running')
    || modelResults.some(item => item.verdict === 'running' && item.prompt === effectivePrompt);
  const targetRunning = modelResults.some(item => item.verdict === 'running');

  useEffect(() => {
    if (!pending || !state) return;
    const fresh = state.results.some(item => !pending.ids.has(item.id)
      && item.provider === pending.provider && item.model === pending.model && item.prompt === pending.prompt);
    if (fresh) setPending(null);
  }, [state, pending]);

  useEffect(() => {
    if (!record) return;
    setReview({decision: record.review || 'pending', note: record.review_note || '', dirty: false});
  }, [record?.id]);

  useEffect(() => {
    if (!data) return;
    if (!addProvider || !catalog.some(item => item.provider === addProvider)) {
      setAddProvider(catalog[0]?.provider || '');
    }
  }, [data, addProvider, catalog]);

  useEffect(() => {
    if (!addProvider) { setAddModel(''); return; }
    const models = catalog.filter(item => item.provider === addProvider);
    if (!models.some(item => item.model === addModel)) setAddModel(models[0]?.model || '');
  }, [addProvider, addModel, catalog]);

  const effectiveTraceModel = targets.some(item => core.identity(item.provider, item.model) === traceModel)
    ? traceModel
    : (targets[0] ? core.identity(targets[0].provider, targets[0].model) : '');
  const traceTarget = targets.find(item => core.identity(item.provider, item.model) === effectiveTraceModel);
  const traceRecords = traceTarget
    ? state?.results.filter(item => item.prompt === 'modeltrace' && item.provider === traceTarget.provider && item.model === traceTarget.model) || []
    : [];
  const traceBatches = [...new Set(traceRecords.map(item => item.batch))].reverse();
  const effectiveTraceBatch = traceBatches.includes(traceBatch) ? traceBatch : (traceBatches[0] || '');
  const traceResults = traceRecords.filter(item => item.batch === effectiveTraceBatch);
  const traceState = core.traceBatchState(traceResults);

  useEffect(() => {
    if (tab !== 'fingerprint' || bank || bankError || traceState !== 'complete') return undefined;
    let live = true;
    fetch('/dsh-intelligence-check/modeltrace/unified_bank.json').then(async response => {
      if (!response.ok) throw new Error(`指纹库读取失败（HTTP ${response.status}）。`);
      const value = await response.json();
      if (live) setBank(value);
    }).catch(failure => { if (live) setBankError(failure.message); });
    return () => { live = false; };
  }, [tab, bank, bankError, traceState]);

  function openSettings() {
    if (data) setDraft({...data.state.config});
    setConfigDirty(false);
    setSettingsMessage({text: '', ok: true});
    setSettingsOpen(true);
  }

  async function act(key, pathname, body, success) {
    if (busy) return {ok: false, busy: true};
    setBusy(key);
    setFeedback({text: '', ok: true});
    try {
      await request(pathname, body);
      if (success) setFeedback({text: success, ok: true});
      await refresh();
      return {ok: true};
    } catch (failure) {
      setFeedback({text: failure.message, ok: false});
      return {ok: false, error: failure.message};
    } finally {
      setBusy('');
    }
  }

  function startTest() {
    if (!target) { setFeedback({text: '请先从 DSH 模型目录添加检测目标', ok: false}); return; }
    const ids = new Set(state.results.map(item => item.id));
    setPending({provider: target.provider, model: target.model, prompt: effectivePrompt, ids});
    setRecordId('');
    act('run', '/action', {provider: target.provider, model: target.model, action: 'test', prompt: effectivePrompt}, '已开始检测')
      .then(result => { if (!result.ok) setPending(null); });
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = core.usageTotals(state?.results.filter(item => new Date(item.time).toISOString().slice(0, 10) === today) || []);
  const autoInterval = state?.config.interval_seconds || 900;
  const autoLabel = state?.config.auto_enabled
    ? (autoInterval % 60 === 0 ? `每 ${autoInterval / 60} 分钟` : `每 ${autoInterval} 秒`)
    : '关闭';
  const filtered = state ? core.filterResults(state, history) : [];
  const filteredAnswers = filtered.filter(item => item.answer && item.verdict !== 'running');
  const shownRecords = filtered.slice(0, limit);
  const compareRecordA = state?.results.find(item => item.id === compareA);
  const compareRecordB = state?.results.find(item => item.id === compareB);
  const promptInfo = prompts.find(item => item.id === effectivePrompt);
  const providerModels = catalog.filter(item => item.provider === addProvider);
  let traceReport;
  let traceReportError = '';
  if (traceState === 'complete' && bank && traceResults.length === 3) {
    try {
      traceReport = analyzeGlobalOutputs(traceResults.map(item => ({text: item.answer, expected_count: item.expected_count})), bank);
    } catch (failure) {
      traceReportError = failure.message;
    }
  }

  function renderModels() {
    return h('section', {id: 'dic-view-models', className: 'dic-section', role: 'tabpanel', 'aria-labelledby': 'dic-tab-models'},
      h('div', {className: 'dic-summary', 'aria-label': '检测概览'},
        h('span', null, `自动监测 ${targets.filter(item => item.enabled).length} / ${targets.length} 个目标`),
        h('span', null, `自动检测：${autoLabel}`),
        h('span', null, `今日请求：${state ? core.dayCount(state) : 0}`),
        h('span', null, todayUsage.reported
          ? `已报告用量：${todayUsage.total} tokens${todayUsage.missing ? `（${todayUsage.missing} 条缺失）` : ''}`
          : '尚无已报告用量')),
      h('div', {className: 'dic-section-head'},
        h('h2', null, '检测目标'),
        h('span', {className: 'dic-hint'}, '模型目录来自 DSH 桌面应用；检测不拦截业务请求')),
      h('form', {className: 'dic-add', onSubmit: event => {
        event.preventDefault();
        if (!addProvider || !addModel) { setFeedback({text: '请选择模型提供方和模型', ok: false}); return; }
        act('add', '/target', {provider: addProvider, model: addModel, enabled: false}, '已添加检测目标，自动监测保持关闭');
      }},
      h(Field, {label: '提供方'},
        h('select', {className: 'dic-select', value: addProvider, required: true, onChange: event => setAddProvider(event.target.value)},
          ...Array.from(new Map(catalog.map(item => [item.provider, item])).values()).map(item => h('option', {value: item.provider, key: item.provider},
            item.provider_name && item.provider_name !== item.provider ? `${item.provider_name} (${item.provider})` : item.provider)))),
      h(Field, {label: '模型'},
        h('select', {className: 'dic-select', value: addModel, required: true, onChange: event => setAddModel(event.target.value)},
          ...providerModels.map(item => h('option', {value: item.model, key: item.model},
            item.name && item.name !== item.model ? `${item.name} — ${item.model}` : item.model)))),
      h(Button, {primary: true, type: 'submit', icon: 'plus', busy: busy === 'add', label: '添加检测目标'}, '添加检测目标')),
      h('div', {className: 'dic-table-wrap'},
        h('table', {className: 'dic-table'},
          h('thead', null, h('tr', null,
            h('th', null, '提供方'), h('th', null, '模型'), h('th', null, '今日请求 / 上限'), h('th', null, '自动监测'), h('th', {className: 'dic-align-right'}, '操作'))),
          h('tbody', null, ...(targets.length === 0
            ? [h('tr', {key: 'empty'}, h('td', {colSpan: 5, className: 'dic-empty'}, '从 DSH 模型目录添加一个检测目标开始测试'))]
            : targets.map(item => {
              const label = core.modelLabel(item.provider, item.model);
              const itemRunning = state.results.some(entry => entry.provider === item.provider && entry.model === item.model && entry.verdict === 'running');
              return h('tr', {key: core.identity(item.provider, item.model)},
                h('td', {className: 'dic-mono'}, item.provider),
                h('td', {className: 'dic-mono'}, item.model),
                h('td', {className: 'dic-mono'}, `${core.dayCount(state, item.provider, item.model)} / ${state.config.daily_limit}`),
                h('td', null, h('div', {className: 'dic-monitor-state'},
                  h('label', {className: 'dic-toggle', title: `监测 ${label}`},
                    h('input', {type: 'checkbox', checked: item.enabled, 'aria-label': `监测 ${label}`, disabled: Boolean(busy),
                      onChange: event => act('toggle', '/target', {provider: item.provider, model: item.model, enabled: event.target.checked})}),
                    h('span', {className: 'dic-toggle-track'})),
                  h('span', {className: 'dic-hint'}, item.enabled ? '已开启' : '已关闭'))),
                h('td', null, h('div', {className: 'dic-row-actions'},
                  h(Button, {icon: 'refresh', label: `重新检测 ${label}`, title: '重新检测', disabled: itemRunning || Boolean(busy),
                    onClick: () => act('retest', '/action', {provider: item.provider, model: item.model, action: 'test'}, `${label}：已开始检测`)}),
                  h(Button, {icon: 'trash', label: `删除 ${label}`, title: '删除检测目标', disabled: itemRunning || Boolean(busy),
                    onClick: () => {
                      if (!window.confirm(`删除 ${label}？历史记录和预算计数保留。`)) return;
                      act('delete', '/target/delete', {provider: item.provider, model: item.model}, '已删除检测目标，历史记录保留');
                    }}))));
            }))))));
  }

  function renderTests() {
    const answer = record?.answer || '';
    const incomplete = record && ['unavailable', 'empty', 'truncated'].includes(record.verdict);
    const elapsed = record ? Math.max(0, Math.floor((Date.now() - Date.parse(record.time)) / 1000)) : 0;
    const status = running ? `检测进行中，已等待 ${elapsed} 秒（最长 180 秒）。`
      : record ? (incomplete ? '检测未完成' : '检测完成')
        : (target && modelResults.some(item => item.verdict === 'running') ? '该模型正在运行其他检测。' : '');
    return h('section', {id: 'dic-view-tests', className: 'dic-workspace', role: 'tabpanel', 'aria-labelledby': 'dic-tab-tests'},
      h('aside', {className: 'dic-setup', 'aria-label': '测试配置'},
        h('div', {className: 'dic-section-head'}, h('h2', null, '质量题库'), h('span', {className: 'dic-hint'}, `${prompts.length} 道题目`)),
        h('div', {className: 'dic-test-controls'},
          h(Field, {label: '测试模型'},
            h('select', {className: 'dic-select', value: effectiveSelected, disabled: !targets.length,
              onChange: event => { setSelected(event.target.value); setRecordId(''); }},
              !targets.length ? h('option', {value: ''}, '请先添加检测目标') : null,
              ...targets.map(item => h('option', {value: core.identity(item.provider, item.model), key: core.identity(item.provider, item.model)},
                core.modelLabel(item.provider, item.model))))),
          h('p', {className: 'dic-hint'}, '手动测试无需开启自动监测。'),
          h(Button, {className: 'dic-text-button', icon: 'plus', label: '管理检测目标', onClick: () => setTab('models')}, '管理检测目标'),
          h('fieldset', {className: 'dic-question-list'},
            h('legend', null, '选择测试题'),
            ...prompts.map(item => h('label', {className: `dic-question${effectivePrompt === item.id ? ' dic-question-selected' : ''}`, key: item.id},
              h('input', {type: 'radio', name: 'dic-question', value: item.id, checked: effectivePrompt === item.id,
                onChange: () => { setPrompt(item.id); setRecordId(''); }}),
              h('span', null, item.name), h('small', null, item.id === 'milk' ? '自动评估' : '人工评审')))),
          h('div', {className: 'dic-question-select'},
            h(Field, {label: '测试题'},
              h('select', {className: 'dic-select', value: effectivePrompt,
                onChange: event => { setPrompt(event.target.value); setRecordId(''); }},
                ...prompts.map(item => h('option', {value: item.id, key: item.id}, item.name))))),
          h('div', {className: 'dic-run-actions'},
            h(Button, {primary: true, icon: 'play', busy: busy === 'run', disabled: !target || targetRunning || Boolean(pending) || Boolean(busy),
              label: '运行所选题目', onClick: startTest}, running ? '正在检测…' : '运行所选题目'),
            modelResults.some(item => item.verdict === 'running' && item.prompt !== 'modeltrace')
              ? h(Button, {icon: 'x', label: '取消当前质量检测', busy: busy === 'cancel',
                onClick: () => act('cancel', '/action', {provider: target.provider, model: target.model, action: 'cancel-test'})}, '取消检测')
              : null)),
        h('details', {className: 'dic-details dic-prompt-details'},
          h('summary', null, '提示词原文'),
          h('pre', {className: 'dic-pre'}, promptInfo?.text || '')),
        h('details', {className: 'dic-details dic-guidance'},
          h('summary', null, '结果参考与限制'),
          h('p', null, data?.guidance?.[effectivePrompt] || ''))),
      h('div', {className: 'dic-reading'},
        h('div', {className: 'dic-answer-head'},
          h('div', {className: 'dic-answer-title'},
            h('h2', null, '模型回答'),
            record ? h(StateBadge, {verdict: record.verdict}) : null),
          h('div', {className: 'dic-answer-tools'},
            h('select', {className: 'dic-select', 'aria-label': '回答记录', value: record?.id || '', disabled: !promptRecords.length || Boolean(waiting),
              onChange: event => setRecordId(event.target.value)},
              h('option', {value: ''}, '最新回答'),
              ...promptRecords.map(item => h('option', {value: item.id, key: item.id}, `${core.dateTime(item.time)} / ${core.names[item.verdict] || item.verdict}`))),
            h(Button, {icon: 'copy', label: '复制回答', disabled: !answer, onClick: () => navigator.clipboard.writeText(answer)
              .then(() => setFeedback({text: '回答已复制', ok: true}))
              .catch(failure => setFeedback({text: failure.message, ok: false}))}),
            h(Button, {icon: 'download', label: '下载回答', disabled: !answer,
              onClick: () => download(`result-${record.id}.txt`, answer)}))),
        h('p', {className: 'dic-answer-meta dic-hint'}, record
          ? `${promptInfo?.name || ''} · ${core.modelLabel(record.provider, record.model)} · ${core.dateTime(record.time)} · ${core.usageLabel(record)}`
          : target ? `${promptInfo?.name || ''} · ${core.modelLabel(target.provider, target.model)}` : '选择模型和题目，回答将在这里显示'),
        status ? h('p', {className: `dic-run-status dic-hint${incomplete ? ' dic-error' : ''}`, role: 'status'}, status) : null,
        record?.error ? h('p', {className: 'dic-error dic-banner', role: 'alert'}, record.error) : null,
        answer || running || record
          ? h('pre', {className: `dic-pre dic-answer-body${['html', 'svg', 'map'].includes(effectivePrompt) ? ' dic-answer-code' : ''}`, tabIndex: 0},
            answer || (running ? '正在等待模型回答…' : record.error ? '本次请求未返回回答正文。' : '本次回答为空。'))
          : h('div', {className: 'dic-answer-empty'},
            h(Icon, {name: 'flask', size: 28}),
            h('h3', null, target ? '准备好，开始一次测试' : '先添加一个检测目标'),
            h('p', null, target ? '选择一道题，点击“运行所选题目”。\n模型的原始回答会保留在这里，便于回看和评审。' : '从 DSH 模型目录添加模型后，即可运行题库中的测试。'),
            !target ? h(Button, {primary: true, icon: 'plus', label: '添加检测目标', onClick: () => setTab('models')}, '添加检测目标') : null),
        h(SvgPreview, {record: running ? undefined : record}),
        h(HtmlPreview, {record: running ? undefined : record}),
        answer && !running ? h('details', {className: 'dic-details dic-analysis'},
          h('summary', null, '自动辅助检查'),
          ...core.analyzeAnswer(record, promptInfo).map(([label, value], index) => h('div', {className: 'dic-analysis-row', key: index},
            h('span', {className: 'dic-hint'}, label), h('span', null, value)))) : null,
        answer && !running && record ? h('form', {className: 'dic-review', onSubmit: event => {
          event.preventDefault();
          act('review', `/results/${encodeURIComponent(record.id)}/review`, {decision: review.decision, note: review.note}, '评审已保存');
        }},
        h('div', {className: 'dic-section-head'},
          h('h2', null, '人工评审'),
          h('span', {className: 'dic-hint'}, record.review
            ? `${core.reviewNames[record.review]} / ${core.dateTime(record.reviewed_at)}` : '未评审')),
        h('div', {className: 'dic-review-fields'},
          h(Field, {label: '评审结论'},
            h('select', {className: 'dic-select', value: review.decision,
              onChange: event => setReview({...review, decision: event.target.value, dirty: true})},
              ...Object.entries(core.reviewNames).map(([value, label]) => h('option', {value, key: value}, label)))),
          h(Field, {label: '评审备注'},
            h('textarea', {className: 'dic-input', rows: 3, maxLength: 1000, placeholder: '记录判断依据或待复核的问题',
              value: review.note, onChange: event => setReview({...review, note: event.target.value, dirty: true})}))),
        h('div', {className: 'dic-modal-actions'},
          h('span', {className: 'dic-hint'}, '评审仅记录评价，不影响模型调用。'),
          h(Button, {primary: true, type: 'submit', icon: 'check', busy: busy === 'review', label: '保存评审'}, '保存评审'))) : null));
  }

  function renderFingerprint() {
    let traceContent = null;
    if (traceReport) {
      const predictions = [['最相似候选', traceReport.prediction_name, traceReport.probability],
        ['最相似家族', traceReport.family_prediction_name, traceReport.family_probability]]
        .map(([label, name, probability]) => h('div', {className: 'dic-trace-prediction', key: label},
          h('span', {className: 'dic-hint'}, label),
          h('span', {className: 'dic-prediction'}, name),
          h('span', {className: 'dic-probability'}, `${(probability * 100).toFixed(1)}%`)));
      const candidateRows = traceReport.results.slice(0, 3).map(candidate =>
        h('div', {className: 'dic-candidate', key: candidate.model},
          h('span', {className: 'dic-mono'}, candidate.display_name),
          h('div', {className: 'dic-bar'}, h('span', {style: {width: `${(candidate.probability * 100).toFixed(1)}%`}})),
          h('span', {className: 'dic-mono'}, `${(candidate.probability * 100).toFixed(1)}%`)));
      const rankingRows = traceReport.results.map(candidate => h('tr', {key: candidate.model},
        h('td', null, candidate.display_name),
        h('td', null, candidate.family_name),
        h('td', {className: 'dic-align-right dic-mono'}, `${(candidate.probability * 100).toFixed(1)}%`)));
      traceContent = h('div', null,
        traceReport.used_outputs !== 3
          ? h('p', null, `仅 ${traceReport.used_outputs}/3 条有效数字回答，本轮不作归因。`)
          : h('div', null,
            h('div', {className: 'dic-trace-report'}, ...predictions),
            h('p', {className: 'dic-disclaimer'}, `以上为当前 ${traceReport.results.length} 个候选内的闭集行为相似性排序，不能证明模型身份，也不用于自动封锁。`),
            h('div', {className: 'dic-candidates'}, ...candidateRows),
            h('details', {className: 'dic-details'},
              h('summary', null, `全部 ${traceReport.results.length} 个候选`),
              h('div', {className: 'dic-table-wrap'},
                h('table', {className: 'dic-table'},
                  h('thead', null, h('tr', null,
                    h('th', null, '候选模型'), h('th', null, '家族'), h('th', {className: 'dic-align-right'}, '闭集概率'))),
                  h('tbody', null, ...rankingRows))))));
    } else if (traceReportError) {
      // An attribution exception is its own outcome: show it even though no
      // report could be produced, rather than falling back to a silent empty
      // result.
      traceContent = h('p', {className: 'dic-error', role: 'alert'}, `本轮无法归因：${traceReportError}`);
    }
    return h('section', {id: 'dic-view-fingerprint', className: 'dic-section', role: 'tabpanel', 'aria-labelledby': 'dic-tab-fingerprint'},
      h('div', {className: 'dic-section-head'}, h('h2', null, 'ModelTrace'), h('span', {className: 'dic-hint'}, '18 个候选 / GPT + Claude')),
      h('div', {className: 'dic-test-controls'},
        h(Field, {label: '检测模型'},
          h('select', {className: 'dic-select', value: effectiveTraceModel, onChange: event => { setTraceModel(event.target.value); setTraceBatch(''); }},
            ...targets.map(item => h('option', {value: core.identity(item.provider, item.model), key: core.identity(item.provider, item.model)},
              core.modelLabel(item.provider, item.model) + (item.enabled ? '' : '（监测关闭）'))))),
        h(Field, {label: '检测批次'},
          h('select', {className: 'dic-select', value: effectiveTraceBatch, onChange: event => setTraceBatch(event.target.value)},
            h('option', {value: ''}, '最新批次'),
            ...traceBatches.map(batch => h('option', {value: batch, key: batch},
              core.dateTime(traceRecords.find(item => item.batch === batch)?.time))))),
        h('div', {className: 'dic-row-actions'},
          h(Button, {icon: 'x', label: '取消批次', disabled: !core.traceRunning(traceRecords), busy: busy === 'trace-cancel',
            onClick: () => act('trace-cancel', '/action', {provider: traceTarget.provider, model: traceTarget.model, action: 'cancel-modeltrace'}, '已取消当前指纹批次')}, '取消批次'),
          h(Button, {primary: true, icon: 'fingerprint', label: '运行三条指纹挑战', disabled: !traceTarget || traceRecords.some(item => item.verdict === 'running'),
            busy: busy === 'trace-run',
            onClick: () => act('trace-run', '/action', {provider: traceTarget.provider, model: traceTarget.model, action: 'modeltrace'}, '已开始三条指纹挑战')}, '运行三条指纹挑战'))),
      h('p', {className: 'dic-disclaimer'}, '概率仅表示当前候选库内的行为相似程度（闭集），不等于模型身份认证；候选库之外的模型也会被归到最相似候选。指纹结果不影响模型调用，且始终由使用者手动发起。'),
      !effectiveTraceBatch ? h('p', {className: 'dic-empty'}, '暂无指纹检测记录') : h('div', {className: 'dic-trace'},
        h('div', {className: 'dic-trace-progress'},
          h('div', {className: 'dic-segments', 'aria-hidden': 'true'},
            ...Array.from({length: 3}, (_, index) => {
              const item = traceResults[index];
              const stateClass = !item || item.verdict === 'running' ? '' : item.verdict === 'manual' ? ' dic-segment-complete'
                : item.verdict === 'unavailable' ? ' dic-segment-failed' : ' dic-segment-cancelled';
              return h('span', {className: `dic-segment${stateClass}`, key: index});
            })),
          h('span', {className: 'dic-mono'}, `${traceResults.filter(item => item.verdict !== 'running').length}/3 已结束`),
          h('span', {className: 'dic-hint'}, core.dateTime(traceResults[0]?.time))),
        h('p', {className: `dic-hint${traceState === 'failed' ? ' dic-error' : ''}`},
          {running: '批次进行中', complete: '批次已完成', failed: '批次未完成：调用失败', cancelled: '批次已取消', incomplete: '批次未完成'}[traceState]),
        h('ol', {className: 'dic-trace-items'},
          ...traceResults.map((item, index) => h('li', {className: 'dic-trace-item', key: item.id},
            h('span', {className: 'dic-hint'}, `挑战 ${index + 1}`),
            h(StateBadge, {verdict: item.verdict}),
            item.error ? h('span', {className: 'dic-hint'}, item.error) : null))),
        traceState === 'running' ? h('p', {className: 'dic-hint'}, '正在等待模型回答…') : null,
        traceState === 'complete' && !bank && !bankError ? h('p', {className: 'dic-hint'}, '正在读取指纹库') : null,
        bankError ? h('div', null, h('p', {className: 'dic-error'}, bankError),
          h(Button, {label: '重新读取', onClick: () => setBankError('')}, '重新读取')) : null,
        traceContent));
  }

  function renderHistory() {
    return h('section', {id: 'dic-view-history', className: 'dic-section', role: 'tabpanel', 'aria-labelledby': 'dic-tab-history'},
      h('div', {className: 'dic-section-head'}, h('h2', null, '检测记录'), h('span', {className: 'dic-hint'}, `${filtered.length} 条记录`)),
      h('div', {className: 'dic-history-controls'},
        ...[
          ['model', '模型', [['', '全部模型'], ...Array.from(new Map([...targets, ...(state.results || [])].map(item => [core.identity(item.provider, item.model), core.modelLabel(item.provider, item.model)]))) ]],
          ['verdict', '结果', [['', '全部结果'], ...Object.entries(core.names).map(([value, label]) => [value, label])]],
          ['prompt', '题目', [['', '全部题目'], ...prompts.map(item => [item.id, item.name]), ['modeltrace', 'ModelTrace']]],
          ['review', '评审', [['', '全部评审'], ...Object.entries(core.reviewNames).map(([value, label]) => [value, label])]],
        ].map(([key, label, options]) => h(Field, {label, key},
          h('select', {className: 'dic-select', value: history[key],
            onChange: event => { setHistory({...history, [key]: event.target.value}); setLimit(30); }},
            ...options.map(([value, text]) => h('option', {value, key: value}, text))))),
        h(Button, {icon: 'download', label: '导出筛选记录', onClick: () => download('intelligence-check-results.json',
          JSON.stringify({exported_at: new Date().toISOString(), results: filtered}, null, 2), 'application/json')}),
        h(Button, {icon: 'trash', label: '清理筛选记录', disabled: !filtered.length, busy: busy === 'clear',
          onClick: () => {
            if (!window.confirm(`永久清理当前筛选的 ${filtered.length} 条记录？原始回答与评审将删除，已消耗预算保持不变。`)) return;
            act('clear', '/results/clear', {ids: filtered.map(item => item.id)}, '记录已清理，已消耗预算保持不变');
          }})),
      h('div', {className: 'dic-records'}, ...(shownRecords.length === 0
        ? [h('p', {className: 'dic-empty', key: 'empty'}, '暂无符合条件的记录')]
        : shownRecords.map(item => h('details', {className: 'dic-record', key: item.id},
          h('summary', null,
            h('span', {className: 'dic-hint'}, core.dateTime(item.time)),
            h('span', {className: 'dic-mono'}, core.modelLabel(item.provider, item.model)),
            h('span', {className: 'dic-hint'}, prompts.find(entry => entry.id === item.prompt)?.name || 'ModelTrace'),
            h(StateBadge, {verdict: item.verdict}),
            h('span', {className: 'dic-hint dic-mono'}, core.usageLabel(item))),
          h('div', {className: 'dic-record-body'},
            item.error ? h('p', {className: 'dic-error'}, item.error) : null,
            item.review ? h('p', {className: 'dic-hint'},
              `人工评审：${core.reviewNames[item.review]}${item.review_note ? ` / ${item.review_note}` : ''}`) : null,
            h('pre', {className: 'dic-pre'}, item.answer || (item.verdict === 'running' ? '等待回答' : '未返回回答正文')),
            h(Button, {icon: 'download', label: '下载原始回答', disabled: !item.answer,
              onClick: () => download(`result-${item.id}.txt`, item.answer || '')}, '下载原始回答'),
            item.prompt_text || prompts.find(entry => entry.id === item.prompt)?.text
              ? h('div', null, h('p', {className: 'dic-hint'}, '提示词原文'),
                h('pre', {className: 'dic-pre'}, item.prompt_text || prompts.find(entry => entry.id === item.prompt)?.text)) : null))))),
      filtered.length > limit ? h(Button, {label: '加载更多记录', onClick: () => setLimit(value => value + 30)}, '加载更多记录') : null,
      h('details', {className: 'dic-details'},
        h('summary', null, '回答对比'),
        h('div', {className: 'dic-history-controls'},
          h(Field, {label: '回答 A'}, h('select', {className: 'dic-select', value: compareA, onChange: event => setCompareA(event.target.value)},
            h('option', {value: ''}, '选择回答'),
            ...filteredAnswers.map(item => h('option', {value: item.id, key: item.id},
              `${core.modelLabel(item.provider, item.model)} / ${item.prompt} / ${core.dateTime(item.time)}`)))),
          h(Field, {label: '回答 B'}, h('select', {className: 'dic-select', value: compareB, onChange: event => setCompareB(event.target.value)},
            h('option', {value: ''}, '选择回答'),
            ...filteredAnswers.map(item => h('option', {value: item.id, key: item.id},
              `${core.modelLabel(item.provider, item.model)} / ${item.prompt} / ${core.dateTime(item.time)}`))))),
        h('div', {className: 'dic-compare'},
          ...[compareRecordA, compareRecordB].map((item, index) => h('div', {key: index},
            h('p', {className: 'dic-hint'}, item
              ? `${core.modelLabel(item.provider, item.model)} / ${item.prompt} / ${core.dateTime(item.time)} / ${core.usageLabel(item)} / ${core.reviewNames[item.review || 'pending']}${item.review_note ? ` / ${item.review_note}` : ''}`
              : ''),
            h('pre', {className: 'dic-pre'}, item?.answer || '尚未选择回答'))))));
  }

  const tabs = [
    ['tests', '质量题库', 'flask', null],
    ['models', '模型监测', 'monitor', targets.length],
    ['fingerprint', '模型指纹', 'fingerprint', null],
    ['history', '检测记录', 'history', null],
  ];

  return h('div', {className: 'dic-page'},
    h('header', {className: 'dic-head'},
      h('div', {className: 'dic-title'},
        h('h1', null, '模型质量检测'),
        h('span', {className: `dic-status${error ? ' dic-status-error' : ''}`},
          h('span', {className: 'dic-dot'}), error ? '连接中断' : data?.health ? '服务异常' : '已连接')),
      h('div', {className: 'dic-head-actions'},
        h(Button, {icon: 'refresh', label: '刷新', title: '立即刷新', onClick: refresh}),
        h(Button, {icon: 'settings', label: '检测预算设置', title: '检测设置', onClick: openSettings}))),
    error ? h('p', {className: 'dic-error dic-banner', role: 'alert'}, error) : null,
    feedback.text ? h('p', {className: `dic-feedback${feedback.ok ? ' dic-ok' : ' dic-error'}`, role: 'status'}, feedback.text) : null,
    h('nav', {className: 'dic-tabs', role: 'tablist', 'aria-label': '检测页面视图'},
      ...tabs.map(([id, label, icon, count], index) => h('button', {
        type: 'button', role: 'tab', id: `dic-tab-${id}`, 'aria-selected': String(tab === id),
        'aria-controls': `dic-view-${id}`, tabIndex: tab === id ? 0 : -1, className: 'dic-tab', key: id,
        onClick: () => setTab(id),
        onKeyDown: event => {
          const next = {ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1}[event.key];
          if (next === undefined) return;
          event.preventDefault();
          setTab(tabs[next][0]);
          document.getElementById(`dic-tab-${tabs[next][0]}`)?.focus();
        },
      }, h(Icon, {name: icon}), label, count !== null && count !== undefined ? h('span', {className: 'dic-tab-count'}, count) : null))),
    !data
      ? h('p', {className: 'dic-empty'}, error ? '质量检测后台不可用' : '正在连接…')
      : tab === 'models' ? renderModels()
        : tab === 'tests' ? renderTests()
          : tab === 'fingerprint' ? renderFingerprint() : renderHistory(),
    settingsOpen ? h(SettingsDialog, {
      draft, setDraft, dirty: configDirty, setDirty: setConfigDirty, busy: busy === 'config',
      message: settingsMessage,
      onClose: () => setSettingsOpen(false),
      onSave: values => act('config', '/config', {
        daily_limit: Number(values.daily_limit),
        auto_enabled: values.auto_enabled,
        interval_seconds: Number(values.interval_seconds),
      }, '检测设置已保存').then(result => {
        if (!result?.ok) {
          setSettingsMessage({
            ok: false,
            text: result?.busy ? '正在执行其他操作，设置未保存，请稍后重试。' : (result?.error || '设置保存失败，请重试。'),
          });
          return;
        }
        setConfigDirty(false);
        setSettingsMessage({text: '', ok: true});
        setSettingsOpen(false);
      }),
    }) : null);
}

function apply(ctx) {
  if (typeof document !== 'undefined' && !document.getElementById('dic-style')) {
    const style = document.createElement('style');
    style.id = 'dic-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: '模型质量检测',
  }, PanelIcon));
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, CheckPage));
}

const inject = ['slots'];

const CSS = `
.dic-page {
  --dic-accent: color-mix(in srgb, var(--dsw-alias-label-primary) 70%, #18835f);
  --dic-paper: var(--dsw-alias-bg-base);
  --dic-ground: color-mix(in srgb, var(--dic-accent) 5%, var(--dic-paper));
  --dic-selected: color-mix(in srgb, var(--dic-accent) 11%, var(--dic-paper));
  --dic-border: color-mix(in srgb, var(--dic-accent) 16%, var(--dic-paper));
  --dic-muted: color-mix(in srgb, var(--dsw-alias-label-primary) 66%, var(--dic-ground));
  --dic-success: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-label-primary));
  --dic-error: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-label-primary));
  --dic-warning: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-label-primary));
  box-sizing: border-box; height: 100%; overflow: auto; padding: 28px 32px 40px;
  color: var(--dsw-alias-label-primary); background: var(--dic-paper); font-family: var(--dsw-font-family); font-size: 14px;
  container-type: inline-size; scrollbar-color: var(--dic-border) transparent; caret-color: var(--dic-accent);
}
.dic-page * { box-sizing: border-box; letter-spacing: 0; }
.dic-page ::selection { color: var(--dsw-alias-label-primary); background: var(--dic-selected); }
.dic-page h1, .dic-page h2, .dic-page h3, .dic-page p { margin: 0; }
.dic-page h1 { font-size: 22px; font-weight: 600; line-height: 1.35; }
.dic-page h2 { font-size: 17px; font-weight: 600; line-height: 1.5; }
.dic-page h3 { font-size: 14px; font-weight: 600; line-height: 1.5; }
.dic-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.dic-title { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dic-head-actions { display: flex; gap: 8px; }
.dic-status { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.dic-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.dic-status-error .dic-dot { background: var(--dsw-alias-state-error-primary); }
.dic-summary { display: flex; flex-wrap: wrap; gap: 12px 24px; padding: 14px 18px; border-radius: 8px; background: var(--dic-ground); color: var(--dic-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.dic-tabs { display: flex; gap: 28px; border-bottom: 1px solid var(--dic-border); margin-bottom: 24px; overflow-x: auto; }
.dic-tab { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 10px 0 13px; border: 0; border-radius: 0; background: none; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; white-space: nowrap; position: relative; }
.dic-tab[aria-selected=true] { color: var(--dic-accent); font-weight: 600; }
.dic-tab[aria-selected=true]::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--dic-accent); }
.dic-tab-count { font-family: var(--ds-font-family-code); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dic-section { display: grid; gap: 18px; }
.dic-section > *, .dic-trace > * { min-width: 0; }
.dic-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.dic-hint { color: var(--dic-muted); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.dic-error { color: var(--dic-error); }
.dic-ok { color: var(--dic-success); }
.dic-banner, .dic-feedback { padding: 10px 0; line-height: 1.7; }
.dic-banner { margin-bottom: 16px; }
.dic-add { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.dic-add .dic-field { flex: 1; min-width: 160px; }
.dic-field { display: grid; gap: 8px; color: var(--dic-muted); font-size: 13px; min-width: 0; }
.dic-input, .dic-select { min-height: 40px; width: 100%; min-width: 0; padding: 9px 11px; border: 1px solid var(--dic-border); border-radius: 6px; background: var(--dic-paper); color: var(--dsw-alias-label-primary); font: inherit; }
.dic-input { resize: vertical; }
.dic-input::placeholder { color: var(--dic-muted); }
.dic-input:focus-visible, .dic-select:focus-visible, .dic-btn:focus-visible, .dic-tab:focus-visible, .dic-toggle input:focus-visible + .dic-toggle-track, .dic-question:has(input:focus-visible), .dic-page summary:focus-visible, .dic-pre:focus-visible { outline: 2px solid var(--dic-accent); outline-offset: 3px; }
.dic-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 9px 14px; border: 1px solid var(--dic-border); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.4; cursor: pointer; flex-shrink: 0; white-space: nowrap; }
.dic-btn svg { flex-shrink: 0; }
.dic-btn:disabled { opacity: .45; cursor: default; }
.dic-btn-icon { width: 40px; padding: 0; }
.dic-btn-primary { background: var(--dic-accent); border-color: var(--dic-accent); color: var(--dic-paper); }
.dic-text-button { justify-content: flex-start; padding: 4px 0; border: 0; color: var(--dic-accent); min-height: 32px; font-size: 12px; }
.dic-table-wrap { width: 100%; overflow-x: auto; }
.dic-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dic-table th { padding: 10px 12px 10px 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; text-align: left; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dic-table td { padding: 13px 12px 13px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l1); vertical-align: middle; overflow-wrap: anywhere; }
.dic-table th:last-child, .dic-table td:last-child { padding-right: 0; }
.dic-align-right { text-align: right !important; }
.dic-mono { font-family: var(--ds-font-family-code); font-size: 12px; }
.dic-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.dic-empty { padding: 44px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dic-toggle { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; cursor: pointer; flex-shrink: 0; }
.dic-toggle input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.dic-toggle-track { width: 30px; height: 18px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l2); pointer-events: none; }
.dic-toggle-track::before { content: ""; display: block; width: 10px; height: 10px; margin: 3px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
.dic-toggle input:checked + .dic-toggle-track { background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); }
.dic-toggle input:checked + .dic-toggle-track::before { background: var(--dsw-alias-bg-base); margin-left: 15px; }
.dic-monitor-state { display: flex; align-items: center; gap: 5px; }
.dic-workspace { display: grid; grid-template-columns: 264px minmax(0, 1fr); border: 1px solid var(--dic-border); border-radius: 12px; align-items: stretch; min-height: 640px; }
.dic-setup { padding: 22px 20px; min-width: 0; background: var(--dic-ground); border-right: 1px solid var(--dic-border); border-radius: 12px 0 0 12px; }
.dic-setup > .dic-section-head { margin-bottom: 24px; }
.dic-test-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.dic-setup .dic-test-controls { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
.dic-question-list { border: 0; padding: 0; margin: 18px 0 4px; min-width: 0; }
.dic-question-list legend { padding: 0; margin-bottom: 10px; font-size: 13px; font-weight: 600; }
.dic-question { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 46px; margin: 3px -8px; padding: 10px; border-radius: 6px; cursor: pointer; transition: background-color 160ms ease-out, color 160ms ease-out; }
.dic-question input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: 0; }
.dic-question span { font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.dic-question small { color: var(--dic-muted); font-size: 11px; white-space: nowrap; }
.dic-question-selected { background: var(--dic-selected); color: var(--dic-accent); }
.dic-question-selected span { font-weight: 600; }
.dic-question-select { display: none; }
.dic-run-actions { display: grid; gap: 8px; margin: 12px 0 16px; }
.dic-setup .dic-details { margin-top: 4px; }
.dic-setup .dic-details summary { font-size: 12px; color: var(--dic-muted); }
.dic-setup .dic-pre { font-size: 12px; max-height: 340px; padding: 12px; }
.dic-reading { display: grid; align-content: start; gap: 16px; min-width: 0; padding: 26px 28px; }
.dic-answer-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dic-answer-title { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.dic-answer-meta { padding-bottom: 18px; border-bottom: 1px solid var(--dic-border); }
.dic-answer-empty { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; min-height: 350px; text-align: center; color: var(--dic-muted); padding: 32px 16px; }
.dic-answer-empty > svg { color: var(--dic-accent); }
.dic-answer-empty h3 { color: var(--dsw-alias-label-primary); font-size: 17px; }
.dic-answer-empty p { max-width: 42ch; font-size: 13px; line-height: 1.9; white-space: pre-line; }
.dic-run-status { font-variant-numeric: tabular-nums; }
.dic-answer-tools { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dic-answer-tools .dic-select { width: auto; max-width: 260px; }
.dic-pre { margin: 0; min-height: 120px; max-height: 480px; overflow: auto; padding: 16px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code); font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.dic-answer-body { min-height: 280px; max-height: 560px; padding: 12px 0 24px; border: 0; border-radius: 0; background: transparent; font-family: var(--dsw-font-family); font-size: 15px; line-height: 1.95; tab-size: 2; }
.dic-answer-code { font-family: var(--ds-font-family-code); font-size: 13px; }
.dic-review { display: grid; gap: 16px; padding-top: 24px; border-top: 1px solid var(--dic-border); }
.dic-analysis { padding: 0; }
.dic-analysis-row { margin-bottom: 10px; }
.dic-analysis-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 14px; font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.dic-review-fields { display: grid; grid-template-columns: minmax(140px, 180px) minmax(0, 1fr); gap: 16px; }
.dic-details { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dic-details summary { min-height: 44px; padding: 13px 0; cursor: pointer; color: var(--dsw-alias-label-primary); }
.dic-guidance p { color: var(--dic-muted); font-size: 12px; line-height: 1.85; padding-bottom: 14px; overflow-wrap: anywhere; }
.dic-preview { display: grid; gap: 10px; padding-top: 18px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dic-preview img { display: block; width: 100%; height: 360px; object-fit: contain; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); }
.dic-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dic-preview-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dic-preview-tools .dic-select { width: auto; }
.dic-preview-frame { width: 100%; max-width: 100%; overflow: auto; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
.dic-preview iframe { display: block; width: 100%; height: 460px; border: 0; background: var(--dsw-alias-bg-base); }
.dic-preview-expanded { position: fixed; inset: 12px; z-index: 40; padding: 16px; margin: 0; overflow: auto; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-base); box-shadow: var(--dsw-elevation-prominent); }
.dic-preview-expanded .dic-preview-frame { height: calc(100dvh - 180px); }
.dic-preview-expanded iframe { height: 100%; }
.dic-disclaimer { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.8; }
.dic-trace { display: grid; gap: 16px; }
.dic-trace-progress { display: flex; align-items: center; gap: 14px; }
.dic-segments { display: flex; gap: 4px; flex: 1; max-width: 200px; }
.dic-segment { height: 7px; flex: 1; background: var(--dsw-alias-bg-layer-2); }
.dic-segment-complete { background: var(--dsw-alias-label-primary); }
.dic-segment-failed { background: var(--dsw-alias-state-error-primary); }
.dic-segment-cancelled { background: var(--dsw-alias-label-secondary); }
.dic-trace-items { list-style: none; display: grid; gap: 6px; margin: 0; padding: 0; }
.dic-trace-item { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; font-size: 12px; }
.dic-state { display: inline-flex; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dic-state-passed { color: var(--dic-success); }
.dic-state-failed, .dic-state-unavailable { color: var(--dic-error); }
.dic-state-running, .dic-state-truncated, .dic-state-empty { color: var(--dic-warning); }
.dic-trace-report { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.dic-trace-prediction { display: grid; gap: 8px; }
.dic-prediction { font-size: 22px; line-height: 1.3; overflow-wrap: anywhere; }
.dic-probability { font-family: var(--ds-font-family-code); font-size: 22px; }
.dic-candidates { display: grid; gap: 10px; }
.dic-candidate { display: grid; grid-template-columns: minmax(0, 1fr) 160px 72px; gap: 14px; align-items: center; font-size: 12px; }
.dic-bar { height: 4px; background: var(--dsw-alias-bg-layer-2); }
.dic-bar span { display: block; height: 100%; background: var(--dsw-alias-label-primary); }
.dic-history-controls { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.dic-history-controls .dic-field { flex: 1; min-width: 130px; max-width: 260px; }
.dic-records { display: grid; }
.dic-record { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dic-record summary { display: grid; grid-template-columns: 110px minmax(0, 1fr) 140px 100px 92px; gap: 12px; align-items: center; min-height: 46px; padding: 10px 0; cursor: pointer; list-style: none; }
.dic-record summary::-webkit-details-marker { display: none; }
.dic-record-body { display: grid; gap: 12px; padding: 4px 0 18px; }
.dic-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 14px; }
.dic-compare > div { display: grid; gap: 8px; min-width: 0; }
.dic-modal-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--dsw-alias-bg-mask-2); }
.dic-modal { width: min(520px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: 22px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-overlay); box-shadow: var(--dsw-elevation-prominent); display: grid; gap: 18px; }
.dic-modal-head { display: flex; align-items: center; justify-content: space-between; }
.dic-modal form { display: grid; gap: 16px; }
.dic-modal-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; }
.dic-check-row { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
.dic-check-row input { width: 18px; height: 18px; margin: 0; }
@media (hover: hover) {
  .dic-btn:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
  .dic-btn-primary:not(:disabled):hover { background: color-mix(in srgb, var(--dic-accent) 88%, var(--dic-paper)); }
  .dic-text-button:not(:disabled):hover { background: transparent; text-decoration: underline; text-underline-offset: 4px; }
  .dic-question:not(.dic-question-selected):hover { background: var(--dic-selected); }
  .dic-tab:hover { color: var(--dic-accent); }
}
@container (max-width: 740px) {
  .dic-workspace { grid-template-columns: minmax(0, 1fr); }
  .dic-setup { border-right: 0; border-bottom: 1px solid var(--dic-border); border-radius: 12px 12px 0 0; }
  .dic-question-list { display: none; }
  .dic-question-select { display: block; }
  .dic-setup .dic-test-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 12px; }
  .dic-setup .dic-test-controls > .dic-hint { grid-row: 2; }
  .dic-setup .dic-text-button { grid-column: 2; grid-row: 2; justify-content: flex-end; }
  .dic-setup .dic-question-select { grid-column: 2; grid-row: 1; }
  .dic-run-actions { grid-column: 1 / -1; display: flex; margin: 0; }
  .dic-setup .dic-details { margin-top: 12px; }
  .dic-test-controls { grid-template-columns: minmax(0, 1fr); }
  .dic-review-fields, .dic-trace-report, .dic-compare { grid-template-columns: minmax(0, 1fr); }
  .dic-record summary { grid-template-columns: minmax(0, 1fr) 90px; }
  .dic-candidate { grid-template-columns: minmax(0, 1fr) 64px; }
  .dic-candidate .dic-bar { grid-column: 1; grid-row: 2; }
  .dic-candidate .dic-mono:last-child { grid-column: 2; grid-row: 1 / 3; text-align: right; }
  .dic-table-wrap .dic-table { min-width: 640px; }
  .dic-history-controls .dic-field { max-width: none; }
}
@container (max-width: 420px) {
  .dic-title { flex-wrap: wrap; gap: 6px 12px; }
  .dic-tabs { gap: 20px; }
  .dic-setup { padding: 18px 16px; }
  .dic-reading { padding: 22px 16px; }
  .dic-setup .dic-test-controls { grid-template-columns: minmax(0, 1fr); }
  .dic-setup .dic-question-select, .dic-setup .dic-test-controls > .dic-hint, .dic-setup .dic-text-button { grid-column: 1; grid-row: auto; }
  .dic-setup .dic-text-button { justify-content: flex-start; }
  .dic-answer-tools { width: 100%; }
  .dic-answer-tools .dic-select { flex: 1; width: 0; }
  .dic-answer-empty { min-height: 260px; }
  .dic-modal-actions { flex-wrap: wrap; }
  .dic-analysis-row { grid-template-columns: 80px minmax(0, 1fr); }
}
@media (max-width: 820px) { .dic-page { padding: 22px 20px 36px; } }
@media (max-width: 520px) { .dic-page { padding: 20px 14px 32px; } }
@media (prefers-reduced-motion: reduce) { .dic-question { transition: none; } }
`;
