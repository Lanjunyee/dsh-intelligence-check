import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import {copyFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  backendBinary, cookieHeader, createDshHarness, getState, openPageSession, pluginConfigOverride, postJSON,
} from './dsh-harness.mjs';

// Issue #16 regression at the confirmed public seams: real isolated DSH_HOME,
// real Go backend, host HTTP requests and process observation. No internal
// recovery function is called and no data-directory override is used.
const sourceBinary = backendBinary();
assert.ok(existsSync(sourceBinary), '缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check');

const binaryDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-recovery-bin-'));
const testBinary = path.join(binaryDir, 'quality-check');
await copyFile(sourceBinary, testBinary);
chmodSync(testBinary, 0o755);
process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY = testBinary;

const {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-recovery',
  env: {DSH_IC_LOCAL_KEY: 'local-controlled-key'},
});
const dataDir = path.join(home, 'dsh-intelligence-check');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const requests = [];
const aborted = [];
function sse(response, pieces, {finish = 'stop', usage} = {}) {
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  for (const piece of pieces) event({choices: [{index: 0, delta: {content: piece}}]});
  event({choices: [{index: 0, delta: {}, finish_reason: finish}]});
  if (usage) event({choices: [], usage});
  response.end('data: [DONE]\n\n');
}

const controlled = http.createServer(async (request, response) => {
  if (request.url?.endsWith('/models')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({object: 'list', data: ['recover-model', 'slow-model'].map(id => ({id, object: 'model'}))}));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const model = body.model;
  requests.push({model, at: Date.now()});
  if (model === 'slow-model') {
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    response.write(`data: ${JSON.stringify({choices: [{index: 0, delta: {content: 'partial'}}]})}\n\n`);
    await Promise.race([new Promise(resolve => response.on('close', resolve)), wait(30000)]);
    if (response.destroyed) aborted.push(model);
    if (!response.writableEnded) response.end();
    return;
  }
  sse(response, ['46.24 inches'], {
    usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17},
  });
});
await new Promise(resolve => controlled.listen(0, '127.0.0.1', resolve));
const controlledPort = controlled.address().port;

function provider(id, models) {
  return `      ${id}:
        displayName: ${id}
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${controlledPort}/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
${models.map(model => `          - id: ${model}
            name: ${model}
            contextWindow: 32768
            maxTokens: 1024
            input: [text]`).join('\n')}`;
}

function patch(providerId) {
  return `- id: llm-pi-ai
  config:
    providers:
${provider(providerId, ['recover-model', 'slow-model'])}
- id: agent-default-model
  config:
    provider: ${providerId}
    model: recover-model
${pluginConfigOverride()}`;
}

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
}

async function waitUntil(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(50);
  }
  assert.fail(message);
}

async function waitProcessCount(count, timeout = 10000) {
  await waitUntil(() => processes().length === count,
    `共享后台进程数不是 ${count}，实际 ${processes().length}`, timeout);
}

async function stateResponse(client) {
  return fetch(client.origin + '/dsh-intelligence-check/api/state', {headers: {cookie: client.session}});
}

async function post(client, pathname, body) {
  const {status, text} = await postJSON(client, pathname, body);
  assert.equal(status, 200, text);
}

async function concurrentState(client, count) {
  return Promise.all(Array.from({length: count}, () => stateResponse(client)));
}

try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('recover-a', patch('provider-a'));
  await installProfile('recover-b', patch('provider-b'));
  await installProfile('recover-cli', patch('provider-cli'));

  // A plain CLI/Web host must not start a backend when no desktop one exists.
  const cliHost = await bootProfile('recover-cli',
    {...env, DSH_INTELLIGENCE_CHECK_DESKTOP: undefined, DSH_CLIENT_VERSION: undefined},
    {readyMarker: '[dsh-intelligence-check] CLI host detected'});
  const cliLogin = await fetch(cliHost.login(), {redirect: 'manual'});
  assert.equal(cliLogin.status, 303);
  const cli = {origin: cliHost.origin(), session: cookieHeader(cliLogin)};
  let cliState = await stateResponse(cli);
  assert.equal(cliState.status, 503, 'CLI host served a state without a desktop backend');
  await cliState.body?.cancel();
  await waitProcessCount(0);

  const aHost = await bootProfile('recover-a');
  const bHost = await bootProfile('recover-b');
  const a = (await openPageSession(aHost)).client;
  const b = (await openPageSession(bHost)).client;
  await post(a, '/api/target', {provider: 'provider-b', model: 'recover-model', enabled: false});
  const before = await (await stateResponse(b)).json();
  assert.deepEqual(before.state.targets.map(target => `${target.provider}|${target.model}`),
    ['provider-b|recover-model']);
  await waitProcessCount(1);

  // The owning desktop exits; the remaining desktop no longer has a live origin.
  await stopHost(aHost);
  await waitProcessCount(0);

  // Concurrent page/profile requests must share one recovery, not spawn a
  // chain of backends whose ownership and cleanup depend on request ordering.
  const responses = await concurrentState(b, 12);
  const statuses = responses.map(response => response.status);
  assert.deepEqual(statuses, Array(12).fill(200), `concurrent recovery responses: ${statuses.join(',')}`);
  const states = await Promise.all(responses.map(response => response.json()));
  for (const payload of states) {
    assert.deepEqual(payload.state.targets.map(target => `${target.provider}|${target.model}`),
      ['provider-b|recover-model'], 'concurrent recovery returned inconsistent shared state');
  }
  await waitProcessCount(1);

  // A failed recovery must release the in-flight attempt so a later request can
  // retry once the condition is fixed.
  const ownerPid = Number(processes()[0].trim().split(/\s+/)[0]);
  process.kill(ownerPid, 'SIGTERM');
  await waitProcessCount(0);
  renameSync(testBinary, testBinary + '.missing');
  const failed = await concurrentState(b, 6);
  assert.deepEqual(failed.map(response => response.status), Array(6).fill(503),
    'recovery failures did not surface as unavailable');
  for (const response of failed) await response.body?.cancel();
  assert.equal(processes().length, 0, 'failed recovery left a backend process');
  renameSync(testBinary + '.missing', testBinary);
  const retried = await concurrentState(b, 6);
  assert.deepEqual(retried.map(response => response.status), Array(6).fill(200),
    'a failed recovery was never retried');
  for (const response of retried) await response.body?.cancel();
  await waitProcessCount(1);

  // Automatic checks enabled on the recovered desktop keep one scheduler: one
  // process, one request per interval, no duplicate bursts.
  await post(b, '/api/target', {provider: 'provider-b', model: 'recover-model', enabled: true});
  await post(b, '/api/config', {daily_limit: 10000, auto_enabled: true, interval_seconds: 2});
  await waitUntil(() => requests.filter(entry => entry.model === 'recover-model').length >= 2,
    'automatic check did not resume after recovery', 15000);
  const auto = requests.filter(entry => entry.model === 'recover-model');
  for (let i = 1; i < auto.length; i++) {
    assert.ok(auto[i].at - auto[i - 1].at >= 1200,
      `automatic checks produced a duplicate burst: ${auto[i].at - auto[i - 1].at}ms apart`);
  }
  await waitProcessCount(1);
  await post(b, '/api/config', {daily_limit: 10000, auto_enabled: false, interval_seconds: 2});

  // The CLI/Web host joins the recovered desktop backend without publishing its
  // own model catalog.
  cliState = await stateResponse(cli);
  assert.equal(cliState.status, 200, 'CLI host could not join the running desktop backend');
  const joined = await cliState.json();
  assert.deepEqual([...new Set(joined.catalog.map(entry => entry.provider))], ['provider-b'],
    'CLI host published its own model catalog');
  await waitProcessCount(1);

  // Stopping the desktop host that recovered under concurrency must end the
  // backend and cancel the active model call.
  await post(b, '/api/target', {provider: 'provider-b', model: 'slow-model', enabled: false});
  await post(b, '/api/action', {provider: 'provider-b', model: 'slow-model', action: 'test', prompt: 'milk'});
  await waitUntil(() => requests.some(entry => entry.model === 'slow-model'), 'active check was not started');
  const started = requests.length;
  await stopHost(bHost);
  await waitUntil(() => aborted.includes('slow-model'), 'host exit did not cancel the active model call', 10000);
  await waitProcessCount(0);
  await wait(1000);
  assert.equal(requests.length, started, 'host exited but its recovered backend kept checking');

  // With the desktop backend gone the CLI host returns unavailable and still
  // does not start or take over a backend.
  cliState = await stateResponse(cli);
  assert.equal(cliState.status, 503, 'CLI host kept serving without the desktop backend');
  await cliState.body?.cancel();
  await waitProcessCount(0);

  console.log(`PASS: DSH ${version} 共享后台并发恢复：单进程/单调度、失败重试、桌面退出取消与清理、CLI/Web 只连接不启动不接管不推目录`);
} finally {
  for (const host of hosts) await stopHost(host);
  await new Promise(resolve => controlled.close(resolve));
  rmSync(home, {recursive: true, force: true});
  rmSync(work, {recursive: true, force: true});
  rmSync(binaryDir, {recursive: true, force: true});
}
