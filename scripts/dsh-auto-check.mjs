import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import http from 'node:http';
import path from 'node:path';
import {backendBinary, createDshHarness, getState, openConsoleSession, pluginConfigOverride, postJSON} from './dsh-harness.mjs';

// Real isolated DSH profile plus a controlled host model service. Automatic
// checks are exercised only through the host bridge; no business conversation
// is ever started. A one second interval stands in for the production default.
const {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-auto',
  env: {DSH_IC_LOCAL_KEY: 'local-dummy-key'},
});
assert.ok(existsSync(backendBinary()), '缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundledPlaywright = '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright';
const playwrightPath = process.env.PLAYWRIGHT_MODULE || (existsSync(bundledPlaywright) ? bundledPlaywright : '');
const {chromium} = playwrightPath ? createRequire(import.meta.url)(playwrightPath) : {};
let browser;

const requests = [];
const aborted = [];
let releaseExit;
const exitReleased = new Promise(resolve => { releaseExit = resolve; });

function sse(response, {pieces, finish = 'stop', usage}) {
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  for (const piece of pieces) event({choices: [{index: 0, delta: {content: piece}}]});
  event({choices: [{index: 0, delta: {}, finish_reason: finish}]});
  if (usage) event({choices: [], usage});
  response.end('data: [DONE]\n\n');
}

const complete = (request, response) => sse(response, {
  pieces: ['46.24 inches'], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17},
});

const controlled = http.createServer(async (request, response) => {
  if (request.url?.endsWith('/models')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({object: 'list', data: ['watched-model', 'unwatched-model', 'slow-model', 'budget-model', 'exit-model'].map(id => ({id, object: 'model'}))}));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const model = body.model;
  const content = body.messages?.find(message => message.role === 'user')?.content;
  const prompt = typeof content === 'string'
    ? content
    : (content || []).map(part => part.text || '').join('');
  requests.push({model, prompt, at: Date.now()});
  if (model === 'slow-model') {
    await wait(2500);
    if (!response.writableEnded && !response.destroyed) complete(request, response);
    return;
  }
  if (model === 'exit-model') {
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    response.write(`data: ${JSON.stringify({choices: [{index: 0, delta: {content: 'partial'}}]})}\n\n`);
    await Promise.race([
      new Promise(resolve => response.on('close', resolve)),
      exitReleased,
      wait(30000),
    ]);
    if (response.destroyed) aborted.push(model);
    if (!response.writableEnded) response.end();
    return;
  }
  complete(request, response);
});
await new Promise(resolve => controlled.listen(0, '127.0.0.1', resolve));
const port = controlled.address().port;

function autoPatch() {
  const models = ['watched-model', 'unwatched-model', 'slow-model', 'budget-model', 'exit-model'];
  return `- id: llm-pi-ai
  config:
    providers:
      auto-provider:
        displayName: Auto Provider
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
${models.map(model => `          - id: ${model}
            name: ${model}
            contextWindow: 32768
            maxTokens: 1024
            input: [text]`).join('\n')}
- id: agent-default-model
  config:
    provider: auto-provider
    model: watched-model
${pluginConfigOverride()}`;
}

async function installAutoProfile(name) {
  await installProfile(name, autoPatch());
  return path.join(home, 'profiles', name, 'dsh-intelligence-check');
}

async function openConsole(host) {
  const {console, payload} = await openConsoleSession(host);
  assert.ok(payload.catalog.some(entry => entry.provider === 'auto-provider' && entry.model === 'watched-model'));
  return console;
}

const post = (client, pathname, body) => postJSON(client, pathname, body);
const stateOf = client => getState(client);

async function configure(client, autoEnabled, interval = 1, dailyLimit = 10000) {
  const result = await post(client, '/api/config', {
    daily_limit: dailyLimit, auto_enabled: autoEnabled, interval_seconds: interval,
  });
  assert.equal(result.status, 200, result.text);
}

async function setTarget(client, model, enabled) {
  const result = await post(client, '/api/target', {provider: 'auto-provider', model, enabled});
  assert.equal(result.status, 200, result.text);
}

async function waitRequests(model, count, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = requests.filter(entry => entry.model === model).length;
    if (found >= count) return found;
    await wait(50);
  }
  throw new Error(`${model} 自动调用未达到 ${count} 次，实际 ${requests.filter(entry => entry.model === model).length}`);
}

async function assertNoIncrease(model, duration = 1500) {
  const before = requests.filter(entry => entry.model === model).length;
  await wait(duration);
  const after = requests.filter(entry => entry.model === model).length;
  assert.equal(after, before, `${model} 在停止条件后仍被调用：${before} -> ${after}`);
}

async function waitNoRunning(client) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const payload = await stateOf(client);
    if (!payload.state.results.some(entry => entry.verdict === 'running')) return;
    await wait(100);
  }
  throw new Error('检测未在预期时间结束');
}

async function enableAutoThroughUI(host) {
  if (!chromium) return false;
  const options = {headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge'};
  if (process.env.PLAYWRIGHT_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
    delete options.channel;
  }
  browser = await chromium.launch(options);
  const page = await browser.newPage();
  await page.goto(host.login());
  await page.goto(host.origin() + '/dsh-intelligence-check');
  await page.waitForFunction(() => [...document.querySelectorAll('#targets tr')]
    .some(row => row.textContent.includes('watched-model')), {}, {timeout: 30000});
  await page.locator('#settings').click();
  await page.locator('input[name=auto_enabled]').check();
  await page.locator('input[name=interval_seconds]').fill('1');
  await page.locator('#config button.primary').click();
  await page.waitForFunction(() => document.querySelector('#statAuto')?.textContent === '每 1 秒', {}, {timeout: 15000});
  await browser.close();
  browser = undefined;
  return true;
}

function backendProcesses(dataDir) {
  return execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
}

try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  const dataDir = await installAutoProfile('auto-check');
  let host = await bootProfile('auto-check');
  let client = await openConsole(host);
  let payload = await stateOf(client);
  assert.equal(payload.state.config.auto_enabled, false, '自动检测未默认关闭');
  assert.equal(payload.state.config.interval_seconds, 900, '默认间隔不是 15 分钟');
  const milk = payload.prompts.find(prompt => prompt.id === 'milk').text;

  await setTarget(client, 'watched-model', true);
  await setTarget(client, 'unwatched-model', false);
  await wait(1500);
  assert.equal(requests.length, 0, '默认关闭或仅添加监测目标时发起了质量检测');

  const uiChecked = await enableAutoThroughUI(host);
  if (!uiChecked) await configure(client, true);
  await waitRequests('watched-model', 1);
  assert.equal(requests.filter(entry => entry.model === 'unwatched-model').length, 0, '未监测目标被自动调用');
  assert.ok(requests.every(entry => entry.model === 'watched-model' && entry.prompt === milk), '自动检测未按目标身份执行 milk');

  await configure(client, false);
  await assertNoIncrease('watched-model');

  await configure(client, true);
  await waitRequests('watched-model', requests.filter(entry => entry.model === 'watched-model').length + 1);
  await setTarget(client, 'watched-model', false);
  await assertNoIncrease('watched-model');

  await setTarget(client, 'watched-model', true);
  await waitRequests('watched-model', requests.filter(entry => entry.model === 'watched-model').length + 1);
  for (let i = 0; i < 20; i++) {
    const removed = await post(client, '/api/target/delete', {provider: 'auto-provider', model: 'watched-model'});
    if (removed.status === 200) break;
    assert.match(removed.text, /正在检测/, removed.text);
    await wait(100);
  }
  await assertNoIncrease('watched-model');

  await configure(client, false);
  await setTarget(client, 'slow-model', true);
  await configure(client, true);
  await waitRequests('slow-model', 1);
  await wait(2200);
  assert.equal(requests.filter(entry => entry.model === 'slow-model').length, 1, '同目标定时与运行中检测未合并');
  await waitRequests('slow-model', 2, 8000);
  await configure(client, false);
  await setTarget(client, 'slow-model', false);
  await waitNoRunning(client);

  await setTarget(client, 'budget-model', true);
  await configure(client, true, 1, 1);
  await waitRequests('budget-model', 1);
  await assertNoIncrease('budget-model');
  payload = await stateOf(client);
  const budgetRecord = [...payload.state.results].reverse().find(entry => entry.model === 'budget-model');
  assert.ok(budgetRecord, '预算目标没有生成检测记录');
  const blocked = await post(client, '/api/action', {provider: 'auto-provider', model: 'budget-model', action: 'test', prompt: 'milk'});
  assert.equal(blocked.status, 400);
  assert.match(blocked.text, /预算/);
  const cleared = await post(client, '/api/results/clear', {ids: payload.state.results
    .filter(entry => entry.model === 'budget-model').map(entry => entry.id)});
  assert.equal(cleared.status, 200, cleared.text);
  const stillBlocked = await post(client, '/api/action', {provider: 'auto-provider', model: 'budget-model', action: 'test', prompt: 'milk'});
  assert.equal(stillBlocked.status, 400);
  assert.match(stillBlocked.text, /预算/, '清理历史返还了已消耗预算');

  await configure(client, true, 2, 1);
  await stopHost(host);
  host = await bootProfile('auto-check');
  client = await openConsole(host);
  payload = await stateOf(client);
  assert.equal(payload.state.config.auto_enabled, true, '重启后自动检测开关丢失');
  assert.equal(payload.state.config.interval_seconds, 2, '重启后自动检测间隔丢失');
  assert.ok(payload.state.targets.some(target => target.model === 'budget-model' && target.enabled), '重启后监测目标丢失');
  await wait(2500);
  assert.equal(requests.filter(entry => entry.model === 'budget-model').length, 1, '重启后预算耗尽仍继续调用');

  await configure(client, true, 1, 10000);
  await setTarget(client, 'budget-model', false);
  await setTarget(client, 'exit-model', true);
  await waitRequests('exit-model', 1);
  await stopHost(host);
  for (let i = 0; i < 50 && !aborted.includes('exit-model'); i++) await wait(100);
  assert.ok(aborted.includes('exit-model'), '宿主退出未取消活动的自动模型调用');
  for (let i = 0; i < 50 && backendProcesses(dataDir).length; i++) await wait(100);
  assert.equal(backendProcesses(dataDir).length, 0, '宿主退出后残留后台进程');
  const stopped = requests.filter(entry => entry.model === 'exit-model').length;
  await wait(1500);
  assert.equal(requests.filter(entry => entry.model === 'exit-model').length, stopped, '宿主退出后仍有自动调用');
  releaseExit();

  console.log(`PASS: DSH ${version} 真实隔离 profile 自动检测：默认关闭、仅监测目标 milk、无业务对话触发、关闭/移除停止、并发合并、预算与清理、重启配置、退出取消与清理${uiChecked ? '（设置开关与间隔经浏览器 UI 操作）' : '（未执行浏览器 UI 操作）'}`);
} finally {
  if (browser) await browser.close();
  releaseExit();
  for (const host of hosts) await stopHost(host);
  await new Promise(resolve => controlled.close(resolve));
  await rm(home, {recursive: true, force: true});
  await rm(work, {recursive: true, force: true});
}
