import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.env.PLUGIN_ROOT || path.resolve(import.meta.dirname, '..');
const {apply} = await import(pathToFileURL(path.join(root, 'plugin/index.mjs')));
const dir = await mkdtemp(path.join(os.tmpdir(), 'quality-plugin-'));
const dataDir = path.join(dir, 'dsh-intelligence-check');
process.env.DSH_HOME = dir;
const disposers = [];
const injections = [];
const routes = [];
const commands = [];
const ctx = {
  profileContext: {name: 'plugin-check', dir},
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  },
  commands: {register(definition) {
    commands.push(definition);
    return () => {};
  }},
  get() {},
  inject(services, fn) { injections.push({services, fn}); },
  on() { return () => {}; },
  llm: {
    listProviders: () => [],
    listModels: async () => [],
  },
};
try {
  await apply(ctx, {
    desktop: true,
    ...(process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY
      ? {binaryPath: process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY}
      : {}),
  });
  assert.deepEqual(commands, [], 'the removed slash command was still registered');
  for (const {fn} of injections) {
    fn({
      effect(nested) { const dispose = nested(); disposers.push(dispose); return dispose; },
      webServer: {register(route) { routes.push(route); return () => {}; }},
      connection: {requestRejection: () => 0},
    });
  }
  const [route] = routes;
  assert.equal(route.path, '/dsh-intelligence-check');
  assert.equal(route.kind, 'prefix');
  const server = createServer((request, response) => route.handler(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(origin + '/dsh-intelligence-check/api/state')).json();
  assert.deepEqual(state.state.targets, []);
  assert.deepEqual(state.state.results, []);
  assert.equal(state.state.config.auto_enabled, false);
  while (disposers.length > 0) await disposers.pop()();
  await new Promise(resolve => server.close(resolve));
  for (let i = 0; i < 100; i++) {
    const left = execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
      .split('\n').filter(line => line.includes(dataDir));
    if (left.length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const left = execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
  assert.deepEqual(left, [], 'plugin disposal left the shared backend running');
  console.log('PASS: native plugin starts the shared desktop backend, serves the page API and cleans up');
} finally {
  await rm(dir, {recursive: true, force: true});
}
