import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from './index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const platform = ({win32: 'windows'})[process.platform] || process.platform;
const arch = ({x64: 'amd64', arm64: 'arm64'})[process.arch] || process.arch;
const suffix = platform === 'windows' ? '.exe' : '';
const local = path.join(root, 'bin', `quality-check${suffix}`);
const binaryPath = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY ||
  (existsSync(local) ? local : path.join(root, 'bin', `quality-check-${platform}-${arch}${suffix}`));

function profile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-plugin-'));
  const disposers = [];
  const commands = [];
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
    get() {},
    inject() {},
    async dispose() {
      while (disposers.length > 0) await disposers.pop()();
      rmSync(dir, {recursive: true, force: true});
    },
  };
  return {
    dir,
    commands,
    ctx,
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

test('profile load starts the backend and the host command issues an authorized console link', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    assert.equal(p.commands.length, 1);
    assert.equal(p.commands[0].name, 'dsh-intelligence-check');
    assert.ok(existsSync(path.join(p.dir, 'dsh-intelligence-check', 'check.db')), 'profile data directory was not created');
    const result = await p.run();
    assert.equal(result.kind, 'success');
    assert.match(result.text, /http:\/\/127\.0\.0\.1:\d+\/open\/[0-9a-f]{48}/);
    const console = await openConsole(result.text.match(/http:\/\/\S+/)[0]);
    const state = await stateOf(console);
    assert.deepEqual(state.targets, {});
    assert.deepEqual(state.results, []);
    assert.equal(state.config.daily_limit, 120);
  } finally {
    await p.ctx.dispose();
  }
});

test('two sessions in one profile share the same backend, configuration and records', async () => {
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath});
    const first = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    const saved = await first('/api/target', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'shared-model', enabled: false}),
    });
    assert.equal(saved.status, 200);
    const second = await openConsole((await p.run()).text.match(/http:\/\/\S+/)[0]);
    assert.equal((await stateOf(second)).targets['shared-model'].model, 'shared-model');
  } finally {
    await p.ctx.dispose();
  }
});

test('different profiles keep independent backends, configuration and records', async () => {
  const a = profile();
  const b = profile();
  try {
    await apply(a.ctx, {binaryPath});
    await apply(b.ctx, {binaryPath});
    const consoleA = await openConsole((await a.run()).text.match(/http:\/\/\S+/)[0]);
    await consoleA('/api/target', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'profile-a-model', enabled: false}),
    });
    const consoleB = await openConsole((await b.run()).text.match(/http:\/\/\S+/)[0]);
    assert.deepEqual((await stateOf(consoleB)).targets, {});
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
  assert.deepEqual((await stateOf(console)).targets, {});
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
