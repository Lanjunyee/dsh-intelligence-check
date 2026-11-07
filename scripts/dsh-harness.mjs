import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {hostTarget} from '../plugin/platform.mjs';

// 供 profile、生命周期与自动检测等检查共用的真实 DSH 宿主工具。
// 各调用方仍各自负责补丁内容与断言；隔离 home、安装/启动/停止、页面 API
// 会话交换以及受控 OpenAI 兼容模型服务边界在此共享。
export const root = path.resolve(import.meta.dirname, '..');
export const dsh = process.env.DSH_BINARY || (existsSync('/usr/local/bin/dsh') ? '/usr/local/bin/dsh' : 'dsh');
export const packageSpec = process.env.DSH_PLUGIN_PACKAGE || root;

export function backendBinary() {
  const {goos, goarch, suffix} = hostTarget();
  const local = path.join(root, 'bin', `quality-check${suffix}`);
  return process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY ||
    (existsSync(local) ? local : path.join(root, 'bin', `quality-check-${goos}-${goarch}${suffix}`));
}

export function pluginConfigOverride() {
  if (!process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY) return '';
  return `- id: dsh-intelligence-check\n  config:\n    binaryPath: ${JSON.stringify(backendBinary())}\n`;
}

export async function createDshHarness({prefix, env: extraEnv = {}, readyTimeout = 60000, stopTimeout = 10000}) {
  const home = await mkdtemp(path.join(os.tmpdir(), `${prefix}-home-`));
  const work = await mkdtemp(path.join(os.tmpdir(), `${prefix}-work-`));
  const env = {...process.env, DSH_HOME: home, DSH_INTELLIGENCE_CHECK_DESKTOP: '1', ...extraEnv};
  const hosts = [];

  function dshRun(args) {
    return spawnSync(dsh, args, {env, cwd: work, encoding: 'utf8', timeout: 180000});
  }

  async function installProfile(name, patch) {
    const init = dshRun(['--profile', name, '--from-default-profile', 'web', '--dump-config']);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const added = dshRun(['plugin', '--profile', name, 'add', packageSpec]);
    assert.equal(added.status, 0, added.stdout + added.stderr);
    await writeFile(path.join(home, 'profiles', name, 'cordis.patch.yml'), patch);
  }

  async function bootProfile(name, bootEnv = env, {readyMarker = '[dsh-intelligence-check] backend ready'} = {}) {
    const child = spawn(dsh, ['--profile', name, '--no-open', '--port', '0'], {
      env: bootEnv, cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    let login = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`profile ${name} 启动超时：${errors.slice(-1500)}`)), readyTimeout);
      const check = () => {
        login ||= output.match(/dsh web: (http:\/\/\S+)/)?.[1] || '';
        if (login && (output + errors).includes(readyMarker)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', chunk => { output += chunk; check(); });
      child.stderr.on('data', chunk => { errors += chunk; check(); });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`profile ${name} 提前退出（${code}）：${errors.slice(-1500)}`));
      });
    });
    const host = {name, child, login: () => login, origin: () => new URL(login).origin};
    hosts.push(host);
    await ready;
    return host;
  }

  async function stopHost(host) {
    if (host.child.exitCode !== null) return;
    const exited = new Promise(resolve => host.child.once('exit', resolve));
    host.child.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, stopTimeout))]);
  }

  return {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost};
}

export function cookieHeader(response) {
  return (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean).map(value => value.split(';')[0]).join('; ');
}

export async function openPageSession(host, {requireLogin = false} = {}) {
  const origin = host.origin();
  if (requireLogin) {
    const refused = await fetch(origin + '/dsh-intelligence-check/api/state');
    assert.equal(refused.status, 401, '宿主入口未要求登录');
  }
  const login = await fetch(host.login(), {redirect: 'manual'});
  assert.equal(login.status, 303, '宿主登录链接未建立浏览器会话');
  const session = cookieHeader(login);
  const client = {origin, session};
  const payload = await getState(client);
  return {client, payload};
}

export async function postJSON(client, pathname, body) {
  const response = await fetch(client.origin + '/dsh-intelligence-check' + pathname, {
    method: 'POST',
    headers: {cookie: client.session, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: response.status, text: await response.text()};
}

export async function getState(client) {
  const response = await fetch(client.origin + '/dsh-intelligence-check/api/state', {headers: {cookie: client.session}});
  assert.equal(response.status, 200, `page API state failed with ${response.status}`);
  return response.json();
}

// 隔离宿主的共享进程观测：调用方传入隔离目录、期望数量、超时和失败消息，
// 目录过滤由 backendProcesses 完成。
export function backendProcesses(dataDir) {
  return execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
}

export async function waitForProcessCount(dataDir, count, {timeout = 10000, message = `共享后台进程数不是 ${count}`} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (backendProcesses(dataDir).length === count) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(backendProcesses(dataDir).length, count, message);
}

// 共享 Playwright 加载边界：必需加载失败时抛出含 PLAYWRIGHT_MODULE 的提示；
// 可选加载失败时输出同样提示并返回 undefined，由调用方跳过浏览器 UI。
export function loadPlaywright({optional = false} = {}) {
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright';
  const playwrightPath = process.env.PLAYWRIGHT_MODULE || (existsSync(bundled) ? bundled : '');
  const hint = `缺少或无法加载 Playwright 模块，请设置 PLAYWRIGHT_MODULE 指向可用的 playwright 包：${playwrightPath || '(未设置且未找到内置模块)'}`;
  let loaded;
  let failure;
  if (playwrightPath && existsSync(playwrightPath)) {
    try {
      loaded = createRequire(import.meta.url)(playwrightPath);
    } catch (error) {
      failure = new Error(`${hint}；加载失败：${error.message}`, {cause: error});
    }
  } else {
    failure = new Error(hint);
  }
  if (!failure) return loaded;
  if (!optional) throw failure;
  console.warn(`[ui] ${failure.message}；已跳过浏览器 UI 验证`);
}

// 共享 Playwright 启动入口；模块选择和浏览器选择方式保持不变。
export async function launchChromium() {
  const {chromium} = loadPlaywright();
  const options = {headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge'};
  if (process.env.PLAYWRIGHT_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
    delete options.channel;
  }
  return chromium.launch(options);
}

// 受控 OpenAI 兼容模型服务：调用方只提供模型列表与回答函数，共用的
// 请求解析、SSE 帧和缺失回答错误在此维护。
export async function startControlledModelServer({models, answer}) {
  const server = http.createServer(async (request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({object: 'list', data: models.map(id => ({id, object: 'model'}))}));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const content = body.messages?.at(-1)?.content;
    const prompt = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
    const value = await answer({prompt, body});
    if (typeof value !== 'string') {
      const message = `受控模型收到未准备回答的题目：${prompt.slice(0, 200)}`;
      console.error(message);
      response.writeHead(500, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message}}));
      return;
    }
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    const event = chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    event({choices: [{index: 0, delta: {content: value}}]});
    event({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]});
    event({choices: [], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17}});
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, port: server.address().port};
}

// Opens the DSH-native page: host login, preview notice dismissal, page entry
// and the requested tab. Callers keep their own assertions and teardown.
export async function openNativePage(browser, login, {tab}) {
  const page = await browser.newPage();
  // 在 goto、入口点击和切换标签前注册，确保早期加载错误也能输出。
  page.on('pageerror', error => console.error('[ui] page error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('[ui] console:', message.text()); });
  await page.goto(login);
  const entry = page.getByText('模型质量检测', {exact: true}).first();
  await entry.waitFor({timeout: 30000});
  let clickError;
  for (let attempt = 0; attempt < 20; attempt++) {
    const notice = page.getByRole('button', {name: /^(继续|Continue)$/});
    if (await notice.isVisible().catch(() => false)) {
      await notice.click();
      await page.waitForTimeout(200);
    }
    try {
      await entry.click({timeout: 3000});
      clickError = undefined;
      break;
    } catch (error) {
      clickError = error;
      if (page.isClosed()) throw error;
      await page.waitForTimeout(300);
    }
  }
  if (clickError) throw clickError;
  await page.locator('.dic-page h1').waitFor({timeout: 30000});
  await page.getByRole('tab', {name: tab}).click();
  return page;
}

// Controlled OpenAI-compatible provider fixture for the regression scripts;
// the compat fields stay identical so the fixtures cannot drift apart.
export function providerPatch({baseURL, provider, displayName = provider, models, defaultModel}) {
  return `- id: llm-pi-ai
  config:
    providers:
      ${provider}:
        displayName: ${displayName}
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: ${baseURL}
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
${models.map(model => `          - id: ${model.id}
            name: ${model.name}
            contextWindow: 32768
            maxTokens: 1024
            input: [text]`).join('\n')}
- id: agent-default-model
  config:
    provider: ${provider}
    model: ${defaultModel}`;
}
