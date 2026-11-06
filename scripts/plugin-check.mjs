import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.env.PLUGIN_ROOT || path.resolve(import.meta.dirname, '..');
const {apply} = await import(pathToFileURL(path.join(root, 'plugin/index.mjs')));
const dir = await mkdtemp(path.join(os.tmpdir(), 'quality-plugin-'));
const disposers = [];
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
  inject() {},
  on() { return () => {}; },
  llm: {
    listProviders: () => [],
    listModels: async () => [],
  },
};
try {
  await apply(ctx, process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY
    ? {binaryPath: process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY}
    : {});
  const [command] = commands;
  assert.equal(command.name, 'dsh-intelligence-check');
  const result = await command.handler({rawInput: '', agent: {}, attachments: [], signal: new AbortController().signal});
  assert.equal(result.kind, 'success', result.text);
  const url = result.text.match(/http:\/\/\S+/)[0];
  const opened = await fetch(url, {redirect: 'manual'});
  assert.equal(opened.status, 303);
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  const state = await fetch(new URL('/api/state', url), {headers: {cookie}});
  assert.equal(state.status, 200);
  assert.deepEqual((await state.json()).state.targets, []);
  const origin = new URL(url).origin;
  while (disposers.length > 0) await disposers.pop()();
  await assert.rejects(fetch(origin + '/health'));
  console.log('PASS: native plugin starts the backend, issues an authorized console link and cleans up');
} finally {
  await rm(dir, {recursive: true, force: true});
}
