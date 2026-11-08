import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {
  backendBinary, backendProcesses, createDshHarness, getState, loadPlaywright, openNativePage, openPageSession,
  pluginConfigOverride, postJSON, waitForProcessCount,
} from './dsh-harness.mjs';

const {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic',
  env: {DSH_IC_LOCAL_KEY: 'local-controlled-key'},
});
const sharedDir = path.join(home, 'dsh-intelligence-check');
assert.ok(existsSync(backendBinary()), `缺少后台二进制，请先构建：go build -o bin/quality-check ./cmd/quality-check`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const {chromium} = loadPlaywright({optional: true}) || {};

const mock = http.createServer(async (request, response) => {
  if (request.url?.endsWith('/models')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({object: 'list', data: ['shared-model', 'html-model', 'svg-model'].map(id => ({id, object: 'model'}))}));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const content = body.messages?.find(message => message.role === 'user')?.content;
  const prompt = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
  let answer = '46.24 inches';
  const traceCount = prompt.match(/(\d+)\s*个\s*1 到 355/);
  if (traceCount) {
    answer = Array.from({length: Number(traceCount[1])}, (_, index) => 1 + (index * 37) % 355).join(', ');
  } else if (prompt.includes('鹈鹕骑自行车')) {
    answer = '```html\n<!doctype html><html><body><h1 id="pelican">Pelican rides</h1><script>parent.postMessage({type:"intelligence-preview-ready"},"*")</script></body></html>\n```';
  } else if (prompt.includes('pelican riding a bicycle')) {
    answer = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#d33"/><circle cx="60" cy="40" r="24" fill="#fff"/></svg>';
  }
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  event({choices: [{index: 0, delta: {content: answer}}]});
  event({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]});
  event({choices: [], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17}});
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;

function provider(id, name, models) {
  return `      ${id}:
        displayName: ${name}
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${mockPort}/v1
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
  const models = providerId === 'fixture-one' ? ['shared-model', 'html-model', 'svg-model'] : ['shared-model'];
  return `- id: llm-pi-ai
  config:
    providers:
${provider(providerId, providerId === 'fixture-one' ? 'Fixture One' : 'Fixture Two', models)}
- id: agent-default-model
  config:
    provider: ${providerId}
    model: shared-model
${pluginConfigOverride()}`;
}

async function uninstallProfile(name) {
  const removed = dshRun(['plugin', '--profile', name, 'remove', 'dsh-intelligence-check']);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  const profile = JSON.parse(await readFile(path.join(home, 'profiles', name, 'package.json'), 'utf8'));
  assert.equal(profile.dependencies?.['dsh-intelligence-check'], undefined, '卸载后 profile 依赖仍在');
  assert.ok(!profile.dsh?.profile?.bundles?.includes('dsh-intelligence-check'), '卸载后 bundle 层仍在');
  const dump = dshRun(['--profile', name, '--dump-config']);
  assert.equal(dump.status, 0, dump.stdout + dump.stderr);
  assert.ok(!dump.stdout.includes('# == dsh-intelligence-check'), '卸载后配置仍包含插件层');
}

async function post(client, pathname, body) {
  const {status, text} = await postJSON(client, pathname, body);
  assert.equal(status, 200, text);
}

async function stateOf(client) {
  return (await getState(client)).state;
}

async function waitResult(client, providerId, model, prompt, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const record = [...(await stateOf(client)).results].reverse()
      .find(entry => entry.provider === providerId && entry.model === model && entry.prompt === prompt);
    if (record && predicate(record)) return record;
    await wait(100);
  }
  throw new Error(`${providerId}/${model}/${prompt} 检测未达到预期状态`);
}

let browser;
let uiChecked = false;
try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('check-a', patch('fixture-one'));
  await installProfile('check-b', patch('fixture-two'));
  await installProfile('check-cli', patch('fixture-two'));

  const a = await bootProfile('check-a');
  assert.ok(existsSync(path.join(sharedDir, 'check.db')), '共享数据目录未创建');
  assert.equal(existsSync(path.join(home, 'profiles', 'check-a', 'dsh-intelligence-check', 'check.db')), false,
    '新版仍在 profile 目录创建数据');
  const first = await openPageSession(a, {requireLogin: true});
  let state = await stateOf(first.client);
  assert.deepEqual(state.targets, []);
  assert.equal(state.config.auto_enabled, false, '自动检测未默认关闭');
  assert.equal(state.config.interval_seconds, 900);
  let payload = await getState(first.client);
  assert.deepEqual(payload.catalog.map(entry => entry.model).sort(), ['html-model', 'shared-model', 'svg-model']);

  const b = await bootProfile('check-b');
  const second = await openPageSession(b);
  const joined = await getState(second.client);
  assert.deepEqual(joined.catalog.map(entry => entry.model).sort(), ['html-model', 'shared-model', 'svg-model'],
    '第二个 profile 覆盖了桌面模型目录');
  assert.equal(backendProcesses(sharedDir).length, 1, '同时使用时启动了多套后台');

  // A plain CLI/Web profile joins the running desktop backend read-only.
  const cli = await bootProfile('check-cli', {...env, DSH_INTELLIGENCE_CHECK_DESKTOP: undefined},
    {readyMarker: '[dsh-intelligence-check] CLI host detected'});
  const cliSession = await openPageSession(cli);
  assert.deepEqual(cliSession.payload.catalog.map(entry => entry.model).sort(), ['html-model', 'shared-model', 'svg-model'],
    'CLI profile 覆盖了桌面模型目录');
  assert.equal(backendProcesses(sharedDir).length, 1, 'CLI profile 启动了第二套后台');

  await post(first.client, '/api/target', {provider: 'fixture-one', model: 'shared-model', enabled: false});
  state = await stateOf(second.client);
  assert.deepEqual(state.targets.map(target => `${target.provider}|${target.model}|${target.enabled}`),
    ['fixture-one|shared-model|false'], '第二个 profile 未看到共享目标');
  state = await stateOf(cliSession.client);
  assert.deepEqual(state.targets.map(target => `${target.provider}|${target.model}|${target.enabled}`),
    ['fixture-one|shared-model|false'], 'CLI profile 未看到共享目标');

  await post(second.client, '/api/action', {provider: 'fixture-one', model: 'shared-model', action: 'test', prompt: 'milk'});
  const milk = await waitResult(first.client, 'fixture-one', 'shared-model', 'milk', record => record.verdict !== 'running');
  assert.equal(milk.answer, '46.24 inches');
  assert.equal(milk.usage?.total_tokens, 17);
  await post(second.client, `/api/results/${milk.id}/review`, {decision: 'accepted', note: 'shared review'});
  state = await stateOf(first.client);
  assert.equal(state.results[0].review, 'accepted', '跨 profile 人工评审未共享');

  // HTML and SVG works stay available to the native page preview controls.
  await post(first.client, '/api/action', {provider: 'fixture-one', model: 'shared-model', action: 'test', prompt: 'html'});
  const html = await waitResult(first.client, 'fixture-one', 'shared-model', 'html', record => record.verdict !== 'running');
  assert.match(html.answer, /<h1 id="pelican">/);
  const preview = await fetch(`${first.client.origin}/dsh-intelligence-check/api/results/${html.id}/preview`, {
    headers: {cookie: first.client.session},
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.match(preview.headers.get('content-security-policy') || '', /sandbox allow-scripts/,
    '宿主代理丢失 HTML 预览 CSP');
  assert.match(preview.headers.get('permissions-policy') || '', /camera=\(\)/,
    '宿主代理丢失 HTML 预览 Permissions-Policy');
  await preview.body?.cancel();
  await post(first.client, '/api/action', {provider: 'fixture-one', model: 'shared-model', action: 'test', prompt: 'svg'});
  const svg = await waitResult(first.client, 'fixture-one', 'shared-model', 'svg', record => record.verdict !== 'running');
  assert.match(svg.answer, /<svg/);

  await post(first.client, '/api/action', {provider: 'fixture-one', model: 'shared-model', action: 'modeltrace'});
  for (let i = 0; i < 300; i++) {
    const trace = (await stateOf(second.client)).results.filter(record => record.prompt === 'modeltrace');
    if (trace.length === 3 && trace.every(record => record.verdict !== 'running')) break;
    await wait(100);
  }
  const trace = (await stateOf(second.client)).results.filter(record => record.prompt === 'modeltrace');
  assert.equal(trace.length, 3, 'ModelTrace 未生成三条挑战');
  assert.ok(trace.every(record => record.verdict === 'manual'), 'ModelTrace 挑战未完成');

  if (chromium) {
    const launchOptions = {headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge'};
    if (process.env.PLAYWRIGHT_EXECUTABLE) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
      delete launchOptions.channel;
    }
    browser = await chromium.launch(launchOptions);
    const page = await openNativePage(browser, a.login(), {tab: /模型监测/});
    await page.locator('.dic-table tbody tr').filter({hasText: 'shared-model'}).waitFor({timeout: 15000});
    await page.getByRole('tab', {name: /质量题库/}).click();
    await page.locator('.dic-test-controls select').first().selectOption({index: 0});
    await page.locator('.dic-question', {hasText: '牛奶推理'}).click();
    await page.getByRole('button', {name: '运行所选题目'}).click();
    await page.locator('.dic-answer-body').filter({hasText: '46.24 inches'}).waitFor({timeout: 30000});
    await page.locator('.dic-question', {hasText: 'HTML 动画'}).click();
    await page.getByRole('button', {name: '运行所选题目'}).click();
    await page.locator('.dic-preview iframe').waitFor({timeout: 30000});
    await page.frameLocator('.dic-preview iframe').locator('#pelican').waitFor({timeout: 15000});
    await page.locator('.dic-question', {hasText: 'SVG 创作'}).click();
    await page.getByRole('button', {name: '运行所选题目'}).click();
    await page.locator('.dic-preview img').waitFor({timeout: 30000});
    await page.getByRole('tab', {name: /模型指纹/}).click();
    await page.locator('.dic-trace').waitFor({timeout: 15000});
    await page.locator('.dic-trace-report').waitFor({timeout: 30000});
    await page.getByText('最相似候选', {exact: true}).waitFor({timeout: 15000});
    await page.getByRole('tab', {name: /检测记录/}).click();
    await page.locator('.dic-record').first().waitFor({timeout: 15000});
    await page.getByRole('button', {name: '检测预算设置'}).click();
    await page.locator('.dic-modal input[type=checkbox]').check();
    await page.locator('.dic-modal input[type=number]').nth(0).fill('1');
    await page.getByRole('button', {name: '保存设置'}).click();
    await page.locator('.dic-modal').waitFor({state: 'detached', timeout: 15000});
    state = await stateOf(second.client);
    assert.equal(state.config.auto_enabled, true, '原生页面未保存自动检测开关');
    assert.equal(state.config.interval_seconds, 1, '原生页面未保存自动检测间隔');
    uiChecked = true;
    await browser.close();
    browser = undefined;
  }

  const persistedCount = (await stateOf(second.client)).results.length;
  assert.ok(persistedCount >= 3, '检测记录未保存');

  // The owner leaves; the remaining desktop host re-elects over the same SQLite state.
  await stopHost(a);
  await waitForProcessCount(sharedDir, 0, {timeout: 8000});
  const recovered = await getState(second.client);
  assert.deepEqual(recovered.state.targets.map(target => `${target.provider}|${target.model}`), ['fixture-one|shared-model'],
    '接管后共享目标丢失');
  assert.equal(recovered.state.results.length, persistedCount, '接管后检测记录丢失');
  assert.deepEqual(recovered.catalog.map(entry => entry.model), ['shared-model'],
    '接管后未使用剩余桌面 profile 的模型目录');
  assert.equal(backendProcesses(sharedDir).length, 1, '接管后后台数量异常');

  await stopHost(b);
  await waitForProcessCount(sharedDir, 0, {timeout: 8000});

  // With no desktop backend running, a CLI host must neither start nor take over one.
  const cliLogin = await openPageSession(cli).catch(error => error);
  assert.ok(cliLogin instanceof Error, 'CLI 主机的页面 API 不应可用');
  assert.match(cliLogin.message, /503/, cliLogin.message);
  assert.equal(backendProcesses(sharedDir).length, 0, 'CLI 主机启动或接管了桌面后台');
  await stopHost(cli);
  await uninstallProfile('check-cli');

  // Re-enabling a running desktop profile restores the single backend.
  const again = await bootProfile('check-a');
  await openPageSession(again);
  const patchPath = path.join(home, 'profiles', 'check-a', 'cordis.patch.yml');
  const originalPatch = await readFile(patchPath, 'utf8');
  await writeFile(patchPath, originalPatch + '- id: dsh-intelligence-check\n  disabled: true\n');
  await waitForProcessCount(sharedDir, 0, {timeout: 8000});
  await writeFile(patchPath, originalPatch);
  await waitForProcessCount(sharedDir, 1, {timeout: 15000});
  const reopened = await openPageSession(again);
  assert.equal((await stateOf(reopened.client)).results.length, persistedCount, 'HMR 重载后检测记录丢失');
  await stopHost(again);
  await waitForProcessCount(sharedDir, 0, {timeout: 8000});

  await uninstallProfile('check-b');
  console.log(`PASS: DSH ${version} 原生侧边栏页面、共享状态与单后台、桌面配置权威、跨 profile 会话、HTML/SVG 预览、人工评审、桌面退出清理、CLI 不启动后台与 HMR 重载${uiChecked ? '（浏览器 UI 已验证）' : '（未执行浏览器 UI）'}`);
} finally {
  if (browser) await browser.close();
  for (const host of hosts) await stopHost(host);
  await new Promise(resolve => mock.close(resolve));
  await rm(home, {recursive: true, force: true});
  await rm(work, {recursive: true, force: true});
}
