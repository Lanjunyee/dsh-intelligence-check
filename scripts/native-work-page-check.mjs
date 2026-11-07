import assert from 'node:assert/strict';
import {readFile, rm} from 'node:fs/promises';
import {
  createDshHarness, getState, launchChromium, openNativePage, openPageSession, pluginConfigOverride, postJSON, providerPatch,
  startControlledModelServer,
} from './dsh-harness.mjs';
import {analyzeGlobalOutputs} from '../internal/check/web/modeltrace/fingerprint-core.js';

// Issue #23：通过隔离的原生 DSH 页面测量实际渲染结果，而不是匹配 CSS 字符串。
// 窄屏页面不得被展开的模型归因候选表撑宽；需要横向空间的表格必须在自身
// 容器内滚动；代码回答排版必须与文档中的变体一致。
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
  const controlledModel = await startControlledModelServer({
    models: [model],
    answer: ({prompt}) => {
      const challenge = prompt.match(/(\d+)\s*个\s*1 到 355/);
      return challenge ? traceSequence(Number(challenge[1])) : answerFor(prompt);
    },
  });
  controlled = controlledModel.server;
  const port = controlledModel.port;

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

  async function assertCandidateTableUsesWidth(label) {
    const measured = await measureCandidateTable();
    assert.ok(measured.pageClientWidth > 740,
      `${label}：宽屏检查要求宿主内容宽度大于 740px（实际 ${measured.pageClientWidth}px）`);
    assert.ok(measured.tableWidth >= measured.containerClientWidth - 1,
      `${label}：候选表未利用可用容器宽度（表格 ${measured.tableWidth}px，容器 ${measured.containerClientWidth}px）`);
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

  // 报告来自与现有归因回归相同的确定性受控挑战回答和已提交指纹库。
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

  // 宽屏、缩窄、再恢复三种状态下，候选表都不得撑宽页面；
  // 宽屏下候选表还应实际利用可用容器宽度。
  const wide = await assertPageFits('宽屏展开全部候选');
  const wideTable = await assertCandidateTableUsesWidth('宽屏展开全部候选');
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);
  const narrow = await assertCandidateTableContained('390px 展开全部候选');
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);
  const restored = await assertPageFits('恢复宽屏后');
  const restoredTable = await assertCandidateTableUsesWidth('恢复宽屏后');
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);

  // 浅色和深色主题下候选表都应保持可读，且不得让页面重新出现横向滚动。
  await selectDark(false);
  const light = await page.locator('.dic-page').evaluate(element => {
    const style = getComputedStyle(element);
    const table = element.querySelector('#dic-view-fingerprint details.dic-details table');
    return {
      background: style.backgroundColor,
      color: style.color,
      headerColor: getComputedStyle(table.querySelector('th')).color,
      cellColor: getComputedStyle(table.querySelector('td')).color,
    };
  });
  await selectDark(true);
  const dark = await page.locator('.dic-page').evaluate(element => {
    const style = getComputedStyle(element);
    const table = element.querySelector('#dic-view-fingerprint details.dic-details table');
    return {
      background: style.backgroundColor,
      color: style.color,
      headerColor: getComputedStyle(table.querySelector('th')).color,
      cellColor: getComputedStyle(table.querySelector('td')).color,
    };
  });
  assert.notEqual(light.background, dark.background, '深色主题未切换页面背景');
  assert.notEqual(light.color, dark.color, '深色主题未切换页面文字');
  const pageContrast = {light: contrast(light.color, light.background), dark: contrast(dark.color, dark.background)};
  const candidateContrast = {
    lightHeader: contrast(light.headerColor, light.background),
    lightCell: contrast(light.cellColor, light.background),
    darkHeader: contrast(dark.headerColor, dark.background),
    darkCell: contrast(dark.cellColor, dark.background),
  };
  assert.ok(pageContrast.light >= 4.5, '浅色主题页面文字对比度不足');
  assert.ok(pageContrast.dark >= 4.5, '深色主题页面文字对比度不足');
  for (const [label, value] of Object.entries(candidateContrast)) {
    assert.ok(value >= 4.5, `${label}：候选表文字对比度不足（${value.toFixed(2)}:1）`);
  }
  await assertCandidateTableContained('深色主题 390px 展开全部候选');

  // 模型监测表保留自己的滚动容器，窄屏下操作仍可到达。
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
  const measureMonitorColors = () => page.locator('#dic-view-models').evaluate(element => {
    const pageElement = element.closest('.dic-page');
    const style = getComputedStyle(pageElement);
    const table = element.querySelector('.dic-table');
    return {
      background: style.backgroundColor,
      color: style.color,
      headerColor: getComputedStyle(table.querySelector('th')).color,
      cellColor: getComputedStyle(table.querySelector('td')).color,
    };
  });
  const monitorDark = await measureMonitorColors();
  await selectDark(false);
  const monitorLight = await measureMonitorColors();
  const monitorContrast = {
    darkPage: contrast(monitorDark.color, monitorDark.background),
    lightPage: contrast(monitorLight.color, monitorLight.background),
    darkHeader: contrast(monitorDark.headerColor, monitorDark.background),
    lightHeader: contrast(monitorLight.headerColor, monitorLight.background),
    darkCell: contrast(monitorDark.cellColor, monitorDark.background),
    lightCell: contrast(monitorLight.cellColor, monitorLight.background),
  };
  for (const [label, value] of Object.entries(monitorContrast)) {
    assert.ok(value >= 4.5, `${label}：模型监测表文字对比度不足（${value.toFixed(2)}:1）`);
  }

  // 代码回答的交付排版：宿主等宽字体、13px、1.95 行高（25.35px）。
  // 普通代码内容保持 12px / 1.8。
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
    wideTable,
    restored,
    restoredTable,
    theme: {light, dark, pageContrast, candidateContrast, monitorLight, monitorDark, monitorContrast},
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
