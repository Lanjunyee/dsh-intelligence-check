import assert from 'node:assert/strict';
import {readFile, rm, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  contrast, createDshHarness, getState, launchChromium, openNativePage, openPageSession, pluginConfigOverride, postJSON,
  providerPatch, rgb, startControlledModelServer,
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
const model = 'work-page-model-with-an-extremely-long-name-that-must-not-push-the-run-button';
const extraModels = Array.from({length: 11}, (_, index) =>
  `work-page-extra-model-${String(index + 2).padStart(2, '0')}-with-a-long-recognizable-name`);
const allModels = [model, ...extraModels];
const narrowWidth = 390;
const evidenceDir = process.env.DSH_IC_EVIDENCE_DIR
  || fileURLToPath(new URL('../.scratch/claude-desktop-redesign-fixes/screenshots/', import.meta.url));
const promptNames = {milk: '牛奶推理', repeat: '逐字复述', japan: '知识覆盖 / 日本首相',
  person: '知识覆盖 / 人物', html: 'HTML 动画', svg: 'SVG 创作', map: '世界海陆地图'};
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

let controlled;
let browser;
let failure;
try {
let htmlRuns = 0;
  // 牛奶题的可控回答依次用于未通过与通过；设为 unavailable 时返回空值，
  // 由受控服务生成调用失败，保持既有不可用场景。
  let milkAnswer = 'failed';
  const controlledModel = await startControlledModelServer({
    models: allModels,
    answer: async ({prompt}) => {
      const challenge = prompt.match(/(\d+)\s*个\s*1 到 355/);
      if (challenge) return traceSequence(Number(challenge[1]));
      if (prompt.includes('创建一个 HTML')) {
        htmlRuns++;
        return `${answers.html}<!-- run-${htmlRuns} -->`;
      }
      if (prompt.includes('Thibault Sottiaux')) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        return 'delayed answer before cancellation';
      }
      // 确定性状态场景：空回答、截断回答与调用不可用，用于核对状态语义色。
      if (prompt.includes('DataGridViewColumnHeadersHeightSizeMode')) return ' ';
      if (prompt.includes('当今的日本首相')) {
        return {content: 'truncated answer marker', finish_reason: 'length'};
      }
      if (prompt.includes('average adult height of the population')) {
        if (milkAnswer === 'passed') return '46.24 inches';
        if (milkAnswer === 'failed') return '48 inches';
        return null;
      }
      return answerFor(prompt);
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
    models: allModels.map(id => ({id, name: id})),
    defaultModel: model,
  })}
${pluginConfigOverride()}`);
  const host = await bootProfile('work-page');
  const {client} = await openPageSession(host);
  const added = await postJSON(client, '/api/target', {provider, model, enabled: true});
  assert.equal(added.status, 200, added.text);
  // 多个检测目标用于验证菜单在中等内容宽度与低高度下完整可见、可滚动。
  for (const extra of extraModels) {
    const extraAdded = await postJSON(client, '/api/target', {provider, model: extra, enabled: false});
    assert.equal(extraAdded.status, 200, extraAdded.text);
  }

  browser = await launchChromium();
  await mkdir(evidenceDir, {recursive: true});
  // 首次连接状态通过受控延迟观察：在状态返回前，页面必须显示“连接中”，
  // 而不是把尚未取得的后台状态说成“已连接”。
  let releaseInitialState;
  const initialStateGate = new Promise(resolve => { releaseInitialState = resolve; });
  let heldInitialState = false;
  const page = await openNativePage(browser, host.login(), {tab: /模型指纹/, prepare: async candidate => {
    await candidate.route('**/dsh-intelligence-check/api/state', async route => {
      if (!heldInitialState) {
        heldInitialState = true;
        await initialStateGate;
      }
      await route.continue();
    });
  }});
  await page.locator('.dic-status', {hasText: '连接中'}).waitFor({timeout: 15000});
  assert.match(await page.locator('.dic-main').innerText(), /正在连接/, '首次连接中未显示加载文案');
  releaseInitialState();
  await page.locator('.dic-status', {hasText: '已连接'}).waitFor({timeout: 15000});

  // 窄内容区下四个标签应同屏可读，关键入口不能藏在横向滚动之后。
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);
  const narrowTabs = await assertTabsFit('390px 标签栏');
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);

  async function measurePage() {
    return page.locator('.dic-page').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  }

  async function assertTabsFit(label) {
    const measured = await page.locator('.dic-tabs').evaluate(nav => {
      const box = nav.getBoundingClientRect();
      return {
        clientWidth: nav.clientWidth,
        scrollWidth: nav.scrollWidth,
        tabs: [...nav.querySelectorAll('.dic-tab')].map(tab => {
          const tabBox = tab.getBoundingClientRect();
          return {label: tab.textContent.trim(), right: tabBox.right, width: tabBox.width};
        }),
        right: box.right,
      };
    });
    assert.equal(measured.tabs.length, 4, `${label}：标签数量不是 4`);
    for (const tab of measured.tabs) {
      assert.ok(tab.width > 0, `${label}：${tab.label} 不可见`);
      assert.ok(tab.right <= measured.right + 1,
        `${label}：${tab.label} 超出标签栏右边界（${tab.right.toFixed(1)} > ${measured.right.toFixed(1)}）`);
    }
    assert.ok(measured.scrollWidth <= measured.clientWidth + 1,
      `${label}：标签栏需要横向滚动（clientWidth ${measured.clientWidth}px，scrollWidth ${measured.scrollWidth}px）`);
    return measured;
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

  async function chooseQuestion(promptId) {
    await page.locator('.dic-composer [aria-label="测试题"]').click();
    const menu = page.locator('.dic-menu-pop[role=listbox]');
    await menu.waitFor({timeout: 5000});
    await menu.getByRole('option', {name: new RegExp(promptNames[promptId])}).click();
    await menu.waitFor({state: 'detached', timeout: 5000});
  }

  const shotPath = name => join(evidenceDir, name);
  // 状态语义色沿用页面既有变量；用探针解析变量后比较最终计算色，
  // 不固定十六进制值或只锁定类名。
  async function readRunStatus() {
    return page.locator('.dic-run-status').evaluate(element => {
      const scope = element.closest('.dic-page');
      const resolve = property => {
        const probe = document.createElement('span');
        probe.style.color = `var(${property})`;
        scope.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      return {
        text: element.textContent.trim(),
        actual: getComputedStyle(element).color,
        warning: resolve('--dic-warning'),
        error: resolve('--dic-error'),
        neutral: resolve('--dic-text-2'),
        background: getComputedStyle(scope).backgroundColor,
      };
    });
  }

  // 每种状态在浅色、深色下都检查最终文字色与既有语义色的对应，
  // 并按需保留浅色或深色截图证据。
  async function assertRunStatusTone(label, tone, pattern, {lightShot, darkShot} = {}) {
    await page.locator('.dic-run-status', {hasText: pattern}).waitFor({timeout: 60000});
    await page.locator('.dic-run-status').scrollIntoViewIfNeeded();
    const tones = {};
    for (const dark of [false, true]) {
      await selectDark(dark);
      const measured = await readRunStatus();
      const themeLabel = `${label}（${dark ? '深色' : '浅色'}）`;
      assert.match(measured.text, pattern, `${themeLabel}：状态文字不准确`);
      assert.deepEqual(rgb(measured.actual), rgb(measured[tone]), `${themeLabel}：状态文字未采用 ${tone} 语义色`);
      const ratio = contrast(measured.actual, measured.background);
      assert.ok(ratio >= 4.5, `${themeLabel}：状态文字对比度不足（${ratio.toFixed(2)}:1）`);
      tones[dark ? 'dark' : 'light'] = measured;
      const shot = dark ? darkShot : lightShot;
      if (shot) {
        await mkdir(evidenceDir, {recursive: true});
        await page.screenshot({path: shotPath(shot)});
      }
    }
    await selectDark(false);
    return tones;
  }

  async function assertStateBadgeTone(label, verdict, tone, {lightShot, darkShot} = {}) {
    const badge = page.locator(`.dic-state-${verdict}`);
    await badge.waitFor({state: 'visible', timeout: 60000});
    await badge.scrollIntoViewIfNeeded();
    const tones = {};
    for (const dark of [false, true]) {
      await selectDark(dark);
      const measured = await badge.evaluate((element, property) => {
        const scope = element.closest('.dic-page');
        const probe = document.createElement('span');
        probe.style.color = `var(${property})`;
        scope.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return {
          text: element.textContent.trim(),
          actual: getComputedStyle(element).color,
          expected,
          background: getComputedStyle(scope).backgroundColor,
        };
      }, tone);
      const themeLabel = `${label}（${dark ? '深色' : '浅色'}）`;
      assert.equal(measured.text, label, `${themeLabel}：状态徽标文字不准确`);
      assert.deepEqual(rgb(measured.actual), rgb(measured.expected), `${themeLabel}：状态徽标未采用 ${tone} 语义色`);
      const ratio = contrast(measured.actual, measured.background);
      assert.ok(ratio >= 4.5, `${themeLabel}：状态徽标对比度不足（${ratio.toFixed(2)}:1）`);
      tones[dark ? 'dark' : 'light'] = measured;
      const shot = dark ? darkShot : lightShot;
      if (shot) {
        await mkdir(evidenceDir, {recursive: true});
        await page.screenshot({path: shotPath(shot)});
      }
    }
    await selectDark(false);
    return tones;
  }

  async function waitForNewResults(knownIds, label) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const results = (await getState(client)).state.results;
      const added = results.filter(item => !knownIds.has(item.id));
      if (added.length && added.every(item => item.verdict !== 'running')) return {results, added};
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`${label}：等待本次新增检测记录超时`);
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

  // 质量题库：七个题目收进底部菜单，选择后菜单关闭并保留当前题目；
  // 当前目标与题目的运行入口不被长模型名挤掉。
  await page.getByRole('tab', {name: /质量题库/}).click();
  const questionTrigger = page.locator('.dic-composer [aria-label="测试题"]');
  await questionTrigger.click();
  const questionMenu = page.locator('.dic-menu-pop[role=listbox]');
  await questionMenu.waitFor({timeout: 5000});
  assert.equal(await questionMenu.getByRole('option').count(), 7, '题目菜单未包含全部七道题');
  const questionMenuBox = await questionMenu.boundingBox();
  assert.ok(questionMenuBox && questionMenuBox.x >= 0 && questionMenuBox.x + questionMenuBox.width <= narrowWidth + 1,
    '390px 题目菜单超出可用宽度');
  await page.keyboard.press('Escape');
  await questionMenu.waitFor({state: 'detached', timeout: 5000});
  assert.equal(await questionTrigger.evaluate(element => document.activeElement === element), true,
    '关闭题目菜单后焦点未返回入口');
  await chooseQuestion('html');
  assert.match(await questionTrigger.textContent(), /HTML 动画/, '关闭菜单后未显示当前题目');
  assert.match(await page.locator('.dic-composer-hint').textContent(), /HTML 动画/, '底部操作区未显示当前题目');
  await questionTrigger.click();
  await questionMenu.waitFor({timeout: 5000});
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await questionMenu.waitFor({state: 'detached', timeout: 5000});
  assert.match(await questionTrigger.textContent(), /SVG 创作/, '键盘选择未作用于当前题目');
  assert.equal(await questionTrigger.evaluate(element => document.activeElement === element), true,
    '键盘选择题目后焦点未返回入口');
  await chooseQuestion('html');
  // 七道题都必须能从同一菜单选择，并在关闭后成为当前题目。
  const promptOrder = [
    ['milk', /牛奶推理/], ['repeat', /逐字复述/], ['japan', /知识覆盖 \/ 日本首相/],
    ['person', /知识覆盖 \/ 人物/], ['html', /HTML 动画/], ['svg', /SVG 创作/], ['map', /世界海陆地图/],
  ];
  for (const [promptId, name] of promptOrder) {
    await chooseQuestion(promptId);
    assert.match(await questionTrigger.textContent(), name, `选择题目 ${promptId} 后未保留当前题目`);
    assert.match(await page.locator('.dic-composer-hint').textContent(), name,
      `选择题目 ${promptId} 后底部操作区未显示当前题目`);
  }
  await chooseQuestion('html');
  const modelTrigger = page.locator('.dic-composer [aria-label="检测模型"]');
  assert.equal(await modelTrigger.getAttribute('title'), `${provider} / ${model}`, '长模型名未保留完整名称');
  const runButton = page.getByRole('button', {name: '运行所选题目'});
  const runBox = await runButton.boundingBox();
  assert.ok(runBox && runBox.x >= 0 && runBox.x + runBox.width <= narrowWidth + 1,
    '390px 下运行入口被长模型名挤出可用宽度');
  assert.ok(runBox.y + runBox.height <= 900, '390px 下运行入口不在可视高度内');
  await assertNarrowPageFits('390px 质量题库底部操作区');

  // 代码回答的交付排版：宿主等宽字体、13px、1.7 行高。
  const codeTypography = {};
  for (const [promptId, marker] of [['html', 'html-answer-marker'], ['svg', 'svg-answer-marker'], ['map', 'python-answer-marker']]) {
    await chooseQuestion(promptId);
    await page.getByRole('button', {name: '运行所选题目'}).click();
    const answer = page.locator('.dic-answer-body.dic-answer-code', {hasText: marker});
    await answer.waitFor({timeout: 60000});
    if (promptId === 'html') {
      const started = page.locator('.dic-feedback', {hasText: '已开始检测'});
      if (await started.count()) {
        await started.waitFor({state: 'detached', timeout: 6000}).catch(() => {
          throw new Error('运行成功后顶部“已开始检测”反馈没有自动消失');
        });
      }
    }
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
    assert.ok(Math.abs(lineHeight - 22.1) <= 0.05, `${promptId} 回答计算行高不是约 22.1px（实际 ${lineHeight}px）`);
    if (promptId === 'html') {
      const preview = page.locator('.dic-preview');
      await preview.locator('iframe').waitFor({timeout: 15000});
      await preview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
      const frame = page.frameLocator('.dic-preview iframe');
      assert.match(await frame.locator('body').innerText(), /html-answer-marker/,
        'HTML 预览未显示回答内容');
      // 生成的回答按默认白底编写；深色宿主下预览画布必须保持白底，
      // 否则未声明背景色的回答会变成深底深字。
      await selectDark(true);
      const canvas = await preview.locator('iframe').evaluate(element => getComputedStyle(element).backgroundColor);
      assert.equal(canvas, 'rgb(255, 255, 255)', '深色主题下 HTML 预览画布不是白色');
      await selectDark(false);
      await preview.scrollIntoViewIfNeeded();
      await page.getByRole('button', {name: '放大预览'}).click();
      const expanded = page.locator('.dic-preview-expanded');
      await expanded.waitFor({timeout: 5000});
      const expandedBox = await expanded.boundingBox();
      assert.ok(expandedBox && expandedBox.x >= 0 && expandedBox.y >= 0
        && expandedBox.x + expandedBox.width <= narrowWidth + 1 && expandedBox.y + expandedBox.height <= 900 + 1,
      '390px 放大预览超出可用区域');
      await page.getByRole('button', {name: '退出放大预览'}).click();
      await page.getByRole('button', {name: '停止预览'}).click();
      await preview.locator('.dic-hint', {hasText: '预览已停止'}).waitFor({timeout: 5000});
      assert.equal(await preview.locator('iframe').count(), 0, '停止预览后 iframe 仍在运行');
    } else if (promptId === 'svg') {
      const svg = page.locator('.dic-preview img');
      await svg.waitFor({timeout: 10000});
      await selectDark(true);
      const canvas = await svg.evaluate(element => getComputedStyle(element).backgroundColor);
      assert.equal(canvas, 'rgb(255, 255, 255)', '深色主题下 SVG 预览画布不是白色');
      await selectDark(false);
    }
  }

  // 任务 03：HTML 预览首次探测暂时失败后，“重新加载”必须重新探测当前记录，
  // 端点恢复后实际挂载预览；再次失败仍保留准确反馈与重试入口。
  await chooseQuestion('html');
  const previewProbePattern = '**/dsh-intelligence-check/api/results/*/preview*';
  let previewProbes = 0;
  let allowPreviewProbe = false;
  await page.route(previewProbePattern, route => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    previewProbes += 1;
    if (!allowPreviewProbe) {
      return route.fulfill({status: 503, contentType: 'text/html', body: '<!doctype html><html><body>preview probe unavailable</body></html>'});
    }
    return route.continue();
  });
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const retryAnswer = page.locator('.dic-answer-body.dic-answer-code', {hasText: 'html-answer-marker'});
  await retryAnswer.waitFor({timeout: 60000});
  const retryPreview = page.locator('.dic-preview');
  await retryPreview.locator('.dic-hint', {hasText: '预览加载失败（HTTP 503）'}).waitFor({timeout: 15000});
  assert.equal(previewProbes, 1, '首次 HTML 预览探测没有发出');
  assert.equal(await retryPreview.locator('iframe').count(), 0, '首次探测失败后仍挂载了预览');
  assert.ok(await page.getByRole('button', {name: '复制回答'}).isEnabled(), '预览失败时无法复制原始回答');
  assert.ok(await page.getByRole('button', {name: '下载回答'}).isEnabled(), '预览失败时无法下载原始回答');
  await retryPreview.scrollIntoViewIfNeeded();
  await page.screenshot({path: shotPath('03-preview-probe-failure.png')});

  // 再次失败：仍通过当前记录重新探测，并保留可再次操作的入口。
  await page.getByRole('button', {name: '重新加载预览'}).click();
  await page.waitForTimeout(1000);
  assert.equal(previewProbes, 2, '首次失败后点击重新加载没有重新探测当前记录');
  assert.equal(await retryPreview.locator('iframe').count(), 0, '再次失败后挂载了无效预览');
  await retryPreview.locator('.dic-hint', {hasText: '预览加载失败（HTTP 503）'}).waitFor({timeout: 15000});
  assert.ok(await page.getByRole('button', {name: '重新加载预览'}).isEnabled(), '再次失败后重新加载入口不可用');

  // 端点恢复后，重新加载产生新探测并挂载受控 HTML 内容，且不重复请求。
  allowPreviewProbe = true;
  await page.getByRole('button', {name: '重新加载预览'}).click();
  await retryPreview.locator('iframe').waitFor({timeout: 15000});
  await retryPreview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
  assert.equal(previewProbes, 3, '端点恢复后重新加载没有发出新的探测');
  assert.match(await page.frameLocator('.dic-preview iframe').locator('body').innerText(), /html-answer-marker/,
    '恢复后的预览未显示受控 HTML 内容');
  await page.waitForTimeout(500);
  assert.equal(previewProbes, 3, '预览恢复后出现无故重复探测');
  await retryPreview.scrollIntoViewIfNeeded();
  await page.screenshot({path: shotPath('03-preview-recovered.png')});

  // 停止后恢复与成功后的重新加载沿用同一条探测链路。
  await page.getByRole('button', {name: '停止预览'}).click();
  await retryPreview.locator('.dic-hint', {hasText: '预览已停止'}).waitFor({timeout: 5000});
  assert.equal(await retryPreview.locator('iframe').count(), 0, '停止预览后 iframe 仍在运行');
  const stoppedProbeCount = previewProbes;
  await page.getByRole('button', {name: '重新加载预览'}).click();
  await retryPreview.locator('iframe').waitFor({timeout: 15000});
  await retryPreview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
  assert.equal(previewProbes, stoppedProbeCount + 1, '停止后重新加载没有重新探测');
  await page.getByRole('button', {name: '重新加载预览'}).click();
  await retryPreview.locator('iframe').waitFor({timeout: 15000});
  await retryPreview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
  assert.equal(previewProbes, stoppedProbeCount + 2, '成功后重新加载没有重新探测');

  // 恢复后尺寸选择仍作用于当前预览，不触发额外探测。
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);
  const sizeSelect = retryPreview.getByLabel('预览尺寸');
  await sizeSelect.selectOption('390');
  await page.waitForFunction(() => document.querySelector('.dic-preview-frame')?.style.width === '390px',
    {}, {timeout: 5000});
  const sizedFrame = await page.evaluate(() => {
    const frame = document.querySelector('.dic-preview-frame');
    return {inline: frame?.style.width, box: frame?.getBoundingClientRect().width,
      iframe: frame?.querySelector('iframe')?.getBoundingClientRect().width};
  });
  assert.ok(sizedFrame.box && Math.abs(sizedFrame.box - 390) <= 1,
    `预览尺寸选择未生效：${JSON.stringify(sizedFrame)}`);
  await sizeSelect.selectOption('');
  await page.waitForFunction(() => document.querySelector('.dic-preview-frame')?.style.width === '',
    {}, {timeout: 5000});
  const autoWidth = await page.locator('.dic-preview-frame').evaluate(frame => frame.getBoundingClientRect().width);
  assert.ok(autoWidth > 390, `恢复自适应预览宽度异常（${autoWidth}px）`);
  assert.equal(previewProbes, stoppedProbeCount + 2, '尺寸选择触发了额外预览探测');
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.waitForTimeout(150);

  // 切换记录后，预览与状态属于当前记录，不复用上一条回答的 iframe。
  const recordSelect = page.getByLabel('回答记录');
  const currentRecordId = (await retryPreview.locator('iframe').getAttribute('id')).replace('dic-preview-', '');
  const otherHtmlOption = await recordSelect.locator('option').evaluateAll((options, current) =>
    options.find(option => option.value && option.value !== current)?.value || '', currentRecordId);
  assert.ok(otherHtmlOption, '回答记录中没有可切换的其他 HTML 记录');
  await recordSelect.selectOption(otherHtmlOption);
  await page.waitForFunction(id => document.querySelector('.dic-preview iframe')?.id === `dic-preview-${id}`,
    otherHtmlOption, {timeout: 15000});
  await retryPreview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
  assert.match(await page.frameLocator('.dic-preview iframe').locator('body').innerText(), /html-answer-marker/,
    '切换记录后的预览不属于当前记录');
  await recordSelect.selectOption('');
  await page.waitForFunction(id => document.querySelector('.dic-preview iframe')?.id === `dic-preview-${id}`,
    currentRecordId, {timeout: 15000});
  await retryPreview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
  await page.unroute(previewProbePattern);

  const promptSummary = page.locator('.dic-prompt-details summary');
  if (await promptSummary.isVisible()) await promptSummary.click();
  const promptCode = await page.locator('.dic-prompt-details .dic-pre').evaluate(element => {
    const style = getComputedStyle(element);
    return {fontSize: style.fontSize, lineHeight: style.lineHeight};
  });
  assert.equal(promptCode.fontSize, '13px', '普通代码内容字号不是 13px');
  const promptLineHeight = Number.parseFloat(promptCode.lineHeight);
  assert.ok(Math.abs(promptLineHeight - 22.1) <= 0.05,
    `普通代码内容计算行高不是约 22.1px（实际 ${promptLineHeight}px）`);

  // 底部操作区不覆盖回答正文与评审表单；滚到末尾后末尾内容仍完整可达。
  const layout = await page.evaluate(() => {
    const conversation = document.querySelector('.dic-conversation');
    const composer = document.querySelector('.dic-composer');
    return {
      conversationBottom: conversation.getBoundingClientRect().bottom,
      composerTop: composer.getBoundingClientRect().top,
      scrollable: conversation.scrollHeight > conversation.clientHeight,
    };
  });
  assert.ok(layout.conversationBottom <= layout.composerTop + 1,
    '底部操作区覆盖了回答阅读区');
  assert.ok(layout.scrollable, '长回答未能让阅读区自身滚动');
  const reviewVisible = await page.evaluate(() => {
    const conversation = document.querySelector('.dic-conversation');
    conversation.scrollTop = conversation.scrollHeight;
    const review = document.querySelector('.dic-review');
    const conversationBox = conversation.getBoundingClientRect();
    const reviewBox = review.getBoundingClientRect();
    return reviewBox.bottom <= conversationBox.bottom + 1 && reviewBox.top >= conversationBox.top - 1;
  });
  assert.ok(reviewVisible, '滚到末尾后人工评审表单仍被底部操作区遮挡');

  // 同一题目再次运行后，记录选择器可切回较旧回答；复制与下载保留回答原文。
  await chooseQuestion('html');
  const latestRun = htmlRuns + 1;
  await page.getByRole('button', {name: '运行所选题目'}).click();
  await page.locator('.dic-answer-body', {hasText: `run-${latestRun}`}).waitFor({timeout: 60000});
  assert.ok(await page.getByLabel('回答记录').locator('option').count() >= 3, '回答记录选择器未保留两次同题回答');
  await page.getByLabel('回答记录').selectOption({index: 2});
  await page.locator('.dic-answer-body', {hasText: `run-${latestRun - 1}`}).waitFor({timeout: 5000});
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', {name: '复制回答'}).click();
  await page.locator('.dic-feedback', {hasText: '回答已复制'}).waitFor({timeout: 5000});
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name: '下载回答'}).click(),
  ]);
  assert.match(download.suggestedFilename(), /^result-.+\.txt$/, '下载回答未使用原始回答文件名');

  // 从质量题库保存人工评审，再在检测记录中按评审筛选、对比、导出，
  // 验证跨页面路径对应同一条记录与同一份原始回答。
  await page.evaluate(() => { document.querySelector('.dic-conversation').scrollTop = document.querySelector('.dic-conversation').scrollHeight; });
  await page.locator('.dic-review select').selectOption('rejected');
  await page.locator('.dic-review textarea').fill('交叉页面评审');
  await page.getByRole('button', {name: '保存评审'}).click();
  await page.locator('.dic-review-feedback', {hasText: '评审已保存'}).waitFor({timeout: 10000});
  const reviewed = (await getState(client)).state.results.find(item =>
    item.prompt === 'html' && item.review === 'rejected' && item.review_note === '交叉页面评审');
  assert.ok(reviewed, '人工评审未保存到对应质量检测记录');

  await page.getByRole('tab', {name: /检测记录/}).click();
  const reviewFilter = page.locator('.dic-field', {hasText: '评审'}).locator('select');
  await reviewFilter.selectOption('rejected');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 10000});
  const reviewedCard = page.locator('.dic-record').first();
  assert.match(await reviewedCard.locator('summary').textContent(), /标记问题/, '检测记录未显示人工评审结果');
  await reviewedCard.locator('summary').click();
  assert.match(await reviewedCard.locator('.dic-record-body').textContent(), /交叉页面评审/,
    '检测记录展开后缺少人工评审备注');
  await reviewFilter.selectOption('');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length > 1, {}, {timeout: 10000});

  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);
  const compareDetails = page.locator('details.dic-details', {hasText: '回答对比'});
  if (!(await compareDetails.evaluate(element => element.open))) await compareDetails.locator('summary').click();
  const htmlOptions = await page.locator('.dic-field', {hasText: '回答 A'}).locator('option').evaluateAll(options =>
    options.filter(option => option.textContent.includes('HTML 动画')).map(option => ({value: option.value, text: option.textContent})));
  assert.ok(htmlOptions.length >= 2, '回答对比未列出两次 HTML 检测记录');
  await page.locator('.dic-field', {hasText: '回答 A'}).locator('select').selectOption(htmlOptions[0].value);
  await page.locator('.dic-field', {hasText: '回答 B'}).locator('select').selectOption(htmlOptions[1].value);
  const compareText = await page.locator('.dic-compare').textContent();
  assert.match(compareText, /回答 A/, '回答对比缺少 A 标识');
  assert.match(compareText, /回答 B/, '回答对比缺少 B 标识');
  assert.match(compareText, /html-answer-marker/, '回答对比未显示原始回答');

  await reviewFilter.selectOption('rejected');
  await page.waitForFunction(() => document.querySelectorAll('.dic-record').length === 1, {}, {timeout: 10000});
  const [exported] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name: '导出筛选记录'}).click(),
  ]);
  const exportedPayload = JSON.parse(await readFile(await exported.path(), 'utf8'));
  assert.deepEqual(exportedPayload.results.map(item => item.id), [reviewed.id],
    '导出筛选记录未对应刚保存评审的检测记录');
  await reviewFilter.selectOption('');
  await page.setViewportSize({width: narrowWidth, height: 900});
  await page.getByRole('tab', {name: /质量题库/}).click();
  await page.waitForTimeout(150);

  // 运行期间取消入口在底部操作区可达，运行、取消、截断、空回答与不可用
  // 状态同时以正确文字和既有语义色呈现。
  await chooseQuestion('person');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const cancelButton = page.getByRole('button', {name: '取消当前质量检测'});
  await cancelButton.waitFor({timeout: 15000});
  const cancelBox = await cancelButton.boundingBox();
  assert.ok(cancelBox && cancelBox.x >= 0 && cancelBox.x + cancelBox.width <= narrowWidth + 1,
    '390px 运行期间取消入口不可达');
  const runningTones = await assertRunStatusTone('运行中', 'warning', /检测进行中/,
    {lightShot: '02-status-running-light.png'});
  await cancelButton.click();
  const cancelledTones = await assertRunStatusTone('已取消', 'neutral', /检测已取消/,
    {lightShot: '02-status-cancelled-light.png'});
  assert.equal(await page.locator('.dic-state-cancelled').count(), 1, '取消状态未显示中性的已取消标记');

  await chooseQuestion('japan');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const truncatedTones = await assertRunStatusTone('回答截断', 'warning', /检测未完成/,
    {lightShot: '02-status-truncated-light.png', darkShot: '02-status-truncated-dark.png'});
  assert.equal(await page.locator('.dic-state-truncated').count(), 1, '截断回答未显示警告语义标记');
  assert.match(await page.locator('.dic-answer-body').innerText(), /truncated answer marker/,
    '截断回答未保留已返回正文');
  assert.match(await page.locator('.dic-thread .dic-banner').innerText(), /回答被截断/,
    '截断提示未保留真实原因');

  await chooseQuestion('repeat');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const emptyTones = await assertRunStatusTone('空回答', 'warning', /检测未完成/,
    {lightShot: '02-status-empty-light.png', darkShot: '02-status-empty-dark.png'});
  assert.equal(await page.locator('.dic-state-empty').count(), 1, '空回答未显示警告语义标记');
  assert.match(await page.locator('.dic-answer-body').innerText(), /本次回答为空/,
    '空回答未显示准确提示');

  // 自动评估的未通过与通过状态：徽标文字与最终语义色在明暗主题下均可读。
  milkAnswer = 'failed';
  await chooseQuestion('milk');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const failedBadge = await assertStateBadgeTone('未通过', 'failed', '--dic-error',
    {lightShot: 'review-failed-light.png', darkShot: 'review-failed-dark.png'});
  milkAnswer = 'passed';
  await chooseQuestion('milk');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const passedBadge = await assertStateBadgeTone('通过', 'passed', '--dic-success',
    {lightShot: 'review-passed-light.png', darkShot: 'review-passed-dark.png'});

  milkAnswer = 'unavailable';
  await chooseQuestion('milk');
  await page.getByRole('button', {name: '运行所选题目'}).click();
  const unavailableTones = await assertRunStatusTone('检测不可用', 'error', /检测未完成/,
    {lightShot: '02-status-unavailable-light.png'});
  assert.equal(await page.locator('.dic-state-unavailable').count(), 1, '不可用状态未显示错误语义标记');
  assert.match(await page.locator('.dic-thread .dic-banner').innerText(), /.+/,
    '不可用状态未保留真实错误原因');

  // 无检测目标时，底部操作区本身提供可操作的主入口。
  await page.getByRole('tab', {name: /质量题库/}).click();
  const beforeDelete = await getState(client);
  for (const target of beforeDelete.state.targets) {
    const removed = await postJSON(client, '/api/target/delete', {provider: target.provider, model: target.model});
    assert.equal(removed.status, 200, removed.text);
  }
  const addTarget = page.locator('.dic-composer').getByRole('button', {name: '添加检测目标'});
  await addTarget.waitFor({timeout: 15000});
  assert.ok(await addTarget.isEnabled(), '无检测目标时底部操作区添加入口不可用');
  const addBox = await addTarget.boundingBox();
  assert.ok(addBox && addBox.y >= 0 && addBox.y + addBox.height <= 900,
    '390px 首屏看不到底部操作区添加检测目标入口');

  // 模型监测的空状态不得被表格最小宽度裁切，添加目标入口在窄屏首屏可见。
  await page.getByRole('tab', {name: /模型监测/}).click();
  const monitorEmpty = page.locator('#dic-view-models .dic-target-empty, #dic-view-models .dic-empty');
  await monitorEmpty.waitFor({timeout: 15000});
  const emptyBox = await monitorEmpty.boundingBox();
  assert.ok(emptyBox && emptyBox.x >= 0 && emptyBox.x + emptyBox.width <= narrowWidth + 1,
    '390px 模型监测空状态提示被表格宽度裁切');
  const monitorAddButton = page.locator('#dic-view-models .dic-add .dic-btn-primary');
  await monitorAddButton.scrollIntoViewIfNeeded();
  const monitorAddBox = await monitorAddButton.boundingBox();
  assert.ok(monitorAddBox && monitorAddBox.y >= 0 && monitorAddBox.y + monitorAddBox.height <= 900,
    '390px 首屏看不到模型监测的添加检测目标入口');

  // 从模型监测的添加表单重新添加目标，回到质量题库后应直接可选。
  await monitorAddButton.click();
  await page.waitForFunction(() => document.querySelectorAll('#dic-view-models .dic-target-table tbody tr').length === 1,
    {}, {timeout: 15000});
  await page.getByRole('tab', {name: /质量题库/}).click();
  const restoredModelTrigger = page.locator('.dic-composer [aria-label="检测模型"]');
  await restoredModelTrigger.waitFor({timeout: 5000});
  assert.equal(await restoredModelTrigger.getAttribute('title'), `${provider} / ${model}`,
    '通过模型监测添加目标后，质量题库底部操作区未选中该目标');
  // 重新加入多目标，供后面的菜单可滚动/键盘选择回归使用。
  for (const extra of extraModels) {
    const extraAdded = await postJSON(client, '/api/target', {provider, model: extra, enabled: false});
    assert.equal(extraAdded.status, 200, extraAdded.text);
  }
  await page.getByRole('button', {name: '刷新'}).click();
  await page.getByRole('tab', {name: /模型监测/}).click();
  await page.waitForFunction(
    count => document.querySelectorAll('#dic-view-models .dic-target-table tbody tr').length === count,
    allModels.length, {timeout: 10000});
  await page.getByRole('tab', {name: /质量题库/}).click();
  await page.waitForTimeout(150);

  // 实际容器宽度断点两侧：每个宽度都不能横向溢出，四个入口始终同屏可读。
  for (const width of [1280, 1020, 900, 861, 860, 800, 742, 741, 740, 739, 700, 561, 560, 559, 481, 480, 479, 422, 421, 420, 419, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(120);
    await assertPageFits(`${width}px 容器边界`);
    await assertTabsFit(`${width}px 容器边界`);
  }
  // 底部操作区在 560px 容器边界两侧从并排变为堆叠，入口保持可达。
  await page.setViewportSize({width: 561, height: 900});
  await page.waitForTimeout(120);
  const sideBySide = await page.locator('.dic-composer .dic-menu-trigger').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().toJSON()));
  assert.equal(sideBySide.length, 2, '底部操作区菜单入口数量不是 2');
  assert.ok(Math.abs(sideBySide[0].top - sideBySide[1].top) <= 1,
    '561px 容器下模型与题目入口未并排');
  await page.setViewportSize({width: 559, height: 900});
  await page.waitForTimeout(120);
  const stacked = await page.locator('.dic-composer .dic-menu-trigger').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().toJSON()));
  assert.ok(stacked[1].top >= stacked[0].bottom - 1,
    '559px 容器下模型与题目入口未堆叠');

  // 检测记录断点按实际容器宽度切换（宿主侧栏会占据视口宽度，因此用 917/915
  // 视口得到 861/859 的容器宽度）。741px 这类临界宽度必须完整显示模型名，
  // 而不是压缩成不可辨认的省略号。
  await page.getByRole('tab', {name: /检测记录/}).click();
  for (const [width, headingVisible] of [[917, true], [915, false]]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(150);
    await assertPageFits(`${width}px 检测记录断点`);
    assert.equal(await page.locator('.dic-record-head').first().isVisible(), headingVisible,
      `${width}px 检测记录表头可见性与断点不符`);
  }
  for (const width of [859, 741]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(150);
    const modelCell = page.locator('.dic-record-model').first();
    assert.equal(await modelCell.evaluate(element => element.textContent), `${provider} / ${model}`,
      `${width}px 检测记录模型名与目标不一致`);
    assert.ok(await modelCell.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
      `${width}px 检测记录模型名被截断`);
  }
  const firstRecord = page.locator('.dic-record').first();
  assert.equal(await firstRecord.evaluate(element => element.open), false, '检测记录默认处于展开状态');
  await firstRecord.locator('summary').click();
  await page.waitForTimeout(150);
  assert.equal(await firstRecord.evaluate(element => element.open), true, '点击摘要未展开检测记录');
  assert.ok(await firstRecord.locator('.dic-record-body').isVisible(), '展开后检测记录正文不可见');
  await page.getByRole('tab', {name: /质量题库/}).click();

  // 菜单被主内容区等 overflow 祖先实际裁剪，而不是只受整页边界约束。
  // 交叠裁剪区域后再用命中测试确认选项没有被遮挡。
  const measureMenuOption = which => page.evaluate(which => {
    const pageBox = document.querySelector('.dic-page').getBoundingClientRect();
    let clip = {
      top: Math.max(0, pageBox.top), bottom: Math.min(innerHeight, pageBox.bottom),
      left: Math.max(0, pageBox.left), right: Math.min(innerWidth, pageBox.right),
    };
    const pop = document.querySelector('.dic-menu-pop');
    for (let element = pop.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (/(hidden|auto|scroll|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const box = element.getBoundingClientRect();
        clip = {
          top: Math.max(clip.top, box.top + element.clientTop),
          bottom: Math.min(clip.bottom, box.top + element.clientTop + element.clientHeight),
          left: Math.max(clip.left, box.left + element.clientLeft),
          right: Math.min(clip.right, box.left + element.clientLeft + element.clientWidth),
        };
      }
    }
    const options = [...pop.querySelectorAll('[role=option]')];
    const option = which === 'first' ? options[0] : options[options.length - 1];
    const box = option.getBoundingClientRect();
    const point = {
      x: (Math.max(box.left, clip.left) + Math.min(box.right, clip.right)) / 2,
      y: (Math.max(box.top, clip.top) + Math.min(box.bottom, clip.bottom)) / 2,
    };
    const hit = document.elementFromPoint(point.x, point.y);
    const popBox = pop.getBoundingClientRect();
    return {
      which, text: option.textContent, point,
      clip: {top: clip.top, bottom: clip.bottom, left: clip.left, right: clip.right},
      pop: {top: popBox.top, bottom: popBox.bottom},
      option: {top: box.top, bottom: box.bottom, left: box.left, right: box.right},
      fullyVisible: box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1
        && box.left >= clip.left - 1 && box.right <= clip.right + 1,
      hitOption: Boolean(hit && option.contains(hit)),
      hitText: hit?.closest?.('[role=option]')?.textContent || hit?.textContent || null,
    };
  }, which);

  // 较低可用高度下底部操作区仍可达，题目菜单的首尾选项完整落在实际
  // 裁剪区域内，滚到末尾后人工评审仍完整可见。
  await chooseQuestion('html');
  await page.locator('.dic-review').waitFor({timeout: 5000});
  for (const [width, height] of [[1280, 600], [narrowWidth, 560]]) {
    await page.setViewportSize({width, height});
    await page.waitForTimeout(150);
    const composerFit = await page.evaluate(() => {
      const conversation = document.querySelector('.dic-conversation');
      const composer = document.querySelector('.dic-composer');
      return {
        conversationBottom: conversation.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        conversationBox: conversation.getBoundingClientRect().toJSON(),
      };
    });
    assert.ok(composerFit.conversationBottom <= composerFit.composerTop + 1,
      `${width}x${height}：底部操作区覆盖了回答阅读区`);
    const lowRun = await page.getByRole('button', {name: '运行所选题目'}).boundingBox();
    assert.ok(lowRun && lowRun.y >= 0 && lowRun.y + lowRun.height <= height + 1,
      `${width}x${height}：运行入口不在可视高度内`);
    const lowQuestion = page.locator('.dic-composer [aria-label="测试题"]');
    await lowQuestion.click();
    const lowMenu = page.locator('.dic-menu-pop[role=listbox]');
    await lowMenu.waitFor({timeout: 5000});
    const lowMenuBox = await lowMenu.boundingBox();
    const lowPageBox = await page.locator('.dic-page').boundingBox();
    assert.ok(lowMenuBox && lowPageBox && lowMenuBox.y >= lowPageBox.y - 1
      && lowMenuBox.y + lowMenuBox.height <= lowPageBox.y + lowPageBox.height + 1,
    `${width}x${height}：题目菜单越出页面可用高度`);
    if (height === 560) {
      await page.keyboard.press('End');
      const lowQuestionLast = await measureMenuOption('last');
      assert.ok(lowQuestionLast.fullyVisible && lowQuestionLast.hitOption,
        `${width}x${height}：题目菜单末项被实际裁剪区域截断（${JSON.stringify(lowQuestionLast)}）`);
      await page.keyboard.press('Home');
      const lowQuestionFirst = await measureMenuOption('first');
      assert.ok(lowQuestionFirst.fullyVisible && lowQuestionFirst.hitOption,
        `${width}x${height}：题目菜单首项被实际裁剪区域截断（${JSON.stringify(lowQuestionFirst)}）`);
    }
    await page.keyboard.press('Escape');
    await lowMenu.waitFor({state: 'detached', timeout: 5000});
    const reviewFit = await page.evaluate(() => {
      const conversation = document.querySelector('.dic-conversation');
      conversation.scrollTop = conversation.scrollHeight;
      const review = document.querySelector('.dic-review');
      const save = document.querySelector('.dic-review button[type="submit"]');
      const conversationBox = conversation.getBoundingClientRect();
      const reviewBox = review.getBoundingClientRect();
      const saveBox = save?.getBoundingClientRect();
      // 低可用高度下评审表单本身可能高于可视区；要求滚到底后
      // 表单末尾（含保存按钮）完整落在阅读区内，而不是要求整表同屏。
      return reviewBox.bottom <= conversationBox.bottom + 1
        && (!saveBox || (saveBox.top >= conversationBox.top - 1 && saveBox.bottom <= conversationBox.bottom + 1));
    });
    assert.ok(reviewFit, `${width}x${height}：滚到末尾后人工评审末尾被底部操作区遮挡`);
  }

  // 模型菜单：中等内容宽度与低高度下不越出实际页面，长名称可读，
  // 多目标选项可滚动并用键盘选择。
  const modelMenuTrigger = page.locator('.dic-menu-trigger[aria-label="检测模型"]');
  const questionMenuTrigger = page.locator('.dic-menu-trigger[aria-label="测试题"]');
  const menuPop = page.locator('.dic-menu-pop[role=listbox]');
  const optionFocused = () => page.waitForFunction(
    () => document.activeElement?.getAttribute('role') === 'option', {}, {timeout: 5000});

  await page.setViewportSize({width: 581, height: 900});
  await page.waitForTimeout(200);
  const mediumPageWidth = await page.locator('.dic-page').evaluate(element => element.clientWidth);
  assert.ok(mediumPageWidth >= 560 && mediumPageWidth <= 640,
    `中等内容宽度检查要求页面约 581px（实际 ${mediumPageWidth}px）`);
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  const mediumMenu = await page.evaluate(() => {
    const pageBox = document.querySelector('.dic-page').getBoundingClientRect();
    const pop = document.querySelector('.dic-menu-pop').getBoundingClientRect();
    const options = [...document.querySelectorAll('.dic-menu-option')].map(option => {
      const box = option.getBoundingClientRect();
      return {left: box.left, right: box.right, scrollWidth: option.scrollWidth, clientWidth: option.clientWidth,
        text: option.textContent};
    });
    return {page: pageBox.toJSON(), pop: pop.toJSON(), options};
  });
  assert.ok(mediumMenu.pop.left >= mediumMenu.page.left - 1 && mediumMenu.pop.right <= mediumMenu.page.right + 1,
    `中等内容宽度下模型菜单横向越出页面（${mediumMenu.pop.left}–${mediumMenu.pop.right}）`);
  assert.equal(mediumMenu.options.length, allModels.length, '模型菜单未列出全部检测目标');
  assert.ok(mediumMenu.options.every(option => option.scrollWidth <= option.clientWidth + 1),
    '中等内容宽度下模型名称被截断');
  assert.ok(mediumMenu.options.some(option => option.text.includes(model)), '模型菜单缺少完整长名称');
  const mediumMenuScroll = await menuPop.evaluate(element =>
    ({clientHeight: element.clientHeight, scrollHeight: element.scrollHeight}));
  assert.ok(mediumMenuScroll.scrollHeight > mediumMenuScroll.clientHeight,
    '中等内容宽度下多目标菜单没有可滚动内容');
  await page.keyboard.press('End');
  assert.ok((await page.evaluate(() => document.activeElement?.textContent || '')).includes(extraModels.at(-1)),
    '键盘未选中最后一个检测目标');
  assert.ok(await page.evaluate(() => {
    const active = document.activeElement.getBoundingClientRect();
    const pop = document.querySelector('.dic-menu-pop').getBoundingClientRect();
    return active.top >= pop.top - 1 && active.bottom <= pop.bottom + 1;
  }), '键盘移到最后一个选项后选项不在菜单可见区域内');
  await page.keyboard.press('Enter');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok((await modelMenuTrigger.textContent()).includes(extraModels.at(-1)),
    '键盘选择后未显示所选检测目标');
  assert.ok(await modelMenuTrigger.evaluate(element => document.activeElement === element),
    '选择检测目标后焦点未返回入口');
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await menuPop.waitFor({state: 'detached', timeout: 5000});

  // 390x560 低高度：菜单位于页面内还不够，首尾选项必须落在主内容区
  // 实际裁剪后的可见区域并可命中；分别用键盘与鼠标完成选择。
  await page.setViewportSize({width: narrowWidth, height: 560});
  await page.waitForTimeout(200);
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  const lowMenuBounds = await page.evaluate(() => {
    const pageBox = document.querySelector('.dic-page').getBoundingClientRect();
    const pop = document.querySelector('.dic-menu-pop');
    const popBox = pop.getBoundingClientRect();
    return {page: pageBox.toJSON(), pop: popBox.toJSON(), clientHeight: pop.clientHeight, scrollHeight: pop.scrollHeight};
  });
  assert.ok(lowMenuBounds.pop.top >= lowMenuBounds.page.top - 1
    && lowMenuBounds.pop.bottom <= lowMenuBounds.page.bottom + 1,
  `390x560 模型菜单纵向越出页面（${lowMenuBounds.pop.top}–${lowMenuBounds.pop.bottom}）`);
  assert.ok(lowMenuBounds.pop.left >= lowMenuBounds.page.left - 1
    && lowMenuBounds.pop.right <= lowMenuBounds.page.right + 1,
  '390x560 模型菜单横向越出页面');
  assert.ok(lowMenuBounds.scrollHeight > lowMenuBounds.clientHeight, '390x560 多目标菜单没有可滚动内容');
  await page.keyboard.press('Home');
  const menuTransition = await menuPop.locator('.dic-menu-option').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {property: style.transitionProperty, duration: style.transitionDuration, timing: style.transitionTimingFunction};
  });
  assert.deepEqual(menuTransition, {property: 'background-color', duration: '0.16s', timing: 'ease-out'},
    '菜单项未使用既定的 160ms ease-out 背景过渡');
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await menuPop.locator('.dic-menu-option').first().evaluate(element =>
    getComputedStyle(element).transitionDuration), '0s', '减少动态效果未关闭菜单项过渡');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.screenshot({path: shotPath('05-menu-low-light-first.png')});
  await page.keyboard.press('End');
  await page.screenshot({path: shotPath('05-menu-low-light-last.png')});
  const lowLast = await measureMenuOption('last');
  assert.ok(lowLast.fullyVisible,
    `390x560 键盘移到末项后选项被实际裁剪区域截断（${JSON.stringify(lowLast)}）`);
  assert.ok(lowLast.hitOption,
    `390x560 末项可见区域无法被命中（${JSON.stringify(lowLast)}）`);
  await page.keyboard.press('Enter');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok((await modelMenuTrigger.textContent()).includes(extraModels.at(-1)),
    '390x560 键盘选择未作用于最后一个检测目标');
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Home');
  await selectDark(true);
  await page.screenshot({path: shotPath('05-menu-low-dark-first.png')});
  await page.keyboard.press('End');
  await page.screenshot({path: shotPath('05-menu-low-dark-last.png')});
  await page.keyboard.press('Home');
  await selectDark(false);
  const lowFirst = await measureMenuOption('first');
  assert.ok(lowFirst.fullyVisible,
    `390x560 键盘移到首项后选项被实际裁剪区域截断（${JSON.stringify(lowFirst)}）`);
  assert.ok(lowFirst.hitOption,
    `390x560 首项可见区域无法被命中（${JSON.stringify(lowFirst)}）`);
  await page.mouse.click(lowFirst.point.x, lowFirst.point.y);
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok((await modelMenuTrigger.textContent()).includes(model),
    '390x560 鼠标点击首项未选中默认检测目标');

  // Tab 移出菜单：只关闭菜单，焦点自然前进到下一个控件。
  await page.setViewportSize({width: 900, height: 900});
  await page.waitForTimeout(150);
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Tab');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok(await questionMenuTrigger.evaluate(element => document.activeElement === element),
    'Tab 移出菜单后焦点未自然前进到下一个控件');

  // Shift+Tab 先回到入口、再离开整组：焦点在组内时不关闭，离开整个
  // 菜单组才关闭且不把焦点抢回入口。
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await modelMenuTrigger.evaluate(element => document.activeElement === element),
    'Shift+Tab 未从选项回到菜单入口');
  assert.ok(await menuPop.isVisible(), '焦点仍在菜单入口时菜单被提前关闭');
  await page.keyboard.press('Shift+Tab');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.dic-menu'))), false,
    'Shift+Tab 离开菜单组后焦点仍在菜单内');
  assert.ok(!(await modelMenuTrigger.evaluate(element => document.activeElement === element)),
    'Shift+Tab 离开菜单组后焦点被抢回入口');

  // Escape 与选择当前项都关闭菜单并返回入口。
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Escape');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok(await modelMenuTrigger.evaluate(element => document.activeElement === element),
    'Escape 关闭菜单后焦点未返回入口');
  await modelMenuTrigger.focus();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({timeout: 5000});
  await optionFocused();
  await page.keyboard.press('Enter');
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.ok(await modelMenuTrigger.evaluate(element => document.activeElement === element),
    '选择菜单项后焦点未返回入口');

  // 点击空白区域关闭后恢复入口焦点；点击其他可聚焦控件时尊重自然焦点。
  await modelMenuTrigger.click();
  await menuPop.waitFor({timeout: 5000});
  await page.locator('.dic-composer-hint').click();
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  await page.waitForTimeout(50);
  assert.ok(await modelMenuTrigger.evaluate(element => document.activeElement === element),
    '点击空白关闭菜单后焦点未恢复到入口');
  await modelMenuTrigger.click();
  await menuPop.waitFor({timeout: 5000});
  await page.getByRole('tab', {name: /质量题库/}).click();
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'tab',
    '点击其他控件关闭菜单时抢走了焦点');

  // 减少动态效果时，共享过渡被关闭。浏览器没有等价的外部可观察行为，
  // 这里保留唯一的计算样式断言来覆盖该可访问性机制。
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.locator('.dic-tab').first().evaluate(element =>
    getComputedStyle(element).transitionDuration), '0s', '减少动态效果未关闭共享过渡');
  await page.emulateMedia({reducedMotion: 'no-preference'});

  // 连接中断与恢复：状态文字、错误提示和恢复后的已连接状态。
  await page.route('**/dsh-intelligence-check/api/state', route => route.abort());
  await page.getByRole('button', {name: '刷新'}).click();
  await page.locator('.dic-status', {hasText: '连接中断'}).waitFor({timeout: 10000});
  await page.locator('.dic-notices .dic-banner').waitFor({timeout: 10000});
  const disconnectText = await page.locator('.dic-notices .dic-banner').innerText();
  assert.match(disconnectText, /无法连接检测后台/, '连接中断未使用可理解的提示');
  assert.doesNotMatch(disconnectText, /Failed to fetch|NetworkError|Load failed/, '连接中断暴露了浏览器原始错误');
  await page.unroute('**/dsh-intelligence-check/api/state');
  await page.getByRole('button', {name: '刷新'}).click();
  await page.locator('.dic-status', {hasText: '已连接'}).waitFor({timeout: 10000});

  // P3：从页面选择非默认检测目标与明确题目后实际运行，新记录必须归属
  // 该目标与题目；默认目标不得因本次运行新增记录。
  await page.getByRole('tab', {name: /质量题库/}).click();
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(150);
  const nonDefaultModel = extraModels[0];
  await modelMenuTrigger.click();
  await menuPop.waitFor({timeout: 5000});
  await menuPop.getByRole('option', {name: new RegExp(nonDefaultModel)}).click();
  await menuPop.waitFor({state: 'detached', timeout: 5000});
  assert.equal(await page.locator('.dic-composer [aria-label="检测模型"]').getAttribute('title'),
    `${provider} / ${nonDefaultModel}`, '未从页面选中非默认检测目标');
  await chooseQuestion('svg');
  const ownershipBefore = (await getState(client)).state.results;
  const ownershipIds = new Set(ownershipBefore.map(item => item.id));
  const defaultModelBefore = ownershipBefore.filter(item => item.model === model).length;
  await page.getByRole('button', {name: '运行所选题目'}).click();
  await page.locator('.dic-answer-body', {hasText: 'svg-answer-marker'}).waitFor({timeout: 60000});
  const ownership = await waitForNewResults(ownershipIds, '非默认目标运行');
  assert.equal(ownership.added.length, 1, '非默认目标运行产生了多余的新增记录');
  const [created] = ownership.added;
  assert.equal(created.provider, provider, '新增记录的提供方与所选目标不一致');
  assert.equal(created.model, nonDefaultModel, '新增记录的模型与所选非默认目标不一致');
  assert.equal(created.prompt, 'svg', '新增记录的题目与所选题目不一致');
  assert.notEqual(created.verdict, 'running', '新增记录未在等待期限内完成');
  assert.equal(ownership.results.filter(item => item.model === model).length, defaultModelBefore,
    '本次运行误为默认目标新增了检测记录');
  const ownershipMeta = await page.locator('.dic-answer-meta').innerText();
  assert.match(ownershipMeta, new RegExp(nonDefaultModel), '回答信息未显示本次非默认目标');
  assert.match(ownershipMeta, /SVG 创作/, '回答信息未显示本次所选题目');
  await page.screenshot({path: shotPath('02-ownership-non-default.png')});

  console.log('native work page check passed');
  console.log(JSON.stringify({
    candidateCount: expected.results.length,
    narrowTabs,
    narrow,
    wide,
    wideTable,
    restored,
    restoredTable,
    theme: {light, dark, pageContrast, candidateContrast, monitorLight, monitorDark, monitorContrast},
    monitor: {headers, ...monitor, scroll: monitorBox, deleteButton: deleteBox},
    codeTypography,
    promptCode,
    statusTones: {
      running: runningTones, cancelled: cancelledTones, truncated: truncatedTones,
      empty: emptyTones, unavailable: unavailableTones,
    },
    stateBadges: {failed: failedBadge, passed: passedBadge},
    ownership: {created, defaultModelCount: ownership.results.filter(item => item.model === model).length, meta: ownershipMeta},
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
