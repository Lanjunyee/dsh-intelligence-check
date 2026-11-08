import assert from 'node:assert/strict';
import {readFile, rm} from 'node:fs/promises';
import {
  createDshHarness, getState, launchChromium, openNativePage, openPageSession, pluginConfigOverride, postJSON,
  providerPatch, startControlledModelServer,
} from './dsh-harness.mjs';

// 任务 04：原生检测记录页的可观察行为。浏览器入口是约定的测试接缝。
// 记录通过现有页面 API 与受控模型服务产生，再通过渲染后的页面、
// 实际下载内容和持久化的用户级状态进行验证。
const {home, work, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-history',
  env: {DSH_IC_LOCAL_KEY: process.env.DSH_IC_LOCAL_KEY || 'local-controlled-key'},
});

const provider = 'history-provider';
const model = 'history-model';
const brokenModel = 'history-broken';
const slowModel = 'history-slow';
const personAnswer = '历史页受控回答：Thibault Sottiaux 是 OpenAI 的研究员。';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForResult(client, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const payload = await getState(client);
    const found = payload.state.results.find(predicate);
    if (found) return found;
    await sleep(150);
  }
  throw new Error('等待检测记录超时');
}

async function trigger(client, targetModel, prompt = 'person') {
  const before = new Set((await getState(client)).state.results.map(item => item.id));
  const response = await postJSON(client, '/api/action', {provider, model: targetModel, action: 'test', prompt});
  assert.equal(response.status, 200, `触发检测失败：${response.text}`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const payload = await getState(client);
    const fresh = payload.state.results.find(item => !before.has(item.id));
    if (fresh && fresh.verdict !== 'running') return fresh;
    await sleep(150);
  }
  throw new Error(`等待 ${targetModel} / ${prompt} 记录超时`);
}

function minuteKey(record) {
  return new Date(record.time).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function secondKey(record) {
  return new Date(record.time).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function traceSequence(count) {
  return Array.from({length: count}, (_, index) => ((index * 37 + 11) % 355) + 1).join(', ');
}

let controlled;
let browser;
let failure;
try {
  const controlledModel = await startControlledModelServer({
    models: [model, brokenModel, slowModel],
    answer: async ({prompt, body}) => {
      if (body.model === brokenModel) return null;
      if (body.model === slowModel) await sleep(4000);
      const challenge = prompt.match(/(\d+)\s*个\s*1 到 355/);
      if (challenge) return traceSequence(Number(challenge[1]));
      return prompt.includes('Thibault Sottiaux') ? personAnswer : null;
    },
  });
  controlled = controlledModel.server;
  const port = controlledModel.port;

  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('history', `${providerPatch({
    baseURL: `http://127.0.0.1:${port}/v1`,
    provider,
    displayName: 'History Provider',
    models: [model, brokenModel, slowModel].map(id => ({id, name: id})),
    defaultModel: model,
  })}
${pluginConfigOverride()}`);
  const host = await bootProfile('history');
  const {client} = await openPageSession(host);
  for (const target of [model, brokenModel, slowModel]) {
    const result = await postJSON(client, '/api/target', {provider, model: target, enabled: true});
    assert.equal(result.status, 200, result.text);
  }

  browser = await launchChromium();
  const page = await openNativePage(browser, host.login(), {tab: /检测记录/});

  // 尚无记录：这是真正的空状态，不是筛选失败。
  const empty = page.getByText('暂无检测记录', {exact: true});
  await empty.waitFor({timeout: 15000});

  // 四条记录间隔足够大，秒级时间不同；至少两条落在同一分钟，
  // 这正是对比选择器必须区分的情况。
  const records = [];
  for (let index = 0; index < 4; index++) {
    records.push(await trigger(client, model));
    if (index < 3) await sleep(1200);
  }
  let sameMinutePair;
  for (let left = 0; left < records.length && !sameMinutePair; left++) {
    for (let right = left + 1; right < records.length; right++) {
      if (minuteKey(records[left]) === minuteKey(records[right])
        && records[left].time !== records[right].time) {
        sameMinutePair = [records[left], records[right]];
        break;
      }
    }
  }
  assert.ok(sameMinutePair, '受控记录未能形成同分钟对，无法验证对比选择');

  const reviewed = sameMinutePair[0];
  const reviewResponse = await postJSON(client, `/api/results/${encodeURIComponent(reviewed.id)}/review`, {
    decision: 'accepted', note: '历史页评审备注',
  });
  assert.equal(reviewResponse.status, 200, reviewResponse.text);

  const failed = await trigger(client, brokenModel);
  assert.equal(failed.verdict, 'unavailable');
  assert.ok(failed.error, '调用失败的记录未保留错误原因');

  // 渲染后的列表在摘要中包含评审状态与秒级时间，
  // 因此浏览时能区分同一分钟内的记录。
  await page.waitForFunction(count => document.querySelectorAll('.dic-record').length >= count, records.length + 1,
    {timeout: 20000});
  const summaries = await page.locator('.dic-record summary').allTextContents();
  assert.ok(summaries.some(text => text.includes('确认通过')), '记录摘要未显示人工评审状态');
  assert.ok(summaries.some(text => /\d{2}:\d{2}:\d{2}/.test(text)), '记录摘要时间未精确到秒');

  // 对比选择器必须以可区分的方式呈现同一分钟内的记录。
  await page.locator('details.dic-details summary', {hasText: '回答对比'}).click();
  const answerAOptions = await page.locator('.dic-field', {hasText: '回答 A'}).locator('option').evaluateAll(
    options => options.map(option => ({value: option.value, text: option.textContent.trim()})));
  const optionA = answerAOptions.find(option => option.value === sameMinutePair[0].id);
  const optionB = answerAOptions.find(option => option.value === sameMinutePair[1].id);
  assert.ok(optionA && optionB, '对比选择器缺少已保存的回答');
  assert.notEqual(optionA.text, optionB.text, '同分钟记录在对比选择器中无法区分');
  for (const option of [optionA, optionB]) {
    assert.match(option.text, /\d{2}:\d{2}:\d{2}/, '对比选项未显示秒级时间');
  }

  // 筛选无匹配与空历史是不同状态。
  await page.locator('.dic-field', {hasText: '结果'}).locator('select').selectOption('skipped');
  await page.getByText('没有符合筛选条件的记录', {exact: true}).waitFor({timeout: 5000});
  await page.locator('.dic-field', {hasText: '结果'}).locator('select').selectOption('');

  // 评审筛选将列表缩小到已评审的记录。
  await page.locator('.dic-field', {hasText: '评审'}).locator('select').selectOption('accepted');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 5000});
  assert.match(await page.locator('.dic-record summary').textContent(), /确认通过/);
  await page.locator('.dic-field', {hasText: '评审'}).locator('select').selectOption('');

  const modelSelect = page.locator('.dic-field', {hasText: '模型'}).locator('select');
  const promptSelect = page.locator('.dic-field', {hasText: '题目'}).locator('select');
  const verdictSelect = page.locator('.dic-field', {hasText: '结果'}).locator('select');
  await modelSelect.selectOption({label: `${provider} / ${brokenModel}`});
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 5000});
  assert.match(await page.locator('.dic-record summary').textContent(), /检测不可用/);
  await modelSelect.selectOption('');
  const personCount = (await getState(client)).state.results.filter(item => item.prompt === 'person').length;
  await promptSelect.selectOption('person');
  await page.waitForFunction(count => document.querySelectorAll('.dic-record').length === count, personCount, {timeout: 5000});
  await promptSelect.selectOption('');

  // 展开记录：原始回答、提示词原文与可用的下载。
  const reviewedCard = page.locator('.dic-record').filter({hasText: '历史页评审备注'});
  await reviewedCard.locator('summary').click();
  await reviewedCard.getByRole('heading', {name: '原始回答'}).waitFor({timeout: 5000});
  await reviewedCard.getByRole('heading', {name: '提示词原文'}).waitFor({timeout: 5000});
  assert.match(await reviewedCard.locator('.dic-record-answer').textContent(), /Thibault Sottiaux/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    reviewedCard.getByRole('button', {name: '下载原始回答'}).click(),
  ]);
  const downloaded = await readFile(await download.path(), 'utf8');
  assert.equal(downloaded, reviewed.answer, '下载内容不是该记录的原始回答');

  // 导出沿用既有载荷：当前筛选记录及其原始数据，并附加导出时间。
  await verdictSelect.selectOption('unavailable');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 5000});
  const stateBeforeExport = await getState(client);
  const expectedIds = stateBeforeExport.state.results
    .filter(item => item.verdict === 'unavailable').map(item => item.id).reverse();
  assert.equal(expectedIds.length, 1);
  const [exported] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name: '导出筛选记录'}).click(),
  ]);
  const payload = JSON.parse(await readFile(await exported.path(), 'utf8'));
  assert.deepEqual(payload.results.map(item => item.id), expectedIds, '导出结果与当前筛选记录不一致');
  assert.ok(payload.exported_at, '导出内容缺少导出时间');
  assert.equal(payload.results[0].answer, '');

  // 清理只移除当前筛选范围内的记录。
  const beforeFilteredCleanup = await getState(client);
  let filteredDialogMessage = '';
  page.once('dialog', dialog => { filteredDialogMessage = dialog.message(); dialog.accept(); });
  await page.getByRole('button', {name: '清理筛选记录'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 0, {}, {timeout: 10000});
  assert.match(filteredDialogMessage, /永久清理当前筛选的 1 条记录/);
  const afterFilteredCleanup = await getState(client);
  assert.equal(afterFilteredCleanup.state.results.length, beforeFilteredCleanup.state.results.length - 1,
    '筛选清理移除了筛选范围外的记录');
  assert.ok(afterFilteredCleanup.state.results.every(item => item.verdict !== 'unavailable'));
  const clearedBroken = beforeFilteredCleanup.state.results.find(item => item.verdict === 'unavailable');
  const brokenDay = new Date(clearedBroken.time).toISOString().slice(0, 10);
  assert.ok((afterFilteredCleanup.state.cleared_usage?.[brokenDay]?.[provider]?.[brokenModel] || 0) > 0,
    '筛选清理后已消耗预算未保留');
  await verdictSelect.selectOption('');
  await page.waitForFunction(count => document.querySelectorAll('.dic-record').length === count,
    afterFilteredCleanup.state.results.length, {timeout: 5000});

  // 清理保留确认步骤，并在检测进行中不执行任何操作。
  await postJSON(client, '/api/action', {provider, model: slowModel, action: 'test', prompt: 'person'});
  await waitForResult(client, item => item.model === slowModel && item.verdict === 'running', 10000);
  const beforeBusyCleanup = (await getState(client)).state.results.length;
  let busyDialogMessage = '';
  page.once('dialog', dialog => { busyDialogMessage = dialog.message(); dialog.accept(); });
  await page.getByRole('button', {name: '清理筛选记录'}).click();
  await page.waitForTimeout(600);
  assert.match(busyDialogMessage, /永久清理当前筛选的 \d+ 条记录/);
  assert.equal((await getState(client)).state.results.length, beforeBusyCleanup,
    '检测进行中时清理仍删除了记录');
  const cancel = await postJSON(client, '/api/action', {provider, model: slowModel, action: 'cancel-test'});
  assert.equal(cancel.status, 200, cancel.text);
  await waitForResult(client, item => item.model === slowModel && item.verdict !== 'running', 15000);

  // 用户取消的质量检测在呈现记录时都显示为已取消，
  // 存储的 verdict 与导出数据保持不变。
  const cancelledRecord = (await getState(client)).state.results.find(
    item => item.model === slowModel && item.verdict !== 'running');
  assert.equal(cancelledRecord.verdict, 'unavailable', '取消记录的存储 verdict 被改写');
  assert.equal(cancelledRecord.finish, 'aborted', '取消记录未保留中止标记');
  await verdictSelect.selectOption('cancelled');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 5000});
  const cancelledSummary = await page.locator('.dic-record summary').textContent();
  assert.match(cancelledSummary, /已取消/, '历史摘要未显示已取消');
  assert.doesNotMatch(cancelledSummary, /检测不可用/, '历史摘要仍显示检测不可用');
  assert.match(await verdictSelect.locator('option[value="cancelled"]').textContent(), /已取消/);
  await verdictSelect.selectOption('');
  await page.waitForFunction(count => document.querySelectorAll('.dic-record').length === count,
    (await getState(client)).state.results.length, {timeout: 5000});

  // 同一条记录在回答记录选择器中也显示为已取消。
  await page.getByRole('tab', {name: /质量题库/}).click();
  await page.locator('#dic-view-tests .dic-test-controls select').first()
    .selectOption({label: `${provider} / ${slowModel}`});
  await page.locator('#dic-view-tests .dic-question-list .dic-question', {hasText: '知识覆盖 / 人物'}).click();
  const answerOptions = await page.getByLabel('回答记录').locator('option').allTextContents();
  assert.ok(answerOptions.some(text => /已取消/.test(text)), '回答记录选项未显示已取消');
  assert.ok(!answerOptions.some(text => /检测不可用/.test(text)), '回答记录选项仍显示检测不可用');
  await page.getByRole('tab', {name: /检测记录/}).click();

  // 后端在记录状态变化后才释放运行槽位；
  // 通过现有清理端点等待（运行中会被拒绝）。
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await postJSON(client, '/api/results/clear', {ids: []});
    if (probe.status === 200) break;
    await sleep(250);
  }

  // 清理只移除当前筛选范围并保留已消耗预算。
  const beforeCleanup = await getState(client);
  await page.waitForFunction(count => document.querySelectorAll('.dic-record').length === count,
    beforeCleanup.state.results.length, {timeout: 10000});
  const cleared = beforeCleanup.state.results.filter(item => item.verdict !== 'skipped');
  let cleanupDialogMessage = '';
  page.once('dialog', dialog => { cleanupDialogMessage = dialog.message(); dialog.accept(); });
  await page.getByRole('button', {name: '清理筛选记录'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 0, {}, {timeout: 10000});
  const afterCleanup = await getState(client);
  assert.equal(afterCleanup.state.results.length, 0, '清理后仍有记录');
  assert.match(cleanupDialogMessage, /已消耗预算保持不变/);
  for (const item of cleared) {
    const day = new Date(item.time).toISOString().slice(0, 10);
    assert.ok((afterCleanup.state.cleared_usage?.[day]?.[item.provider]?.[item.model] || 0) > 0,
      '清理记录后已消耗预算未保留');
  }

  // 一批 ModelTrace 会在同一秒写入三条挑战。
  // 既有批次位置可在记录摘要与对比选择器中区分它们，无需增加后台字段。
  const traceBefore = new Set((await getState(client)).state.results.map(item => item.id));
  const traceResponse = await postJSON(client, '/api/action', {provider, model, action: 'modeltrace'});
  assert.equal(traceResponse.status, 200, traceResponse.text);
  let traceRecords = [];
  const traceDeadline = Date.now() + 30000;
  while (Date.now() < traceDeadline) {
    traceRecords = (await getState(client)).state.results
      .filter(item => !traceBefore.has(item.id) && item.prompt === 'modeltrace');
    if (traceRecords.length === 3 && traceRecords.every(item => item.verdict !== 'running')) break;
    await sleep(150);
  }
  assert.equal(traceRecords.length, 3, 'ModelTrace 未产生三条挑战记录');
  assert.equal(new Set(traceRecords.map(secondKey)).size, 1, 'ModelTrace 三条挑战未落在同一秒');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 3, {}, {timeout: 15000});
  const traceSummaries = await page.locator('.dic-record summary').allTextContents();
  assert.equal(new Set(traceSummaries).size, 3, '同秒 ModelTrace 记录摘要无法区分');
  assert.deepEqual(traceSummaries.map(text => text.match(/挑战 (\d)/)?.[1]).sort(), ['1', '2', '3'],
    '记录摘要未使用批次内挑战编号');
  const compareDetails = page.locator('details.dic-details', {hasText: '回答对比'});
  if (!(await compareDetails.evaluate(element => element.open))) {
    await compareDetails.locator('summary').click();
  }
  const traceOptions = await page.locator('.dic-field', {hasText: '回答 A'}).locator('option').evaluateAll(
    options => options.map(option => ({value: option.value, text: option.textContent.trim()})));
  const traceOptionTexts = traceRecords.map(record => traceOptions.find(option => option.value === record.id)?.text);
  assert.ok(traceOptionTexts.every(Boolean), '对比选择器缺少 ModelTrace 回答');
  assert.equal(new Set(traceOptionTexts).size, 3, '同秒 ModelTrace 在对比选择器中无法区分');
  for (const text of traceOptionTexts) assert.match(text, /挑战 \d/, '对比选项未使用挑战编号');

  // 窄内容区保持所有筛选器与两个批量操作可达且不撑宽页面；
  // 再次加宽后恢复相同布局。
  for (const width of [1280, 1020, 1016, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(200);
    const measured = await page.locator('.dic-page').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      filters: [...element.querySelectorAll('.dic-history-filters > .dic-field')].map(field => field.getBoundingClientRect().right),
      buttons: [...element.querySelectorAll('.dic-history-actions > .dic-btn')].map(button => ({
        right: button.getBoundingClientRect().right,
        visible: button.getBoundingClientRect().width > 0,
      })),
      pageRight: element.getBoundingClientRect().right,
    }));
    assert.ok(measured.scrollWidth <= measured.clientWidth + 1,
      `${width}px：检测记录页被横向撑宽（${measured.clientWidth}/${measured.scrollWidth}）`);
    assert.equal(measured.filters.length, 4, `${width}px：筛选器数量不是 4`);
    for (const right of measured.filters) {
      assert.ok(right <= measured.pageRight + 1, `${width}px：筛选器超出页面右边界`);
    }
    assert.equal(measured.buttons.length, 2, `${width}px：批量操作数量不是 2`);
    for (const button of measured.buttons) {
      assert.ok(button.visible, `${width}px：批量操作不可见`);
      assert.ok(button.right <= measured.pageRight + 1, `${width}px：批量操作超出页面右边界`);
    }
  }

  console.log('native history check passed');
} catch (error) {
  failure = error;
}

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
  if (cleanupFailures.length) throw new AggregateError([failure, ...cleanupFailures], '检测记录回归失败，且清理失败');
  throw failure;
}
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, '检测记录回归清理失败');
