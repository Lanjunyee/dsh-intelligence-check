import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from './index.mjs';
import {hostTarget} from './platform.mjs';

const root = path.resolve(import.meta.dirname, '..');
const {goos, goarch, suffix} = hostTarget();
const local = path.join(root, 'bin', `quality-check${suffix}`);
const binaryPath = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY ||
  (existsSync(local) ? local : path.join(root, 'bin', `quality-check-${goos}-${goarch}${suffix}`));

const catalog = {
  'provider-one': [{provider: 'provider-one', id: 'shared-model', name: 'Shared Model'}],
  'provider-two': [{provider: 'provider-two', id: 'shared-model', name: 'Shared Model'}],
};

function profile(dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-plugin-')), options = {}) {
  const disposers = [];
  const commands = [];
  const listeners = {};
  const streamCalls = [];
  const providers = [
    {id: 'provider-one', name: 'Provider One'},
    {id: 'provider-two', name: 'Provider Two'},
  ];
  const models = {...catalog};
  const stream = options.stream || (async function* () {
    yield {type: 'text-delta', index: 0, text: '46.24 inches'};
    yield {type: 'finish', reason: {kind: 'stop'}};
  });
  const ctx = {
    profileContext: {name: path.basename(dir), dir},
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
      return dispose;
    },
    commands: {
      register(definition) {
        commands.push(definition);
        return () => {};
      },
    },
    llm: {
      listProviders: () => [...providers],
      listModels: async provider => (models[provider] || []).map(model => ({...model})),
      stream: opts => {
        streamCalls.push(opts);
        return stream(opts);
      },
    },
    on(event, handler) {
      listeners[event] = handler;
      return () => {};
    },
    get() {},
    inject() {},
    async emit(event) {
      await listeners[event]?.();
    },
    addProvider(provider, entries) {
      providers.push(provider);
      models[provider.id] = entries;
    },
    async dispose({remove = true} = {}) {
      while (disposers.length > 0) await disposers.pop()();
      if (remove) rmSync(dir, {recursive: true, force: true});
    },
  };
  return {
    dir,
    commands,
    ctx,
    streamCalls,
    async run(line = '/dsh-intelligence-check') {
      const [definition] = commands;
      assert.ok(definition, 'command was not registered');
      return definition.handler({
        agent: {}, commandId: 'command', rawInput: line.slice(definition.name.length + 1),
        attachments: [], signal: new AbortController().signal,
      });
    },
  };
}

async function openConsole(url) {
  const response = await fetch(url, {redirect: 'manual'});
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^quality_session=/);
  return async (pathname, init = {}) => fetch(new URL(pathname, url), {
    ...init,
    headers: {...init.headers, cookie},
  });
}

async function stateOf(console) {
  return (await (await console('/api/state')).json()).state;
}

async function addTarget(console, provider, model, enabled = false) {
  const response = await console('/api/target', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({provider, model, enabled}),
  });
  assert.equal(response.status, 200, await response.text());
}

function targets(state) {
  return state.targets.map(target => `${target.provider}|${target.model}|${target.enabled}`).sort();
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startCheck(console, provider, model, prompt = 'milk') {
  const response = await console('/api/action', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({provider, model, action: 'test', prompt}),
  });
  assert.equal(response.status, 200, await response.text());
}

async function waitRecord(console, provider, model, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = await stateOf(console);
    const record = [...state.results].reverse().find(entry => entry.provider === provider && entry.model === model && entry.prompt === 'milk');
    if (record && predicate(record)) return record;
    await delay(25);
  }
  throw new Error(`${provider}/${model} check did not settle`);
}

test('profile load pushes the host catalog and the command issues an authorized console link', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    assert.equal(p.commands.length, 1);
    assert.equal(p.commands[0].name, 'dsh-intelligence-check');
    assert.ok(existsSync(path.join(p.dir, 'dsh-intelligence-check', 'check.db')), 'profile data directory was not created');
    const result = await p.run();
    assert.equal(result.kind, 'success');
    assert.match(result.text, /http:\/\/127\.0\.0\.1:\d+\/open\/[0-9a-f]{48}/);
    const health = await fetch(new URL('/health', result.text.match(/http:\/\/\S+/)[0]));
    assert.equal(health.status, 204);
    assert.equal(health.headers.get('X-DSH-Intelligence-Check'), 'ready');
    assert.equal(health.headers.has('X-Magpie-Quality'), false);
    const console = await openConsole(result.text.match(/http:\/\/\S+/)[0]);
    const response = await (await console('/api/state')).json();
    assert.deepEqual(response.state.targets, []);
    assert.deepEqual(response.state.results, []);
    assert.equal(response.state.config.daily_limit, 120);
    assert.equal(response.state.config.auto_enabled, false);
    assert.equal(response.state.config.interval_seconds, 900);
    for (const id of ['japan', 'person']) {
      assert.doesNotMatch(response.guidance[id], /门禁/);
      assert.match(response.guidance[id], /手动|人工/);
    }
    assert.deepEqual(response.catalog.map(entry => `${entry.provider}|${entry.model}`).sort(),
      ['provider-one|shared-model', 'provider-two|shared-model']);
  } finally {
    await p.ctx.dispose();
  }
});

test('same model at two providers is saved independently and adding does not monitor', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await addTarget(console, 'provider-two', 'shared-model');
    assert.deepEqual(targets(await stateOf(console)), [
      'provider-one|shared-model|false',
      'provider-two|shared-model|false',
    ]);
  } finally {
    await p.ctx.dispose();
  }
});

test('automatic checks stay off by default and then run milk only for monitored targets', async () => {
  const calls = [];
  const p = profile(undefined, {
    stream: async function* (options) {
      calls.push(options);
      yield {type: 'text-delta', index: 0, text: '46.24 inches'};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    let state = await stateOf(console);
    assert.equal(state.config.auto_enabled, false, 'automatic checks were enabled by default');
    assert.equal(state.config.interval_seconds, 900);
    await addTarget(console, 'provider-one', 'watched', true);
    await addTarget(console, 'provider-one', 'unwatched', false);
    await delay(1200);
    assert.equal(calls.length, 0, 'a non-running automatic check produced a model call');

    const saved = await console('/api/config', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({daily_limit: 120, auto_enabled: true, interval_seconds: 1}),
    });
    assert.equal(saved.status, 200, await saved.text());
    for (let i = 0; i < 200 && calls.length === 0; i++) await delay(25);
    assert.ok(calls.length > 0, 'automatic check did not run without a business conversation');
    for (const options of calls) assert.equal(options.model, 'watched', 'unmonitored target was called');
    assert.equal(calls[0].messages[0].content[0].text,
      (await (await console('/api/state')).json()).prompts.find(prompt => prompt.id === 'milk').text);

    const disabled = await console('/api/config', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({daily_limit: 120, auto_enabled: false, interval_seconds: 1}),
    });
    assert.equal(disabled.status, 200, await disabled.text());
    await delay(200);
    const stopped = calls.length;
    await delay(1300);
    assert.equal(calls.length, stopped, 'automatic checks continued after being disabled');
    state = await stateOf(console);
    assert.equal(state.config.auto_enabled, false);
  } finally {
    await p.ctx.dispose();
  }
});

test('host catalog updates are re-read after adapters register', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    p.ctx.addProvider(
      {id: 'provider-three', name: 'Provider Three'},
      [{provider: 'provider-three', id: 'late-model', name: 'Late Model'}],
    );
    await p.ctx.emit('llm/adapters-updated');
    const response = await (await console('/api/state')).json();
    assert.ok(response.catalog.some(entry => entry.provider === 'provider-three' && entry.model === 'late-model'));
  } finally {
    await p.ctx.dispose();
  }
});

test('two sessions in one profile share the same backend and composite targets', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    const first = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(first, 'provider-one', 'shared-model');
    const second = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    assert.deepEqual(targets(await stateOf(second)), ['provider-one|shared-model|false']);
  } finally {
    await p.ctx.dispose();
  }
});

test('composite targets survive a plugin restart in the same profile', async () => {
  const first = profile();
  const dir = first.dir;
  try {
    await apply(first.ctx, {binaryPath});
    const console = await openConsole((await first.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await addTarget(console, 'provider-two', 'shared-model');
    await first.ctx.dispose({remove: false});

    const second = profile(dir);
    await apply(second.ctx, {binaryPath});
    const reopened = await openConsole((await second.run()).text.match(/http:\/\/\S+/)[0]);
    assert.deepEqual(targets(await stateOf(reopened)), [
      'provider-one|shared-model|false',
      'provider-two|shared-model|false',
    ]);
    await second.ctx.dispose();
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('different profiles keep independent backends, configuration and records', async () => {
  const a = profile();
  const b = profile();
  try {
    await apply(a.ctx, {binaryPath});
    await apply(b.ctx, {binaryPath});
    const consoleA = await openConsole((await a.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(consoleA, 'provider-one', 'profile-a-model');
    const consoleB = await openConsole((await b.run()).text.match(/http:\/\/\S+/)[0]);
    assert.deepEqual((await stateOf(consoleB)).targets, []);
    assert.notEqual(new URL((await a.run()).text.match(/http:\/\/\S+/)[0]).origin,
      new URL((await b.run()).text.match(/http:\/\/\S+/)[0]).origin);
  } finally {
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});

test('disposing the plugin releases the listener and the backend process', async () => {
  const p = profile();
  await apply(p.ctx, {binaryPath});
  const url = (await p.run()).text.match(/http:\/\/\S+/)[0];
  const origin = new URL(url).origin;
  const console = await openConsole(url);
  assert.deepEqual((await stateOf(console)).targets, []);
  await p.ctx.dispose();
  await assert.rejects(fetch(origin + '/health'));
});

test('backend startup failure is reported by the host plugin load', async () => {
  const p = profile();
  try {
    await assert.rejects(apply(p.ctx, {binaryPath: path.join(p.dir, 'missing-binary')}), /无法启动|ENOENT|missing-binary/);
  } finally {
    rmSync(p.dir, {recursive: true, force: true});
  }
});

test('plugin refuses to run without a DSH profile context', async () => {
  await assert.rejects(apply({effect() {}, commands: {register() {}}}, {}), /DSH profile/);
});

test('manual check streams through ctx.llm.stream and persists answer, verdict and usage', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const p = profile(undefined, {
    stream: async function* () {
      yield {type: 'block-start', index: 0, blockType: 'text'};
      yield {type: 'text-delta', index: 0, text: '46.'};
      await gate;
      yield {type: 'text-delta', index: 0, text: '24 inches'};
      yield {type: 'block-end', index: 0, block: {type: 'text', text: '46.24 inches'}};
      yield {type: 'usage', usage: {inputTokens: 12, outputTokens: 5, totalTokens: 17}};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await startCheck(console, 'provider-one', 'shared-model');
    const partial = await waitRecord(console, 'provider-one', 'shared-model', record => record.answer === '46.');
    assert.equal(partial.verdict, 'running', 'increment only visible after completion');
    release();
    const record = await waitRecord(console, 'provider-one', 'shared-model', entry => entry.verdict !== 'running');
    assert.equal(record.answer, '46.24 inches');
    assert.equal(record.verdict, 'passed');
    assert.deepEqual(record.usage, {input_tokens: 12, output_tokens: 5, total_tokens: 17});
    assert.equal(p.streamCalls.length, 1);
    const options = p.streamCalls[0];
    assert.equal(options.provider, 'provider-one');
    assert.equal(options.model, 'shared-model');
    assert.equal(options.maxTokens, 8192);
    assert.equal(options.messages.length, 1);
    assert.equal(options.messages[0].role, 'user');
    assert.equal(options.messages[0].content[0].text, (await (await console('/api/state')).json()).prompts.find(prompt => prompt.id === 'milk').text);
    assert.equal(Object.hasOwn(options, 'sessionId'), false, 'quality check was stamped into a business session');
    assert.equal(Object.hasOwn(options, 'stop'), false, 'unsupported stop option sent');
  } finally {
    await p.ctx.dispose();
  }
});

test('same model at two providers routes to each controlled response', async () => {
  const answers = {'provider-one': '46.24 inches', 'provider-two': '48 inches'};
  const p = profile(undefined, {
    stream: async function* (options) {
      yield {type: 'text-delta', index: 0, text: answers[options.provider]};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await addTarget(console, 'provider-two', 'shared-model');
    await startCheck(console, 'provider-one', 'shared-model');
    await startCheck(console, 'provider-two', 'shared-model');
    const one = await waitRecord(console, 'provider-one', 'shared-model', entry => entry.verdict !== 'running');
    const two = await waitRecord(console, 'provider-two', 'shared-model', entry => entry.verdict !== 'running');
    assert.equal(one.answer, '46.24 inches');
    assert.equal(one.verdict, 'passed');
    assert.equal(two.answer, '48 inches');
    assert.equal(two.verdict, 'failed');
    assert.deepEqual(p.streamCalls.map(options => options.provider), ['provider-one', 'provider-two', 'provider-two']);
  } finally {
    await p.ctx.dispose();
  }
});

test('host cache usage survives records and a plugin restart', async () => {
  const cases = [
    {
      model: 'cache-read',
      host: {inputTokens: 10, outputTokens: 5, cacheReadTokens: 1000},
      expected: {input_tokens: 10, output_tokens: 5, cache_read_tokens: 1000},
    },
    {
      model: 'cache-write',
      host: {inputTokens: 10, outputTokens: 5, cacheWriteTokens: 200, reasoningTokens: 3, totalTokens: 215},
      expected: {input_tokens: 10, output_tokens: 5, cache_write_tokens: 200, reasoning_tokens: 3, total_tokens: 215},
    },
    {
      model: 'cache-only',
      host: {inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000},
      expected: {input_tokens: 0, output_tokens: 0, cache_read_tokens: 1000},
    },
  ];
  const options = {
    stream: async function* ({model}) {
      if (model !== 'cache-only') yield {type: 'text-delta', index: 0, text: '46.24 inches'};
      yield {type: 'usage', usage: cases.find(entry => entry.model === model).host};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  };
  let p = profile(undefined, options);
  const dir = p.dir;
  try {
    p.ctx.addProvider({id: 'cache-provider', name: 'Cache Provider'},
      cases.map(({model}) => ({provider: 'cache-provider', id: model, name: model})));
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    for (const entry of cases) {
      await addTarget(console, 'cache-provider', entry.model);
      await startCheck(console, 'cache-provider', entry.model);
      const record = await waitRecord(console, 'cache-provider', entry.model, result => result.verdict !== 'running');
      assert.deepEqual(record.usage, entry.expected, `${entry.model} usage was lost`);
    }
    await p.ctx.dispose({remove: false});
    p = profile(dir, options);
    await apply(p.ctx, {binaryPath});
    const reopened = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    const state = await stateOf(reopened);
    for (const entry of cases) {
      assert.deepEqual(state.results.find(record => record.model === entry.model).usage, entry.expected,
        `${entry.model} usage was lost after restart`);
    }
  } finally {
    await p.ctx.dispose();
  }
});

test('missing host usage stays absent instead of becoming zero', async () => {
  const p = profile(undefined, {
    stream: async function* () {
      yield {type: 'text-delta', index: 0, text: '46.24 inches'};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await startCheck(console, 'provider-one', 'shared-model');
    const record = await waitRecord(console, 'provider-one', 'shared-model', entry => entry.verdict !== 'running');
    assert.equal(Object.hasOwn(record, 'usage'), false, 'missing usage was fabricated');
  } finally {
    await p.ctx.dispose();
  }
});

test('usage chunk with no reported counts stays absent instead of zero', async () => {
  const p = profile(undefined, {
    stream: async function* () {
      yield {type: 'text-delta', index: 0, text: '46.24 inches'};
      yield {type: 'usage', usage: {}};
      yield {type: 'finish', reason: {kind: 'stop'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await startCheck(console, 'provider-one', 'shared-model');
    const record = await waitRecord(console, 'provider-one', 'shared-model', entry => entry.verdict !== 'running');
    assert.equal(Object.hasOwn(record, 'usage'), false, 'unreported usage was fabricated as zero');
  } finally {
    await p.ctx.dispose();
  }
});

test('empty and truncated host answers get distinct states and keep partial output', async () => {
  const p = profile(undefined, {
    stream: async function* (options) {
      if (options.model === 'empty-model') {
        yield {type: 'finish', reason: {kind: 'stop'}};
        return;
      }
      yield {type: 'text-delta', index: 0, text: 'partial answer'};
      yield {type: 'finish', reason: {kind: 'max-tokens'}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'empty-model');
    await addTarget(console, 'provider-one', 'truncated-model');
    await startCheck(console, 'provider-one', 'empty-model');
    await startCheck(console, 'provider-one', 'truncated-model');
    const empty = await waitRecord(console, 'provider-one', 'empty-model', entry => entry.verdict !== 'running');
    const truncated = await waitRecord(console, 'provider-one', 'truncated-model', entry => entry.verdict !== 'running');
    assert.equal(empty.verdict, 'empty');
    assert.match(empty.error, /空回答/);
    assert.equal(truncated.verdict, 'truncated');
    assert.equal(truncated.answer, 'partial answer');
    assert.match(truncated.error, /截断/);
  } finally {
    await p.ctx.dispose();
  }
});

test('cancel aborts the host stream and preserves the partial answer', async () => {
  const p = profile(undefined, {
    stream: async function* (options) {
      yield {type: 'text-delta', index: 0, text: 'partial'};
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, {once: true}));
      yield {type: 'finish', reason: {kind: 'aborted', failure: {code: 'ABORTED', message: 'Request was aborted'}}};
    },
  });
  try {
    await apply(p.ctx, {binaryPath});
    const console = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    await addTarget(console, 'provider-one', 'shared-model');
    await startCheck(console, 'provider-one', 'shared-model');
    await waitRecord(console, 'provider-one', 'shared-model', entry => entry.answer === 'partial' && entry.verdict === 'running');
    const cancelled = await console('/api/action', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({provider: 'provider-one', model: 'shared-model', action: 'cancel-test'}),
    });
    assert.equal(cancelled.status, 200, await cancelled.text());
    const record = await waitRecord(console, 'provider-one', 'shared-model', entry => entry.verdict !== 'running');
    assert.equal(record.error, '检测已取消');
    assert.equal(record.answer, 'partial');
  } finally {
    await p.ctx.dispose();
  }
});
