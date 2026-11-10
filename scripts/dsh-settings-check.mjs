import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {
  backendBinary, contrast, createDshHarness, getState, launchChromium, openNativePage, openPageSession,
  pluginConfigOverride, providerPatch, startControlledModelServer,
} from './dsh-harness.mjs';

// Issue #14: settings save feedback and draft/focus retention on the real
// DSH-native page. Failures and busy states are induced through Playwright
// route interception, so the page still runs its production fetch path.
// 任务 04 新增模型目录状态：空目录、已知读取失败与刷新恢复，
// 均在同一个隔离的原生设置页面中观察。
// 任务 05 在同一宿主内继续串联：目录恢复 -> 添加目标 -> 选择非默认目标与
// HTML 题目 -> 运行 -> 读取记录与状态 -> 首次预览失败后重载恢复。
const CONFIG = '**/dsh-intelligence-check/api/config';
const TARGET = '**/dsh-intelligence-check/api/target';
const STATE = '**/dsh-intelligence-check/api/state';
const PREVIEW = '**/dsh-intelligence-check/api/results/*/preview*';
const MODEL_TWO = 'settings-model-two';
const evidenceDir = process.env.DSH_IC_EVIDENCE_DIR || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const controlled = await startControlledModelServer({
  models: ['settings-model', MODEL_TWO],
  answer: async ({prompt}) => prompt.includes('创建一个 HTML')
    ? '<!doctype html><html><body><p>settings-html-answer-marker</p></body></html>'
    : '受控回答：模型目录保留验证',
});
const port = controlled.port;

async function capture(page, name) {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, {recursive: true});
  await page.screenshot({path: path.join(evidenceDir, name)});
}

const {home, work, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-settings',
  env: {DSH_IC_LOCAL_KEY: 'local-controlled-key'},
});
assert.ok(existsSync(backendBinary()), '缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check');

const patch = `${providerPatch({
  baseURL: `http://127.0.0.1:${port}/v1`,
  provider: 'settings-provider',
  displayName: 'Settings Provider',
  models: [{id: 'settings-model', name: 'Settings Model'}, {id: MODEL_TWO, name: 'Settings Model Two'}],
  defaultModel: 'settings-model',
})}
${pluginConfigOverride()}`;

function modal(page) {
  return page.locator('.dic-modal');
}
function modalNumbers(page) {
  return page.locator('.dic-modal input[type=number]');
}
async function openSettings(page) {
  await page.getByRole('button', {name: '检测预算设置'}).click();
  await modal(page).waitFor({state: 'visible', timeout: 5000});
}
async function saveSettings(page) {
  await page.getByRole('button', {name: '保存设置'}).click();
}
async function checkInitialFocus(page) {
  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    type: document.activeElement?.type,
    inDialog: Boolean(document.activeElement?.closest?.('.dic-modal')),
  }));
  assert.deepEqual(focused, {tag: 'INPUT', type: 'checkbox', inDialog: true}, '首次进入设置未聚焦首个输入框');
}
async function draftValues(page) {
  return {
    auto: await page.locator('.dic-modal input[type=checkbox]').isChecked(),
    interval: await modalNumbers(page).nth(0).inputValue(),
    daily: await modalNumbers(page).nth(1).inputValue(),
  };
}
async function assertSettingsFocusReturned(page) {
  await page.waitForFunction(() => document.activeElement?.getAttribute?.('aria-label') === '检测预算设置',
    {}, {timeout: 3000}).catch(() => {});
  const focused = await page.evaluate(() => ({
    label: document.activeElement?.getAttribute?.('aria-label'),
    inDialog: Boolean(document.activeElement?.closest?.('.dic-modal')),
  }));
  assert.deepEqual(focused, {label: '检测预算设置', inDialog: false}, '关闭设置后焦点未返回设置入口');
}

test('native settings retain draft and feedback, and keep input focus across polling', async t => {
  let browser;
  let failed = false;
  const pageErrors = [];
  try {
    const version = dshRun(['--version']).stdout.trim();
    assert.match(version, /^\d+\.\d+\.\d+/);
    await installProfile('settings-check', patch);
    const host = await bootProfile('settings-check');
    const {client} = await openPageSession(host);
    const payload = await getState(client);
    assert.equal(payload.state.config.auto_enabled, false);
    assert.equal(payload.state.config.interval_seconds, 900);

    browser = await launchChromium();

    const step = async (name, fn, prepare) => {
      await t.test(name, async () => {
        let page;
        try {
          page = await openNativePage(browser, host.login(), {tab: /模型监测/, prepare});
          if (!prepare) {
            await page.waitForFunction(() => document.querySelector('.dic-add select')?.options.length > 0, {}, {timeout: 10000});
          }
          page.on('pageerror', error => pageErrors.push(error.message));
          await fn(page);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          if (page) await page.close().catch(() => {});
        }
      });
    };

    await step('focus stays on a non-first input while the background poll refreshes state', async page => {
      await openSettings(page);
      await checkInitialFocus(page);
      const explanation = await modal(page).innerText();
      assert.doesNotMatch(explanation, /\bmilk\b/, '设置说明暴露了内部题目标识 milk');
      assert.match(explanation, /牛奶推理/, '设置说明未使用题目名称');
      await modalNumbers(page).nth(0).fill('321');
      await modalNumbers(page).nth(0).focus();
      await capture(page, '05-settings-draft-focus-light.png');
      await wait(3200);
      assert.equal(await page.evaluate(() =>
        document.activeElement === document.querySelectorAll('.dic-modal input[type=number]')[0]), true,
      '后台轮询抢走了设置输入焦点');
      assert.equal(await modalNumbers(page).nth(0).inputValue(), '321', '轮询覆盖了输入草稿');
    });

    await step('failed save keeps the dialog, draft and dirty state, then retry succeeds', async page => {
      let mode = 'fail';
      await page.route(CONFIG, route => mode === 'fail'
        ? route.fulfill({status: 500, contentType: 'text/plain; charset=utf-8', body: '受控保存失败'})
        : route.continue());
      await openSettings(page);
      await checkInitialFocus(page);
      await page.locator('.dic-modal input[type=checkbox]').check();
      await modalNumbers(page).nth(0).fill('123');
      await modalNumbers(page).nth(1).fill('77');
      await saveSettings(page);
      await page.locator('.dic-modal [role=alert]').filter({hasText: '受控保存失败'})
        .waitFor({state: 'visible', timeout: 5000});
      await modal(page).waitFor({state: 'visible'});
      assert.deepEqual(await draftValues(page), {auto: true, interval: '123', daily: '77'}, '保存失败后草稿丢失');
      assert.match(await modal(page).innerText(), /有未保存的修改/, '保存失败后修改状态被清除');
      assert.equal(await page.locator('.dic-feedback').filter({hasText: '检测设置已保存'}).count(), 0,
        '保存失败显示了成功提示');

      await wait(3200);
      assert.deepEqual(await draftValues(page), {auto: true, interval: '123', daily: '77'}, '轮询覆盖了失败后的草稿');
      assert.equal(await page.locator('.dic-modal [role=alert]').filter({hasText: '受控保存失败'}).count(), 1,
        '轮询清除了失败反馈');

      mode = 'pass';
      await saveSettings(page);
      await modal(page).waitFor({state: 'detached', timeout: 5000});
      await assertSettingsFocusReturned(page);
      await page.locator('.dic-feedback').filter({hasText: '检测设置已保存'})
        .waitFor({state: 'visible', timeout: 5000});
      const saved = (await getState(client)).state.config;
      assert.deepEqual(saved, {daily_limit: 77, auto_enabled: true, interval_seconds: 123},
        '保存成功后设置未实际生效');
    });

    await step('save attempted while another action is busy is not presented as success', async page => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(TARGET, async route => {
        await gate;
        await route.continue();
      });
      try {
        await page.getByRole('button', {name: '添加检测目标'}).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.dic-add button')]
          .some(button => button.getAttribute('aria-busy') === 'true'), {}, {timeout: 5000});
        await openSettings(page);
        await modalNumbers(page).nth(1).fill('55');
        await saveSettings(page);
        await page.locator('.dic-modal [role=alert]').filter({hasText: '正在执行其他操作'})
          .waitFor({state: 'visible', timeout: 5000});
        await modal(page).waitFor({state: 'visible'});
        assert.equal(await modalNumbers(page).nth(1).inputValue(), '55', '忙碌未执行时草稿被清除');
        assert.match(await modal(page).innerText(), /有未保存的修改/, '忙碌未执行时修改状态被清除');
        assert.equal(await page.locator('.dic-feedback').filter({hasText: '检测设置已保存'}).count(), 0,
          '忙碌未执行却显示了保存成功');
      } finally {
        release();
      }
      await page.waitForFunction(() => ![...document.querySelectorAll('.dic-add button')]
        .some(button => button.getAttribute('aria-busy') === 'true'), {}, {timeout: 5000});
      await saveSettings(page);
      await modal(page).waitFor({state: 'detached', timeout: 5000});
      await page.locator('.dic-feedback').filter({hasText: '检测设置已保存'})
        .waitFor({state: 'visible', timeout: 5000});
      assert.equal((await getState(client)).state.config.daily_limit, 55, '忙碌后重试保存未生效');
    });

    await step('first-entry focus, Escape and the close button still work', async page => {
      await openSettings(page);
      await checkInitialFocus(page);
      await page.keyboard.press('Escape');
      await modal(page).waitFor({state: 'detached', timeout: 5000});
      await assertSettingsFocusReturned(page);

      await openSettings(page);
      await checkInitialFocus(page);
      await page.getByRole('button', {name: '关闭设置'}).click();
      await modal(page).waitFor({state: 'detached', timeout: 5000});
      await assertSettingsFocusReturned(page);

      await openSettings(page);
      await checkInitialFocus(page);
      await page.mouse.click(4, 4);
      await modal(page).waitFor({state: 'detached', timeout: 5000});
      await assertSettingsFocusReturned(page);
    });

    await step('added target is recognizable and selectable from the quality-check composer', async page => {
      const overview = page.locator('#dic-view-models');
      await overview.getByText('每日预算', {exact: true}).waitFor({timeout: 5000});
      assert.match(await overview.innerText(), /每日预算[\s\S]*55 次/, '模型监测概览未显示每日预算数值');
      assert.match(await overview.innerText(), /Settings Provider/, '目标表未显示可辨认的提供方名称');
      assert.match(await overview.innerText(), /Settings Model/, '目标表未显示可辨认的模型名称');

      await page.getByRole('tab', {name: /质量题库/}).click();
      const trigger = page.locator('.dic-composer [aria-label="检测模型"]');
      await trigger.waitFor({timeout: 5000});
      assert.equal(await trigger.getAttribute('title'), 'settings-provider / settings-model',
        '质量题库未选中刚添加的检测目标');
      await trigger.click();
      const option = page.locator('.dic-menu-pop [role=option]').filter({hasText: 'settings-model'});
      await option.waitFor({timeout: 5000});
      assert.equal(await option.count(), 1, '质量题库模型菜单未列出刚添加的检测目标');
      await option.click();
      assert.match(await trigger.textContent(), /settings-model/, '选择目标后底部操作区未保留当前目标');
    });

    await step('existing target keeps a reviewed record before the catalog is emptied', async page => {
      await page.getByRole('tab', {name: /质量题库/}).click();
      const composer = page.locator('.dic-composer [aria-label="检测模型"]');
      assert.equal(await composer.getAttribute('title'), 'settings-provider / settings-model');
      await page.getByRole('button', {name: '运行所选题目'}).click();
      await page.locator('.dic-answer-body', {hasText: '受控回答：模型目录保留验证'})
        .waitFor({timeout: 60000});
      const review = page.locator('.dic-review');
      await review.locator('select').waitFor({timeout: 30000});
      await review.locator('select').selectOption('accepted');
      await review.locator('textarea').fill('目录清空保留评审');
      await page.getByRole('button', {name: '保存评审'}).click();
      await page.locator('.dic-review-feedback', {hasText: '评审已保存'}).waitFor({timeout: 10000});
      const reviewed = (await getState(client)).state.results.find(item =>
        item.review === 'accepted' && item.review_note === '目录清空保留评审');
      assert.ok(reviewed, '人工评审未保存，无法验证目录清空后的保留行为');
    });

    let catalogMode = 'empty';
    await step('empty catalog is accurate and recovers; non-default run ownership and preview retry stay correct', async page => {
      const modelsView = page.locator('#dic-view-models');
      await modelsView.getByText('模型目录中没有可用模型').waitFor({timeout: 5000});
      assert.match(await modelsView.innerText(), /settings-provider/, '目录为空时已有检测目标被隐藏');
      assert.equal(await modelsView.locator('.dic-target-table tbody tr').count(), 1,
        '目录为空时已有检测目标数量发生变化');

      const before = await getState(client);
      const provider = page.locator('.dic-add select').nth(0);
      const model = page.locator('.dic-add select').nth(1);
      const add = page.locator('.dic-add button[type=submit]');
      assert.equal(await provider.isDisabled(), true, '无可用模型时提供方选择仍可操作');
      assert.equal(await model.isDisabled(), true, '无可用模型时模型选择仍可操作');
      assert.equal(await add.isDisabled(), true, '无可用模型时添加提交仍可操作');

      let addRequests = 0;
      page.on('request', request => {
        if (request.method() === 'POST'
          && new URL(request.url()).pathname === '/dsh-intelligence-check/api/target') addRequests++;
      });
      await add.evaluate(element => element.click());
      await wait(300);
      assert.equal(addRequests, 0, '无可用模型时仍发出了添加请求');
      assert.doesNotMatch(await page.locator('.dic-main').innerText(), /请选择模型提供方和模型/,
        '无可用模型时仍提示完成无法进行的选择');
      const during = await getState(client);
      assert.deepEqual(during.state.targets, before.state.targets, '目录暂时为空删除了已有检测目标');
      assert.deepEqual(during.state.results, before.state.results, '目录暂时为空删除了检测记录或评审');

      // 代表性证据：空目录在宽、窄窗口与深色主题下均只说明事实。
      await page.setViewportSize({width: 1280, height: 900});
      await page.waitForTimeout(150);
      await capture(page, '04-catalog-empty-light.png');
      await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
      await page.waitForTimeout(150);
      const darkColors = await modelsView.locator('.dic-target-empty-title').evaluate(element => ({
        color: getComputedStyle(element).color,
        background: getComputedStyle(element.closest('.dic-page')).backgroundColor,
      }));
      const darkContrast = contrast(darkColors.color, darkColors.background);
      assert.ok(darkContrast >= 4.5, `深色主题下空目录说明对比度不足：${darkContrast}`);
      await capture(page, '04-catalog-empty-dark.png');
      await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
      await page.setViewportSize({width: 390, height: 900});
      // 宿主侧栏先收起，测量的才是插件实际可用宽度。
      await page.keyboard.press('Alt+Meta+B');
      await page.waitForTimeout(300);
      const pluginWidth = await page.locator('.dic-page').evaluate(element => element.getBoundingClientRect().width);
      assert.ok(pluginWidth >= 360, `窄窗口下插件实际可用宽度不足：${pluginWidth}`);
      const emptyNote = modelsView.locator('.dic-target-empty');
      await emptyNote.scrollIntoViewIfNeeded();
      const noteBox = await emptyNote.boundingBox();
      assert.ok(noteBox && noteBox.x >= 0 && noteBox.x + noteBox.width <= 391,
        '窄窗口下空目录说明超出页面宽度');
      const refresh = emptyNote.getByRole('button', {name: '刷新模型目录'});
      assert.equal(await refresh.isVisible(), true, '窄窗口下空目录刷新入口不可见');
      await capture(page, '04-catalog-empty-narrow.png');
      await page.setViewportSize({width: 1280, height: 900});

      // 已知请求失败：沿用天气/后台错误路径，页面说明读取失败并可刷新重试。
      catalogMode = 'fail';
      await page.getByRole('button', {name: '刷新', exact: true}).click();
      await page.locator('.dic-notices [role=alert]', {hasText: '受控目录读取失败'})
        .waitFor({timeout: 5000});
      await modelsView.getByText('模型目录暂时无法读取').waitFor({timeout: 5000});

      // 目录恢复后刷新即可重新选择并添加新目标。
      catalogMode = 'ok';
      await page.getByRole('button', {name: '刷新', exact: true}).click();
      await page.locator('.dic-notices [role=alert]', {hasText: '受控目录读取失败'})
        .waitFor({state: 'detached', timeout: 5000});
      assert.equal(await provider.isDisabled(), false, '目录恢复后提供方选择仍不可用');
      assert.equal(await model.isDisabled(), false, '目录恢复后模型选择仍不可用');
      await provider.selectOption('settings-provider');
      await model.selectOption(MODEL_TWO);
      assert.equal(await add.isDisabled(), false, '目录恢复且选择完整后添加提交仍不可用');
      await add.click();
      await page.locator('.dic-feedback', {hasText: '已添加检测目标'}).waitFor({timeout: 10000});
      const recovered = await getState(client);
      assert.ok(recovered.state.targets.some(item => item.model === MODEL_TWO),
        '目录恢复后添加检测目标未生效');
      assert.ok(recovered.state.results.some(item => item.review === 'accepted'
        && item.review_note === '目录清空保留评审'), '目录恢复过程丢失已有检测记录或评审');
      await capture(page, '04-catalog-recovered.png');

      await page.getByRole('tab', {name: /质量题库/}).click();
      const trigger = page.locator('.dic-composer [aria-label="检测模型"]');
      await trigger.waitFor({timeout: 5000});
      await trigger.click();
      const option = page.locator('.dic-menu-pop [role=option]').filter({hasText: MODEL_TWO});
      await option.waitFor({timeout: 5000});
      await option.click();
      assert.match(await trigger.textContent(), new RegExp(MODEL_TWO),
        '新增目标未回到质量题库的模型选择中');

      // 同一宿主内连续验证：非默认目标 + 明确题目实际运行，新增记录归属正确，
      // 状态可读；随后 HTML 预览首次探测失败，通过“重新加载”恢复同一记录。
      await page.locator('.dic-composer [aria-label="测试题"]').click();
      const promptMenu = page.locator('.dic-menu-pop[role=listbox]');
      await promptMenu.waitFor({timeout: 5000});
      await promptMenu.getByRole('option', {name: /HTML 动画/}).click();
      await promptMenu.waitFor({state: 'detached', timeout: 5000});

      const knownIds = new Set((await getState(client)).state.results.map(item => item.id));
      let previewProbes = 0;
      let allowPreviewProbe = false;
      await page.route(PREVIEW, route => {
        if (route.request().resourceType() !== 'fetch') return route.continue();
        previewProbes += 1;
        if (!allowPreviewProbe) {
          return route.fulfill({status: 503, contentType: 'text/html', body: '<!doctype html><html><body>preview probe unavailable</body></html>'});
        }
        return route.continue();
      });

      await page.getByRole('button', {name: '运行所选题目'}).click();
      await page.locator('.dic-answer-body', {hasText: 'settings-html-answer-marker'})
        .waitFor({timeout: 60000});
      await page.locator('.dic-run-status', {hasText: '检测完成'}).waitFor({timeout: 15000});
      const meta = await page.locator('.dic-answer-meta').innerText();
      assert.match(meta, /HTML 动画/, '本次回答未显示所选题目');
      assert.match(meta, /settings-provider/, '本次回答未显示所选提供方');
      assert.match(meta, new RegExp(MODEL_TWO), '本次回答未显示所选非默认目标');

      const afterRun = await getState(client);
      const addedResults = afterRun.state.results.filter(item => !knownIds.has(item.id));
      assert.equal(addedResults.length, 1, '本次运行未产生且仅产生一条新检测记录');
      const created = addedResults[0];
      assert.deepEqual({provider: created.provider, model: created.model, prompt: created.prompt},
        {provider: 'settings-provider', model: MODEL_TWO, prompt: 'html'},
        '新增检测记录的提供方、模型或题目与选择不一致');
      assert.equal(afterRun.state.results.filter(item => !knownIds.has(item.id)
        && item.model === 'settings-model').length, 0, '本次运行误为默认目标新增了记录');
      await capture(page, '05-chain-nondefault-html-run.png');

      const preview = page.locator('.dic-preview');
      await preview.locator('.dic-hint', {hasText: '预览加载失败（HTTP 503）'}).waitFor({timeout: 15000});
      assert.equal(previewProbes, 1, '首次 HTML 预览探测没有发出');
      assert.equal(await preview.locator('iframe').count(), 0, '首次探测失败后仍挂载了预览');
      await page.getByRole('button', {name: '重新加载预览'}).click();
      await page.waitForTimeout(1000);
      assert.equal(previewProbes, 2, '首次失败后点击重新加载没有重新探测当前记录');
      assert.equal(await preview.locator('iframe').count(), 0, '再次失败后挂载了无效预览');
      await preview.locator('.dic-hint', {hasText: '预览加载失败（HTTP 503）'}).waitFor({timeout: 15000});

      allowPreviewProbe = true;
      await page.getByRole('button', {name: '重新加载预览'}).click();
      await preview.locator('iframe').waitFor({timeout: 15000});
      await preview.locator('.dic-hint', {hasText: '预览已加载'}).waitFor({timeout: 15000});
      assert.equal(previewProbes, 3, '端点恢复后重新加载没有发出新的探测');
      assert.match(await page.frameLocator('.dic-preview iframe').locator('body').innerText(),
        /settings-html-answer-marker/, '恢复后的预览未显示当前记录的受控 HTML 内容');
      await capture(page, '05-chain-preview-recovered.png');
    }, async candidate => {
      await candidate.route(STATE, async route => {
        if (catalogMode === 'fail') {
          await route.fulfill({status: 503, contentType: 'text/plain; charset=utf-8', body: '受控目录读取失败'});
          return;
        }
        if (catalogMode === 'empty') {
          const response = await route.fetch();
          const payload = await response.json();
          payload.catalog = [];
          await route.fulfill({response, json: payload});
          return;
        }
        await route.continue();
      });
    });

    assert.deepEqual(pageErrors, [], '页面脚本异常');
    assert.equal(failed, false, '设置行为回归存在失败项');
    console.log(`PASS: DSH ${version} 原生设置弹窗：失败保留草稿与修改、失败反馈、轮询不改写草稿、忙碌未执行不报成功、失败后重试生效、非首个输入跨轮询保持焦点、首次聚焦/Escape/关闭按钮；空模型目录提示准确、添加禁用且无请求、失败可刷新重试、目录恢复后可选择并添加且保留已有目标与评审`);
  } finally {
    if (browser) await browser.close();
    for (const host of hosts) await stopHost(host);
    await new Promise(resolve => controlled.server.close(resolve));
    await rm(home, {recursive: true, force: true});
    await rm(work, {recursive: true, force: true});
  }
});
