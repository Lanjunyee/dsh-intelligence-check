import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {core} from './client-core.mjs';

const root = path.resolve(import.meta.dirname, '..');

function fakeReact(overrides = []) {
  let index = 0;
  const value = initial => typeof initial === 'function' ? initial() : initial;
  return {
    createElement(type, props, ...children) {
      return {type, props: props || {}, children};
    },
    useState(initial) {
      const position = index++;
      return [position < overrides.length ? overrides[position] : value(initial), () => {}];
    },
    useEffect() {},
    useMemo(fn) { return fn(); },
    useRef(initial) { return {current: value(initial)}; },
    useCallback(fn) { return fn; },
  };
}

async function loadBundle(overrides = []) {
  const source = await readFile(path.join(root, 'plugin/client.js'), 'utf8');
  const registrations = [];
  const external = [];
  const React = fakeReact(overrides);
  const requireReact = specifier => {
    if (specifier !== 'react') throw new Error(`unexpected external ${specifier}`);
    external.push(specifier);
    return React;
  };
  vm.runInNewContext(source, {
    window: {__ModuleLoader__: {load(registration) { registrations.push(registration); }}},
    require: requireReact,
    console,
  }, {filename: 'plugin/client.js'});
  assert.equal(registrations.length, 1, 'bundle must register exactly one factory');
  assert.equal(registrations[0].id, 'dsh-intelligence-check');
  const exports = registrations[0].factory(requireReact);
  return {exports, source, external, React};
}

function registrationsOf(exports) {
  const injections = [];
  const registrations = [];
  exports.apply({slots: {
    inject(name, callback) { injections.push(name); callback(); },
    register(definition, component) { registrations.push({definition, component}); },
  }});
  return {injections, registrations};
}

async function pageWith(overrides) {
  const {exports, React} = await loadBundle(overrides);
  const {registrations} = registrationsOf(exports);
  return {page: registrations.find(item => item.definition.name === 'main').component, React};
}

function containsText(element, text) {
  if (element === null || element === undefined) return false;
  if (typeof element === 'string') return element.includes(text);
  if (typeof element !== 'object') return false;
  return element.children?.some(child => containsText(child, text)) ?? false;
}

const state = {
  state: {
    config: {daily_limit: 120, auto_enabled: false, interval_seconds: 900},
    targets: [{provider: 'provider-one', model: 'shared-model', enabled: true}],
    results: [{
      id: 'record-1', provider: 'provider-one', model: 'shared-model', prompt: 'milk',
      verdict: 'passed', answer: '46.24 inches', time: new Date().toISOString(),
      usage: {total_tokens: 17}, review: 'accepted', reviewed_at: new Date().toISOString(),
    }],
    cleared_usage: {},
  },
  catalog: [{provider: 'provider-one', provider_name: 'Provider One', model: 'shared-model', name: 'Shared Model'}],
  prompts: [{id: 'milk', name: 'Milk', text: 'milk prompt'}, {id: 'html', name: 'HTML', text: 'html prompt'}],
  guidance: {milk: 'guidance'},
  health: '',
};

test('the client bundle is a single factory for the package id', async () => {
  const {exports, source, external} = await loadBundle();
  assert.deepEqual(external, ['react']);
  assert.deepEqual(Array.from(exports.inject), ['slots']);
  assert.equal(typeof exports.apply, 'function');
  assert.match(source, /window\.__ModuleLoader__\.load\(\{ id: "dsh-intelligence-check"/);
  assert.doesNotMatch(source, /^\s*import\s/m, 'bundled client must not keep ESM imports');
});

test('apply registers the sidebar entry and the same-id main page', async () => {
  const {exports} = await loadBundle();
  const {injections, registrations} = registrationsOf(exports);
  assert.deepEqual(injections, ['sidebar.panellist', 'main']);
  const sidebar = registrations.find(item => item.definition.name === 'sidebar.panellist');
  const main = registrations.find(item => item.definition.name === 'main');
  assert.equal(sidebar.definition.id, 'dsh-intelligence-check');
  assert.equal(sidebar.definition.label, '模型质量检测');
  assert.equal(main.definition.key, 'dsh-intelligence-check');
  assert.equal(typeof sidebar.component, 'function');
  assert.equal(typeof main.component, 'function');
  assert.equal(sidebar.component({size: 18}).props.name, 'activity');
  assert.equal(sidebar.component({size: 18}).props.size, 18);
});

test('the main page renders its empty connection state without data', async () => {
  const {page} = await pageWith([]);
  const tree = page({});
  assert.ok(containsText(tree, '模型质量检测'));
  assert.ok(containsText(tree, '正在连接…') || containsText(tree, '质量检测后台不可用'));
});

test('every tab renders with shared state', async () => {
  for (const [tab, expected] of [['models', '检测目标'], ['tests', '质量题库'], ['fingerprint', 'ModelTrace'], ['history', '检测记录']]) {
    // useState order: data, error, feedback, tab, ...
    const {page} = await pageWith([state, '', {text: '', ok: true}, tab]);
    const tree = page({});
    assert.ok(containsText(tree, expected), `${tab} view did not render ${expected}`);
  }
});

test('the default workspace shows questions and keeps text buttons at their natural width', async () => {
  const {page} = await pageWith([state]);
  const tree = page({});
  assert.ok(containsText(tree, '质量题库'));
  assert.ok(containsText(tree, '手动测试无需开启自动监测。'));
  const nodes = [tree];
  const buttons = [];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;
    if (typeof node.type === 'function' && node.type.name === 'Button') buttons.push(node);
    nodes.push(...(node.children || []).flat());
  }
  const run = buttons.find(node => node.props.label === '运行所选题目');
  const copy = buttons.find(node => node.props.label === '复制回答');
  assert.ok(run && copy);
  assert.doesNotMatch(run.type({...run.props, children: run.children[0]}).props.className, /dic-btn-icon/);
  assert.match(copy.type(copy.props).props.className, /dic-btn-icon/);
});

test('cancelled quality checks present as cancelled without changing the stored verdict', () => {
  const aborted = {
    id: 'cancelled', provider: 'p', model: 'm', prompt: 'person', verdict: 'unavailable',
    error: '检测已取消', finish: 'aborted', time: '2026-01-03T00:00:00Z',
  };
  const failed = {
    id: 'failed', provider: 'p', model: 'm', prompt: 'person', verdict: 'unavailable',
    error: '调用失败', time: '2026-01-03T00:01:00Z',
  };
  assert.equal(core.isCancelled(aborted), true);
  assert.equal(core.isCancelled(failed), false);
  assert.equal(core.displayVerdict(aborted), 'cancelled');
  assert.equal(core.displayVerdict(failed), 'unavailable');
  assert.equal(aborted.verdict, 'unavailable', '原始存储 verdict 被改写');
  const state = {results: [aborted, failed], cleared_usage: {}};
  assert.deepEqual(core.filterResults(state, {verdict: 'cancelled'}).map(item => item.id), ['cancelled']);
  assert.deepEqual(core.filterResults(state, {verdict: 'unavailable'}).map(item => item.id), ['failed']);
});

test('same-second ModelTrace challenges are told apart by their batch position', () => {
  const batch = 'batch-1';
  const results = [
    {id: 'a', prompt: 'modeltrace', batch, verdict: 'manual', time: '2026-01-01T00:00:00Z'},
    {id: 'b', prompt: 'modeltrace', batch, verdict: 'manual', time: '2026-01-01T00:00:00Z'},
    {id: 'c', prompt: 'modeltrace', batch, verdict: 'manual', time: '2026-01-01T00:00:00Z'},
    {id: 'other', prompt: 'milk', verdict: 'passed', time: '2026-01-01T00:00:00Z'},
  ];
  assert.deepEqual(results.slice(0, 3).map(item => core.traceChallenge(results, item)), [1, 2, 3]);
  assert.equal(core.traceChallenge(results, results[3]), 0);
  assert.equal(core.traceChallenge(results, {id: 'x', prompt: 'modeltrace', batch: 'missing'}), 0);
});

test('pure helpers keep their observable contracts', () => {
  assert.equal(core.identity('a', 'b'), 'a\u0000b');
  assert.equal(core.usageLabel({usage: {input_tokens: 10, output_tokens: 5, cache_read_tokens: 2}}), '17 tokens');
  assert.equal(core.usageLabel({usage: {total_tokens: 0}}), '0 tokens');
  assert.equal(core.usageLabel({verdict: 'running'}), '用量不可用');
  assert.deepEqual(core.usageTotals([
    {verdict: 'passed', usage: {total_tokens: 4}},
    {verdict: 'passed'},
    {verdict: 'running', usage: {total_tokens: 99}},
  ]), {total: 4, reported: 1, missing: 1});
  assert.equal(core.traceBatchState([{verdict: 'manual'}, {verdict: 'manual'}, {verdict: 'manual'}]), 'complete');
  assert.equal(core.traceBatchState([{verdict: 'manual'}, {verdict: 'cancelled'}, {verdict: 'skipped'}]), 'cancelled');
  assert.equal(core.traceBatchState([{verdict: 'running'}]), 'running');
  const sample = {
    results: [
      {id: '1', provider: 'p', model: 'm', prompt: 'milk', verdict: 'passed', review: 'accepted', time: '2026-01-01T00:00:00Z'},
      {id: '2', provider: 'q', model: 'n', prompt: 'html', verdict: 'failed', time: '2026-01-02T00:00:00Z'},
    ],
    cleared_usage: {},
  };
  assert.deepEqual(core.filterResults(sample, {model: 'p\u0000m'}).map(item => item.id), ['1']);
  assert.deepEqual(core.filterResults(sample, {verdict: 'failed'}).map(item => item.id), ['2']);
  assert.deepEqual(core.filterResults(sample, {review: 'pending'}).map(item => item.id), ['2']);
  const checks = core.analyzeAnswer({
    answer: '1. alpha\n2. beta', prompt: 'repeat', verdict: 'passed',
  }, {text: '1. alpha\n2. beta\n3. gamma'});
  assert.ok(checks.some(([label]) => label === '逐字覆盖'));
});
