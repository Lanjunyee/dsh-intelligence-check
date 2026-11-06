import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import http from 'node:http';
import {backendBinary, createDshHarness, getState, openConsoleSession, postJSON, pluginConfigOverride} from './dsh-harness.mjs';

// Real isolated DSH profile plus controlled host model services. This covers
// the observable completion matrix introduced by #6 without a browser; the
// console HTTP API used here is the same one the web console calls.
const {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-life',
  env: {DSH_IC_LOCAL_KEY: 'local-controlled-key'},
});
assert.ok(existsSync(backendBinary()), '缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function sse(response, {pieces, finish = 'stop', usage}) {
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  for (const piece of pieces) event({choices: [{index: 0, delta: {content: piece}}]});
  event({choices: [{index: 0, delta: {}, finish_reason: finish}]});
  if (usage) event({choices: [], usage});
  response.end('data: [DONE]\n\n');
}

function controlledService(handlers, slowModels = {}) {
  const requests = [];
  const cancelled = [];
  const server = http.createServer(async (request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({object: 'list', data: Object.keys(handlers).map(id => ({id, object: 'model'}))}));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const model = body.model;
    requests.push(model);
    const handler = handlers[model];
    if (!handler) {
      response.writeHead(404, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message: `unknown controlled model ${model}`}}));
      return;
    }
    if (slowModels[model] && requests.filter(id => id === model).length === 1) {
      response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
      response.write(`data: ${JSON.stringify({choices: [{index: 0, delta: {content: 'partial'}}]})}\n\n`);
      await Promise.race([
        new Promise(resolve => response.on('close', resolve)),
        wait(20000),
      ]);
      if (!response.writableEnded) response.end();
      if (response.destroyed) cancelled.push(model);
      return;
    }
    handler(request, response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    cancelled,
    close: () => new Promise(done => server.close(done)),
  })));
}

const complete = (request, response) => sse(response, {
  pieces: ['46.24 inches'], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17},
});
const noUsage = (request, response) => sse(response, {pieces: ['46.24 inches']});
const truncated = (request, response) => sse(response, {
  pieces: ['partial answer'], finish: 'length', usage: {prompt_tokens: 9, completion_tokens: 2, total_tokens: 11},
});
const failed = (request, response) => {
  response.writeHead(500, {'content-type': 'application/json'});
  response.end(JSON.stringify({error: {message: 'controlled provider failure', type: 'server_error'}}));
};
let retestCalls = 0;
const retest = (request, response) => {
  retestCalls++;
  sse(response, {
    pieces: [retestCalls === 1 ? '48 inches' : '46.24 inches'],
    usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17},
  });
};
const one = await controlledService({
  'complete-model': complete,
  'no-usage-model': noUsage,
  'error-model': failed,
  'truncate-model': truncated,
  'retest-model': retest,
  'slow-model': complete,
}, {'slow-model': true});
const two = await controlledService({'slow-model': complete});

function provider(id, name, origin, models) {
  return `      ${id}:
        displayName: ${name}
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: ${origin}/v1
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

function lifecyclePatch() {
  return `- id: llm-pi-ai
  config:
    providers:
${provider('provider-one', 'Provider One', one.origin, ['complete-model', 'no-usage-model', 'error-model', 'truncate-model', 'retest-model', 'slow-model'])}
${provider('provider-two', 'Provider Two', two.origin, ['slow-model'])}
- id: agent-default-model
  config:
    provider: provider-one
    model: complete-model
${pluginConfigOverride()}`;
}

async function openConsole(host) {
  const {console, payload} = await openConsoleSession(host);
  assert.ok(payload.catalog.some(entry => entry.provider === 'provider-one' && entry.model === 'complete-model'));
  assert.ok(payload.catalog.some(entry => entry.provider === 'provider-two' && entry.model === 'slow-model'));
  return console;
}

async function post(client, pathname, body) {
  const {status, text} = await postJSON(client, pathname, body);
  assert.equal(status, 200, text);
}

async function stateOf(client) {
  return (await getState(client)).state;
}

async function waitRecord(client, providerId, model, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const record = [...(await stateOf(client)).results].reverse()
      .find(entry => entry.provider === providerId && entry.model === model && entry.prompt === 'milk');
    if (record && predicate(record)) return record;
    await wait(100);
  }
  throw new Error(`${providerId}/${model} 检测未达到预期状态`);
}

async function waitRecords(client, providerId, model, count, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const records = (await stateOf(client)).results
      .filter(entry => entry.provider === providerId && entry.model === model && entry.prompt === 'milk');
    if (records.length >= count && records.every(entry => entry.verdict !== 'running')) return records;
    await wait(100);
  }
  throw new Error(`${providerId}/${model} 未产生 ${count} 条结束记录`);
}

async function addTarget(client, providerId, model) {
  await post(client, '/api/target', {provider: providerId, model, enabled: false});
}

async function start(client, providerId, model) {
  await post(client, '/api/action', {provider: providerId, model, action: 'test', prompt: 'milk'});
}

function total(record) {
  return record.usage?.total_tokens;
}

try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('lifecycle-check', lifecyclePatch());
  let host = await bootProfile('lifecycle-check');
  let client = await openConsole(host);

  for (const model of ['complete-model', 'no-usage-model', 'error-model', 'truncate-model', 'retest-model', 'slow-model']) {
    await addTarget(client, 'provider-one', model);
  }
  await addTarget(client, 'provider-two', 'slow-model');

  await start(client, 'provider-one', 'complete-model');
  const completeRecord = await waitRecord(client, 'provider-one', 'complete-model', r => r.verdict !== 'running');
  assert.equal(completeRecord.verdict, 'passed');
  assert.equal(completeRecord.answer, '46.24 inches');
  assert.equal(total(completeRecord), 17);
  assert.equal(completeRecord.finish, 'stop');

  await start(client, 'provider-one', 'no-usage-model');
  const noUsageRecord = await waitRecord(client, 'provider-one', 'no-usage-model', r => r.verdict !== 'running');
  assert.equal(noUsageRecord.verdict, 'passed');
  assert.equal(Object.hasOwn(noUsageRecord, 'usage'), false, '未报告用量被伪造为 0');
  assert.equal(noUsageRecord.finish, 'stop');

  await start(client, 'provider-one', 'error-model');
  const errorRecord = await waitRecord(client, 'provider-one', 'error-model', r => r.verdict !== 'running');
  assert.equal(errorRecord.verdict, 'unavailable');
  assert.match(errorRecord.error, /controlled provider failure/);
  assert.equal(errorRecord.finish, 'error');
  assert.ok(errorRecord.error_code, '宿主错误码未保留');

  await start(client, 'provider-one', 'truncate-model');
  const truncatedRecord = await waitRecord(client, 'provider-one', 'truncate-model', r => r.verdict !== 'running');
  assert.equal(truncatedRecord.verdict, 'truncated');
  assert.equal(truncatedRecord.answer, 'partial answer');
  assert.equal(truncatedRecord.finish, 'max-tokens');

  await start(client, 'provider-one', 'retest-model');
  const retestRecords = await waitRecords(client, 'provider-one', 'retest-model', 2);
  assert.deepEqual(retestRecords.map(record => record.verdict), ['failed', 'passed'], 'milk 异常未独立复测或复测记录未分离');
  assert.equal(retestRecords[0].answer, '48 inches');
  assert.equal(retestRecords[1].answer, '46.24 inches');
  assert.equal(one.requests.filter(model => model === 'retest-model').length, 2, '独立复测请求数异常');

  await start(client, 'provider-one', 'slow-model');
  await waitRecord(client, 'provider-one', 'slow-model', r => r.answer === 'partial' && r.verdict === 'running');
  await start(client, 'provider-two', 'slow-model');
  await post(client, '/api/action', {provider: 'provider-one', model: 'slow-model', action: 'cancel-test'});
  const cancelled = await waitRecord(client, 'provider-one', 'slow-model', r => r.verdict !== 'running');
  assert.equal(cancelled.verdict, 'unavailable');
  assert.equal(cancelled.error, '检测已取消');
  assert.equal(cancelled.answer, 'partial');
  assert.equal(cancelled.finish, 'aborted');
  const other = await waitRecord(client, 'provider-two', 'slow-model', r => r.verdict !== 'running');
  assert.equal(other.verdict, 'passed', '取消 provider-one 影响了同名模型 provider-two');
  assert.equal(total(other), 17);
  for (let i = 0; i < 50 && !one.cancelled.includes('slow-model'); i++) await wait(100);
  assert.ok(one.cancelled.includes('slow-model'), '取消未传递到宿主模型调用');
  assert.equal(one.requests.filter(model => model === 'slow-model').length, 1, '取消后自动复测了模型调用');

  // The same target can run again after cancellation; the retry is a new record.
  await start(client, 'provider-one', 'slow-model');
  const rerun = await waitRecord(client, 'provider-one', 'slow-model',
    r => r.verdict === 'passed' && r.answer === '46.24 inches');
  assert.equal(total(rerun), 17);
  assert.equal((await stateOf(client)).results.filter(r => r.provider === 'provider-one' && r.model === 'slow-model').length, 2);

  await stopHost(host);
  host = await bootProfile('lifecycle-check');
  client = await openConsole(host);
  const restored = await stateOf(client);
  const by = (providerId, model) => [...restored.results].reverse()
    .find(entry => entry.provider === providerId && entry.model === model && entry.prompt === 'milk');
  assert.equal(by('provider-one', 'complete-model').finish, 'stop');
  assert.equal(total(by('provider-one', 'complete-model')), 17);
  assert.equal(Object.hasOwn(by('provider-one', 'no-usage-model'), 'usage'), false, '重启后缺失用量变成 0');
  assert.equal(by('provider-one', 'no-usage-model').finish, 'stop');
  assert.equal(by('provider-one', 'error-model').verdict, 'unavailable');
  assert.equal(by('provider-one', 'error-model').finish, 'error');
  assert.ok(by('provider-one', 'error-model').error_code);
  assert.equal(by('provider-one', 'truncate-model').answer, 'partial answer');
  assert.equal(by('provider-one', 'truncate-model').finish, 'max-tokens');
  const restoredRetest = restored.results.filter(entry => entry.provider === 'provider-one' &&
    entry.model === 'retest-model' && entry.prompt === 'milk');
  assert.deepEqual(restoredRetest.map(record => record.verdict), ['failed', 'passed'], '重启后独立复测记录丢失');
  assert.deepEqual(restoredRetest.map(record => record.answer), ['48 inches', '46.24 inches']);
  const cancelledRecord = restored.results.find(entry => entry.provider === 'provider-one' &&
    entry.model === 'slow-model' && entry.error === '检测已取消');
  assert.equal(cancelledRecord.answer, 'partial');
  assert.equal(cancelledRecord.verdict, 'unavailable');
  assert.equal(cancelledRecord.finish, 'aborted');
  const rerunRecord = restored.results.find(entry => entry.provider === 'provider-one' &&
    entry.model === 'slow-model' && entry.verdict === 'passed');
  assert.equal(rerunRecord.answer, '46.24 inches');
  assert.equal(total(rerunRecord), 17);
  assert.ok(restored.results.every(record => record.verdict !== 'running'), '重启后仍有进行中记录');

  await stopHost(host);
  console.log(`PASS: DSH ${version} 真实隔离 profile 生命周期矩阵：完整/缺用量/错误/截断/取消/独立复测/同名目标隔离/取消后重跑/重启保留`);
} finally {
  for (const host of hosts) await stopHost(host);
  await one.close();
  await two.close();
  await rm(home, {recursive: true, force: true});
  await rm(work, {recursive: true, force: true});
}
