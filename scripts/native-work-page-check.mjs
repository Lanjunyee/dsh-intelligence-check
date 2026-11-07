import assert from 'node:assert/strict';
import {readFile, rm} from 'node:fs/promises';
import http from 'node:http';
import {
  createDshHarness, getState, launchChromium, openNativePage, openPageSession, pluginConfigOverride, postJSON, providerPatch,
} from './dsh-harness.mjs';
import {analyzeGlobalOutputs} from '../internal/check/web/modeltrace/fingerprint-core.js';

// Issue #23: measured through the isolated native DSH page, not CSS strings.
// The narrowed page must not be widened by the expanded attribution candidate
// table, tables that need horizontal room must scroll inside their own
// container, and the code-answer typography must match the documented variant.
const bank = JSON.parse(await readFile(new URL('../internal/check/web/modeltrace/unified_bank.json', import.meta.url), 'utf8'));
const {home, work, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-work-page',
  env: {DSH_IC_LOCAL_KEY: process.env.DSH_IC_LOCAL_KEY || 'local-controlled-key'},
});

const provider = 'work-page-provider';
const model = 'work-page-model';
const narrowWidth = 390;
const answers = {
  html: '<!doctype html><html><body><svg width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>html-answer-marker</body></html>',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>svg-answer-marker</text></svg>',
  map: 'python-answer-marker\nmatrix = [[0] * 180 for _ in range(90)]',
};

function traceSequence(count) {
  return Array.from({length: count}, (_, index) => ((index * 37 + 11) % 355) + 1).join(', ');
}

function answerFor(prompt) {
  if (prompt.includes('创建一个 HTML')) return answers.html;
  if (prompt.includes('Generate an SVG')) return answers.svg;
  if (prompt.includes('世界海陆地图')) return answers.map;
  return null;
}

function rgb(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  assert.ok(match, `无法解析颜色：${value}`);
  return match[1].split(',').slice(0, 3).map(Number);
}

function luminance(value) {
  const channels = rgb(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

let controlled;
let browser;
let failure;
try {
  controlled = http.createServer(async (request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({object: 'list', data: [{id: model, object: 'model'}]}));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const content = body.messages?.at(-1)?.content;
    const prompt = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
    const challenge = prompt.match(/(\d+)\s*个\s*1 到 355/);
    const answer = challenge ? traceSequence(Number(challenge[1])) : answerFor(prompt);
    if (!answer) {
      const message = `受控模型收到未准备回答的题目：${prompt.slice(0, 160)}`;
      console.error(message);
      response.writeHead(500, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message}}));
      return;
    }
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    event({choices: [{index: 0, delta: {content: answer}}]});
    event({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]});
    event({choices: [], usage: {prompt_tokens: 12, completion_tokens: 5, total_tokens: 17}});
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => controlled.listen(0, '127.0.0.1', resolve));
  const port = controlled.address().port;

  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('work-page', `${providerPatch({
    baseURL: `http://127.0.0.1:${port}/v1`,
    provider,
    displayName: 'Work Page Provider',
    models: [{id: model, name: model}],
    defaultModel: model,
  })}
${pluginConfigOverride()}`);
  const host = await bootProfile('work-page');
  const {client} = await openPageSession(host);
  const added = await postJSON(client, '/api/target', {provider, model, enabled: true});
  assert.equal(added.status, 200, added.text);

  browser = await launchChromium();
  const page = await openNativePage(browser, host.login(), {tab: /模型指纹/});

  async function measurePage() {
    return page.locator('.dic-page').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  }

  async function measureCandidateTable() {
    const table = page.locator('#dic-view-fingerprint details.dic-details table');
    return table.evaluate(element => {
      const pageElement = element.closest('.dic-page');
      const container = element.parentElement;
      const style = getComputedStyle(container);
      return {
        tableWidth: element.getBoundingClientRect().width,
        pageClientWidth: pageElement.clientWidth,
        pageScrollWidth: pageElement.scrollWidth,
        containerClientWidth: container.clientWidth,
        containerScrollWidth: container.scrollWidth,
        containerOverflowX: style.overflowX,
      };
    });
  }

  async function assertPageFits(label) {
    const measured = await measurePage();
    assert.ok(measured.scrollWidth <= measured.clientWidth + 1,
      `${label}：页面被横向撑宽（clientWidth ${measured.clientWidth}px，scrollWidth ${measured.scrollWidth}px）`);
    return measured;
  }

  async function assertNarrowPageFits(label) {
    const measured = await assertPageFits(label);
    assert.ok(measured.clientWidth <= 740,
      `${label}：宿主内容宽度 ${measured.clientWidth}px 不在窄屏条件内`);
    return measured;
  }

  async function assertCandidateTableContained(label) {
    const measured = await measureCandidateTable();
    await assertNarrowPageFits(label);
    if (measured.tableWidth > measured.pageClientWidth + 1) {
      assert.ok(['auto', 'scroll'].includes(measured.containerOverflowX),
        `${label}：候选表缺少局部横向滚动容器（overflow-x: ${measured.containerOverflowX}）`);
      assert.ok(measured.containerClientWidth <= measured.pageClientWidth + 1,
        `${label}：候选表滚动容器自身超出页面内容宽度`);
      assert.ok(measured.containerScrollWidth >= measured.tableWidth - 1,
        `${label}：候选表内容未被局部滚动容器承接`);
    }
    return measured;
  }

  async function selectDark(enabled) {
    await page.evaluate(value => {
      if (value) document.body.setAttribute('data-ds-dark-theme', '');
      else document.body.removeAttribute('data-ds-dark-theme');
    }, enabled);
    await page.waitForTimeout(80);
  }

  // The report comes from the same deterministic controlled challenge answers
  // and committed bank as the existing attribution regression.
  await page.getByRole('button', {name: '运行三条指纹挑战'}).click();
  await page.locator('.dic-trace-report').waitFor({timeout: 60000});
  await page.locator('details.dic-details summary', {hasText: /全部 \d+ 个候选/}).click();
  await page.locator('#dic-view-fingerprint details.dic-details table').waitFor();

  const payload = await getState(client);
  const traceResults = payload.state.results
    .filter(item => item.prompt === 'modeltrace' && item.provider === provider && item.model === model && item.answer)
    .slice(0, 3);
  assert.equal(traceResults.length, 3, '受控归因批次未产生三条可用回答');
  const expected = analyzeGlobalOutputs(
    traceResults.map(item => ({text: item.answer, expected_count: item.expected_count})), bank);
  const rows = await page.locator('#dic-view-fingerprint details.dic-details table tbody tr').evaluateAll(
    elements => elements.map(row => [...row.cells].map(cell => cell.textContent.trim())));
  assert.equal(rows.length, expected.results.length, '展开后的候选数量与报告不一致');
  expected.results.forEach((candidate, index) => {
    assert.deepEqual(rows[index], [
      candidate.display_name,
      candidate.family_name,
      `${(candidate.probability * 100).toFixed(1)}%`,
    ], `候选排序或概率在第 ${index + 1} 行发生变化`);
  });

  // Wide page, then narrow, then restore: the candidate table must not widen
  // the page in any of those states.
  const wide = await measurePage();
  assert.ok(wide.scrollWidth <= wide.clientWidth + 1,
    `宽屏页面被横向撑宽（clientWidth ${wide.clientWidth}px，scrollWidth ${wide.scrollWidth}px）`);
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);
  const narrow = await assertCandidateTableContained('390px 展开全部候选');
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);
  await assertPageFits('恢复宽屏后');
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);

  // Light and dark themes must keep the candidate table readable without
  // bringing horizontal scrolling back to the page itself.
  await selectDark(false);
  const light = await page.locator('.dic-page').evaluate(element => {
    const style = getComputedStyle(element);
    const header = element.querySelector('#dic-view-fingerprint details.dic-details th');
    return {background: style.backgroundColor, color: style.color, headerColor: getComputedStyle(header).color};
  });
  await selectDark(true);
  const dark = await page.locator('.dic-page').evaluate(element => {
    const style = getComputedStyle(element);
    const header = element.querySelector('#dic-view-fingerprint details.dic-details th');
    return {background: style.backgroundColor, color: style.color, headerColor: getComputedStyle(header).color};
  });
  assert.notEqual(light.background, dark.background, '深色主题未切换页面背景');
  assert.notEqual(light.color, dark.color, '深色主题未切换页面文字');
  const lightContrast = contrast(light.color, light.background);
  const darkContrast = contrast(dark.color, dark.background);
  assert.ok(lightContrast >= 4.5, '浅色主题候选表文字对比度不足');
  assert.ok(darkContrast >= 4.5, '深色主题候选表文字对比度不足');
  await assertCandidateTableContained('深色主题 390px 展开全部候选');

  // The monitoring table keeps its own scroll container and operations remain
  // reachable at the narrow width.
  await page.getByRole('tab', {name: /模型监测/}).click();
  await page.locator('#dic-view-models h2', {hasText: '检测目标'}).waitFor();
  await assertNarrowPageFits('390px 模型监测表');
  const headers = await page.locator('#dic-view-models .dic-table thead th').allTextContents();
  for (const label of ['模型', '今日请求 / 上限', '自动监测', '操作']) {
    assert.ok(headers.some(header => header.trim() === label), `模型监测表缺少列：${label}`);
  }
  const monitorTable = page.locator('#dic-view-models .dic-table');
  const monitor = await monitorTable.evaluate(element => {
    const container = element.parentElement;
    const pageElement = element.closest('.dic-page');
    const style = getComputedStyle(container);
    return {
      tableWidth: element.getBoundingClientRect().width,
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      containerOverflowX: style.overflowX,
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
    };
  });
  assert.equal(monitor.containerOverflowX, 'auto', '模型监测表没有局部横向滚动容器');
  assert.ok(monitor.pageScrollWidth <= monitor.pageClientWidth + 1, '模型监测表撑宽了页面');
  if (monitor.tableWidth > monitor.containerClientWidth + 1) {
    assert.ok(monitor.containerScrollWidth > monitor.containerClientWidth,
      '模型监测表在窄屏需要滚动，但容器没有可滚动内容');
  }
  const monitorBox = await page.locator('#dic-view-models .dic-table-wrap').evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    return {scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth};
  });
  if (monitorBox.scrollWidth > monitorBox.clientWidth) assert.ok(monitorBox.scrollLeft > 0, '模型监测表无法横向滚动到操作列');
  const deleteButton = page.getByRole('button', {name: new RegExp(`删除 .*${model}`)}).first();
  await deleteButton.scrollIntoViewIfNeeded();
  const deleteBox = await deleteButton.boundingBox();
  assert.ok(deleteBox && deleteBox.x >= 0 && deleteBox.x + deleteBox.width <= narrowWidth + 1,
    '模型监测表的操作在窄屏中不可达');
  await selectDark(true);
  const monitorDark = await page.locator('.dic-page').evaluate(element => {
    const style = getComputedStyle(element);
    return {background: style.backgroundColor, color: style.color};
  });
  const monitorDarkContrast = contrast(monitorDark.color, monitorDark.background);
  assert.ok(monitorDarkContrast >= 4.5, '深色主题模型监测表文字对比度不足');
  await selectDark(false);

  // Exactly the delivered code-answer typography: host monospace, 13px,
  // 1.95 line height (25.35px). Ordinary code content stays 12px / 1.8.
  await selectDark(false);
  await page.getByRole('tab', {name: /质量题库/}).click();
  const codeTypography = {};
  for (const [promptId, marker] of [['html', 'html-answer-marker'], ['svg', 'svg-answer-marker'], ['map', 'python-answer-marker']]) {
    await page.locator('.dic-question-select select').selectOption(promptId);
    await page.getByRole('button', {name: '运行所选题目'}).click();
    const answer = page.locator('.dic-answer-body.dic-answer-code', {hasText: marker});
    await answer.waitFor({timeout: 60000});
    await assertNarrowPageFits(`390px ${promptId} 代码回答`);
    codeTypography[promptId] = await answer.evaluate(element => {
      const style = getComputedStyle(element);
      const host = getComputedStyle(element.closest('.dic-page'));
      return {
        fontFamily: style.fontFamily,
        hostCodeFont: host.getPropertyValue('--ds-font-family-code').trim(),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
    assert.equal(codeTypography[promptId].fontFamily, codeTypography[promptId].hostCodeFont,
      `${promptId} 回答未使用宿主等宽字体`);
    assert.equal(codeTypography[promptId].fontSize, '13px', `${promptId} 回答字号不是 13px`);
    const lineHeight = Number.parseFloat(codeTypography[promptId].lineHeight);
    assert.ok(Math.abs(lineHeight - 25.35) <= 0.05, `${promptId} 回答计算行高不是约 25.35px（实际 ${lineHeight}px）`);
  }
  const promptSummary = page.locator('.dic-prompt-details summary');
  if (await promptSummary.isVisible()) await promptSummary.click();
  const promptCode = await page.locator('.dic-prompt-details .dic-pre').evaluate(element => {
    const style = getComputedStyle(element);
    return {fontSize: style.fontSize, lineHeight: style.lineHeight};
  });
  assert.equal(promptCode.fontSize, '12px', '普通代码内容字号不是 12px');
  const promptLineHeight = Number.parseFloat(promptCode.lineHeight);
  assert.ok(Math.abs(promptLineHeight - 21.6) <= 0.05,
    `普通代码内容计算行高不是约 21.6px（实际 ${promptLineHeight}px）`);

  console.log('native work page check passed');
  console.log(JSON.stringify({
    candidateCount: expected.results.length,
    narrow,
    wide,
    theme: {light, dark, lightContrast, darkContrast, monitorDark, monitorDarkContrast},
    monitor: {headers, ...monitor, scroll: monitorBox, deleteButton: deleteBox},
    codeTypography,
    promptCode,
  }, null, 2));
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
  if (cleanupFailures.length) throw new AggregateError([failure, ...cleanupFailures], '检测工作页回归失败，且清理失败');
  throw failure;
}
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, '检测工作页回归清理失败');
