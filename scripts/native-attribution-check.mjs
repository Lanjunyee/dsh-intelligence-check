import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import http from 'node:http';
import {createDshHarness, openPageSession, pluginConfigOverride, postJSON} from './dsh-harness.mjs';

// Issue #15: the native ModelTrace page must explain an attribution failure
// even though no success report exists. The failure is produced by the
// controlled host model returning non-numeric answers, observed through the
// real rendered DOM. Successful attribution and the no-records empty state are
// checked in the same browser session so the fix cannot trade one for another.
const {hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-attribution',
  env: {DSH_IC_LOCAL_KEY: process.env.DSH_IC_LOCAL_KEY || 'local-controlled-key'},
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundledPlaywright = '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright';
const playwrightPath = process.env.PLAYWRIGHT_MODULE || (existsSync(bundledPlaywright) ? bundledPlaywright : '');
assert.ok(playwrightPath, '缺少 Playwright 模块，无法验证真实页面');
const {chromium} = createRequire(import.meta.url)(playwrightPath);

const provider = 'attribution-provider';
const attributable = 'attributable-model';
const rejected = 'rejected-model';

function traceSequence(count) {
  return Array.from({length: count}, (_, index) => ((index * 37 + 11) % 355) + 1).join(', ');
}

const controlled = http.createServer(async (request, response) => {
  if (request.url?.endsWith('/models')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({object: 'list', data: [attributable, rejected].map(id => ({id, object: 'model'}))}));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const content = body.messages?.at(-1)?.content;
  const prompt = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
  const count = Number(prompt.match(/(\d+)\s*个\s*1 到 355/)?.[1] || 0);
  const trace = count > 0 || prompt.includes('1 到 355');
  const answer = trace
    ? (body.model === rejected ? 'I cannot complete this task.' : traceSequence(count || 300))
    : '46.24 inches';
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  event({choices: [{index: 0, delta: {content: answer}}]});
  event({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]});
  event({choices: [], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17}});
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => controlled.listen(0, '127.0.0.1', resolve));
const port = controlled.address().port;

function patch() {
  return `- id: llm-pi-ai
  config:
    providers:
      ${provider}:
        displayName: Attribution Provider
        apiKeyEnv: DSH_IC_LOCAL_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
${[attributable, rejected].map(model => `          - id: ${model}
            name: ${model}
            contextWindow: 32768
            maxTokens: 1024
            input: [text]`).join('\n')}
- id: agent-default-model
  config:
    provider: ${provider}
    model: ${attributable}
${pluginConfigOverride()}`;
}

async function openNativePage(login) {
  const options = {headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge'};
  if (process.env.PLAYWRIGHT_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
    delete options.channel;
  }
  const browser = await chromium.launch(options);
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('[ui] page error:', error.message));
  await page.goto(login);
  const entry = page.getByText('模型质量检测', {exact: true}).first();
  await entry.waitFor({timeout: 30000});
  for (let attempt = 0; attempt < 20; attempt++) {
    const notice = page.getByRole('button', {name: '继续'});
    if (await notice.isVisible().catch(() => false)) {
      await notice.click();
      await page.waitForTimeout(200);
    }
    try {
      await entry.click({timeout: 3000});
      break;
    } catch (error) {
      if (page.isClosed()) throw error;
      await page.waitForTimeout(300);
    }
  }
  await page.locator('.dic-page h1').waitFor({timeout: 30000});
  await page.getByRole('tab', {name: /模型指纹/}).click();
  return {browser, page};
}

async function selectTraceModel(page, model) {
  const select = page.locator('.dic-test-controls select').first();
  await select.selectOption({label: `${provider} / ${model}`});
}

let browser;
let host;
try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('attribution', patch());
  host = await bootProfile('attribution');
  const {client} = await openPageSession(host);
  for (const model of [attributable, rejected]) {
    const result = await postJSON(client, '/api/target', {provider, model, enabled: true});
    assert.equal(result.status, 200, result.text);
  }

  let page;
  ({browser, page} = await openNativePage(host.login()));

  // No batch yet: the existing empty state stays in place.
  await page.locator('.dic-empty').filter({hasText: '暂无指纹检测记录'}).waitFor({timeout: 15000});

  // A successful batch still shows the closed-set report.
  await selectTraceModel(page, attributable);
  await page.getByRole('button', {name: '运行三条指纹挑战'}).click();
  await page.locator('.dic-trace-report').waitFor({timeout: 60000});
  await page.getByText('最相似候选', {exact: true}).waitFor({timeout: 30000});
  assert.match(await page.locator('.dic-page').textContent(), /闭集行为相似性排序/);
  assert.equal(await page.locator('#dic-tab-fingerprint').count(), 1);

  // A completed batch with unusable answers fails attribution. The error must
  // be visible even though there is no report for this model/batch.
  await selectTraceModel(page, rejected);
  await page.getByRole('button', {name: '运行三条指纹挑战'}).click();
  await page.waitForFunction(() => document.querySelector('.dic-trace')?.textContent.includes('批次已完成'), {}, {timeout: 60000});
  const errorLocator = page.locator('.dic-error', {hasText: '本轮无法归因'});
  try {
    await errorLocator.waitFor({timeout: 20000});
  } catch {
    throw new Error(`归因失败未在页面显示；当前可见文本：${await page.locator('.dic-page').textContent()}`);
  }
  assert.match(await errorLocator.textContent(), /没有可用回答/);
  assert.equal(await page.locator('.dic-trace-report').count(), 0, '归因失败时仍显示成功报告');
  assert.doesNotMatch(await page.locator('.dic-page').textContent(), /暂无指纹检测记录/,
    '归因失败被无记录的空状态掩盖');

  // Returning to the earlier successful batch still renders its report rather
  // than the failure notice.
  await selectTraceModel(page, attributable);
  await page.locator('.dic-trace-report').waitFor({timeout: 30000});
  assert.equal(await page.locator('.dic-error', {hasText: '本轮无法归因'}).count(), 0,
    '成功批次仍显示归因失败');

  console.log('native attribution check passed');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (host) await stopHost(host);
  for (const extra of hosts) if (extra !== host) await stopHost(extra);
  await new Promise(resolve => controlled.close(resolve));
}
