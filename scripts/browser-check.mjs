import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {verifyHistoryAndReview, verifyHistoryAfterRestart} from './browser-history.mjs';
import {verifyPreviews} from './browser-preview.mjs';

// Real DSH profile + host-configured controlled OpenAI-compatible services.
// The browser path goes web console -> Go backend -> plugin -> ctx.llm.stream.
const root = path.resolve(import.meta.dirname, '..');
const dsh = process.env.DSH_BINARY || (existsSync('/usr/local/bin/dsh') ? '/usr/local/bin/dsh' : 'dsh');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binary = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY || path.join(root, 'bin', `quality-check${suffix}`);
const packageSpec = process.env.DSH_PLUGIN_PACKAGE || root;
const playwrightPath = process.env.PLAYWRIGHT_MODULE || '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright';
assert.ok(existsSync(binary), `缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check`);
assert.ok(existsSync(playwrightPath), `缺少 Playwright 模块：${playwrightPath}`);
const {chromium} = createRequire(import.meta.url)(playwrightPath);
const home = await mkdtemp('/private/tmp/dsh-ic-stream-home-');
const work = await mkdtemp('/private/tmp/dsh-ic-stream-work-');
const env = {...process.env, DSH_HOME: home, DSH_IC_LOCAL_KEY: 'local-controlled-value'};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionTexts = [];
const fixture = {};

function mockService(name, streamDelayMs) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({object: 'list', data: [{id: 'shared-model', object: 'model'}]}));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const prompt = String(body.messages?.at(-1)?.content ?? '');
    requests.push({prompt, model: body.model, stream: body.stream});
    const milk = prompt.includes('A previously isolated, newly discovered');
    const artwork = prompt.includes('创建一个 HTML') || prompt.includes('Generate an SVG');
    const answer = milk ? (name === 'one' ? '46.24 inches' : '48 inches')
      : artwork ? (fixture.manualSVG || 'no markup')
      : `business ok from ${name}`;
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const pieces = milk && name === 'one' && streamDelayMs ? ['46.', '24 inches'] : [answer];
    for (let index = 0; index < pieces.length; index++) {
      if (index > 0 && streamDelayMs) await wait(streamDelayMs);
      event({choices: [{index: 0, delta: {content: pieces[index]}}]});
    }
    event({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]});
    event({choices: [], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: milk ? 17 : 4}});
    response.end('data: [DONE]\n\n');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(done => server.close(done)),
  })));
}

const one = await mockService('one', 4500);
const two = await mockService('two', 0);
const hosts = [];
let browser;

function dshRun(args) {
  return spawnSync(dsh, args, {env, cwd: work, encoding: 'utf8', timeout: 180000});
}

function provider(id, name, origin) {
  return `      ${id}:
        displayName: ${name}
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: ${origin}/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: shared-model
            name: Shared Model
            contextWindow: 32768
            maxTokens: 1024
            input: [text]`;
}

async function installProfile(name) {
  const init = dshRun(['--profile', name, '--from-default-profile', 'web', '--dump-config']);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const added = dshRun(['plugin', '--profile', name, 'add', packageSpec]);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const pluginConfig = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY
    ? `- id: dsh-intelligence-check\n  config:\n    binaryPath: ${JSON.stringify(binary)}\n`
    : '';
  await writeFile(path.join(home, 'profiles', name, 'cordis.patch.yml'),
    `- id: llm-pi-ai
  config:
    providers:
${provider('fixture-one', 'Fixture One', one.origin)}
${provider('fixture-two', 'Fixture Two', two.origin)}
- id: agent-default-model
  config:
    provider: fixture-one
    model: shared-model
${pluginConfig}`);
}

async function bootProfile(name) {
  const child = spawn(dsh, ['--profile', name, '--no-open', '--port', '0'], {env, cwd: work, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  let errors = '';
  let login = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`profile 启动超时：${errors.slice(-1000)}`)), 60000);
    const check = () => {
      login ||= output.match(/dsh web: (http:\/\/\S+)/)?.[1] || '';
      if (login && (output + errors).includes('[dsh-intelligence-check] backend ready')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', chunk => { output += chunk; check(); });
    child.stderr.on('data', chunk => { errors += chunk; check(); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`profile 提前退出（${code}）：${errors.slice(-1000)}`));
    });
  });
  const host = {child, login: () => login, origin: () => new URL(login).origin};
  hosts.push(host);
  await ready;
  return host;
}

async function stopHost(host) {
  if (host.child.exitCode !== null) return;
  const exited = new Promise(resolve => host.child.once('exit', resolve));
  host.child.kill('SIGTERM');
  await Promise.race([exited, wait(8000)]);
}

async function openConsole(page, host) {
  await page.goto(host.login());
  await page.goto(host.origin() + '/dsh-intelligence-check');
  await page.waitForFunction(() => {
    const providers = [...document.querySelectorAll('#target select[name=provider] option')].map(option => option.value);
    return providers.includes('fixture-one') && providers.includes('fixture-two');
  }, {}, {timeout: 30000});
}

async function addTarget(page, providerId) {
  await page.locator('#target select[name=provider]').selectOption(providerId);
  await page.locator('#target select[name=model]').selectOption('shared-model');
  await page.locator('#target button').click();
  await page.waitForFunction(id => [...document.querySelectorAll('#targets tr')]
    .some(row => row.textContent.includes(id) && row.textContent.includes('shared-model')), providerId);
}

async function selectTarget(page, providerId) {
  await page.evaluate(id => {
    const select = document.querySelector('#model');
    const option = [...select.options].find(item => item.textContent.includes(`${id} / shared-model`));
    if (!option) throw new Error(`missing target ${id}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }, providerId);
}

async function runPrompt(page, providerId, prompt = 'milk') {
  await page.locator('#tab-tests').click();
  await selectTarget(page, providerId);
  await page.locator('#prompt').selectOption(prompt);
  await page.locator('#run').click();
}

async function openChat(page, workspace) {
  const welcome = page.getByRole('button', {name: '继续'});
  await welcome.waitFor({state: 'visible', timeout: 10000}).catch(() => {});
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
    await welcome.waitFor({state: 'hidden', timeout: 10000}).catch(() => {});
  }
  const picker = page.getByRole('button', {name: '选择工作区'});
  await picker.waitFor({state: 'visible', timeout: 15000}).catch(() => {});
  if (await picker.isVisible().catch(() => false)) {
    await picker.click();
    await page.getByText('添加工作区…', {exact: true}).click();
    // The native flow resolves through the injected desktop bridge below; the
    // browse flow would instead render a path dialog, handled as a fallback.
    const dialog = page.getByRole('dialog');
    if (await dialog.waitFor({state: 'visible', timeout: 3000}).then(() => true).catch(() => false)) {
      await page.getByRole('button', {name: '编辑路径'}).click();
      const pathInput = page.getByRole('textbox', {name: '编辑路径'});
      await pathInput.fill(workspace);
      await pathInput.press('Enter');
      await page.getByRole('button', {name: '打开'}).click();
    }
  }
  await page.waitForFunction(() => document.querySelector('[data-composer-input]')
    ?.getAttribute('data-phase') !== 'inert', {}, {timeout: 30000});
}

async function sessionContents(dir) {  const entries = await readdir(dir, {withFileTypes: true}).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await sessionContents(target);
    else if (entry.isFile()) sessionTexts.push(await readFile(target, 'utf8'));
  }
}

try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('stream-check');
  let host = await bootProfile('stream-check');
  const launch = {headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge'};
  if (process.env.PLAYWRIGHT_EXECUTABLE) {
    launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
    delete launch.channel;
  }
  browser = await chromium.launch(launch);
  const context = await browser.newContext();
  await context.addInitScript(workspace => {
    window.__DSH_DIRECTORY_PICKER__ = {pick: async () => workspace};
  }, work);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await openConsole(page, host);

  // Seven existing prompts, selectable with their original text.
  const state = await page.evaluate(() => fetch('/api/state').then(response => response.json()));
  assert.equal(state.prompts.length, 7);
  assert.equal(await page.locator('#prompt option').count(), 7);
  for (const prompt of state.prompts) {
    await page.locator('#tab-tests').click();
    await page.locator('#prompt').selectOption(prompt.id);
    assert.equal(await page.locator('#promptText').textContent(), prompt.text, `prompt text changed: ${prompt.id}`);
  }

  await page.locator('#tab-models').click();
  await addTarget(page, 'fixture-one');
  await addTarget(page, 'fixture-two');
  assert.equal(await page.locator('#targets tr').count(), 2);

  // Live increments and independent business traffic during the same window.
  await runPrompt(page, 'fixture-one');
  await page.waitForFunction(() => document.querySelector('#testAnswer').textContent === '46.' &&
    document.querySelector('#testAnswer').getAttribute('aria-busy') === 'true', {}, {timeout: 20000});
  const business = await context.newPage();
  await business.goto(host.origin());
  await openChat(business, work);
  await business.locator('[data-composer-input]').click();
  await business.keyboard.type('business ping');
  await business.keyboard.press('Enter');
  await business.getByText(/business ok from one/).first().waitFor({timeout: 30000});
  await page.waitForFunction(() => document.querySelector('#testAnswer').textContent.includes('46.24 inches') &&
    document.querySelector('#answerMeta').textContent.includes('通过'), {}, {timeout: 30000});
  assert.match(await page.locator('#answerMeta').textContent(), /17 tokens/);
  assert.equal(await page.locator('#testAnswer').getAttribute('aria-busy'), 'false');
  await business.close();

  // Same model id at the second provider routes to its own controlled response.
  await runPrompt(page, 'fixture-two');
  await page.waitForFunction(() => document.querySelector('#answerMeta').textContent.includes('未通过'), {}, {timeout: 30000});
  assert.equal(await page.locator('#testAnswer').textContent(), '48 inches');
  assert.equal(one.requests.filter(request => request.prompt.includes('A previously isolated')).length, 1);
  assert.equal(two.requests.filter(request => request.prompt.includes('A previously isolated')).length, 2);
  assert.ok(one.requests.some(request => request.prompt.includes('business ping')), 'business request bypassed the host route');

  // Original answers, prompt association and evaluation survive a console reload.
  await page.reload();
  await page.waitForSelector('#prompt option', {state: 'attached'});
  await page.locator('#tab-tests').click();
  await selectTarget(page, 'fixture-one');
  await page.locator('#prompt').selectOption('milk');
  await page.waitForFunction(() => document.querySelector('#testAnswer').textContent.includes('46.24 inches'), {}, {timeout: 15000});
  await selectTarget(page, 'fixture-two');
  await page.waitForFunction(() => document.querySelector('#testAnswer').textContent === '48 inches', {}, {timeout: 15000});

  // History, comparison, export, download, copy and human review on real host records.
  const reviewed = await verifyHistoryAndReview({page, context, runPrompt});

  // Isolated HTML/SVG artwork previews generated through the same host route.
  await page.locator('#tab-tests').click();
  await selectTarget(page, 'fixture-one');
  await verifyPreviews({page, context, fixture, root, errors});

  // Records, reviews and artwork previews survive a backend restart.
  await stopHost(host);
  host = await bootProfile('stream-check');
  await openConsole(page, host);
  await verifyHistoryAfterRestart({page, reviewed: reviewed.reviewed});
  await page.locator('#tab-history').click();
  await page.locator('#historyPrompt').selectOption('svg');
  assert.equal(await page.locator('#results details').count(), 1, '重启后 SVG 作品记录丢失');
  await page.locator('#historyPrompt').selectOption('html');
  assert.equal(await page.locator('#results details').count(), 2, '重启后 HTML 作品记录丢失');
  await page.locator('#tab-tests').click();
  await selectTarget(page, 'fixture-one');
  await page.locator('#prompt').selectOption('svg');
  await page.waitForFunction(() => document.querySelector('#svgImage').naturalWidth === 200, {}, {timeout: 15000});
  await page.locator('#prompt').selectOption('html');
  await page.waitForFunction(() => document.querySelector('#htmlFrameHost iframe') &&
    document.querySelector('#htmlPreviewStatus').textContent === '预览已加载', {}, {timeout: 15000});

  await sessionContents(path.join(home, 'sessions'));
  assert.ok(!sessionTexts.join('\n').includes('A previously isolated, newly discovered'), 'quality prompt was written into a business session');
  assert.deepEqual(errors, []);

  await stopHost(host);
  console.log(`PASS: DSH ${version} 隔离 profile 浏览器主链路：七题原文、provider 路由、实时增量、历史/组合身份筛选/同题对比/导出/下载/复制、人工评审与自动评估分离及重启读取、HTML/SVG 隔离预览、独立业务会话并行`);
} finally {
  if (browser) await browser.close();
  for (const host of hosts) await stopHost(host);
  await one.close();
  await two.close();
  await rm(home, {recursive: true, force: true});
  await rm(work, {recursive: true, force: true});
}
