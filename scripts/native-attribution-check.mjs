import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {
  createDshHarness, launchChromium, openNativePage, openPageSession, pluginConfigOverride, postJSON, providerPatch,
  startControlledModelServer,
} from './dsh-harness.mjs';

// Issue #15: the native ModelTrace page must explain an attribution failure
// even though no success report exists. The failure is produced by the
// controlled host model returning non-numeric answers, observed through the
// real rendered DOM. Successful attribution and the no-records empty state are
// checked in the same browser session so the fix cannot trade one for another.
const {home, work, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-attribution',
  env: {DSH_IC_LOCAL_KEY: process.env.DSH_IC_LOCAL_KEY || 'local-controlled-key'},
});

const provider = 'attribution-provider';
const attributable = 'attributable-model';
const rejected = 'rejected-model';

function traceSequence(count) {
  return Array.from({length: count}, (_, index) => ((index * 37 + 11) % 355) + 1).join(', ');
}

let controlled;
let browser;
let failure;
try {
  const controlledModel = await startControlledModelServer({
    models: [attributable, rejected],
    answer: ({prompt, body}) => {
      const challenge = prompt.match(/(\d+)\s*个\s*1 到 355/);
      if (!challenge) return null;
      return body.model === rejected ? 'I cannot complete this task.' : traceSequence(Number(challenge[1]));
    },
  });
  controlled = controlledModel.server;
  const port = controlledModel.port;

  async function selectTraceModel(page, model) {
    const select = page.locator('.dic-test-controls select').first();
    await select.selectOption({label: `${provider} / ${model}`});
  }

  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('attribution', `${providerPatch({
    baseURL: `http://127.0.0.1:${port}/v1`,
    provider,
    displayName: 'Attribution Provider',
    models: [attributable, rejected].map(id => ({id, name: id})),
    defaultModel: attributable,
  })}
${pluginConfigOverride()}`);
  const host = await bootProfile('attribution');
  const {client} = await openPageSession(host);
  for (const model of [attributable, rejected]) {
    const result = await postJSON(client, '/api/target', {provider, model, enabled: true});
    assert.equal(result.status, 200, result.text);
  }

  browser = await launchChromium();
  const page = await openNativePage(browser, host.login(), {tab: /模型指纹/});

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
} catch (error) {
  failure = error;
}

// Issue #20：先停止本次运行的资源，再只删除本次创建的目录。清理错误保持可见；
// 原始测试失败保留其消息，并与清理错误一并报告。
const cleanupFailures = [];
async function cleanup(label, action) {
  try {
    await action();
  } catch (error) {
    cleanupFailures.push(new Error(`${label}失败：${error.message}`, {cause: error}));
  }
}
if (browser) await cleanup('关闭浏览器', () => browser.close());
for (const host of hosts) await cleanup(`停止宿主 ${host.name}`, () => stopHost(host));
if (controlled) await cleanup('停止受控服务', () => new Promise(resolve => controlled.close(resolve)));
await cleanup('删除隔离 home', () => rm(home, {recursive: true, force: true}));
await cleanup('删除隔离 work', () => rm(work, {recursive: true, force: true}));

if (failure) {
  if (cleanupFailures.length) throw new AggregateError([failure, ...cleanupFailures], '模型归因回归失败，且清理失败');
  throw failure;
}
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, '模型归因回归清理失败');
