import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import http from 'node:http';
import {
  backendBinary, createDshHarness, getState, launchChromium, openNativePage, openPageSession,
  pluginConfigOverride, providerPatch,
} from './dsh-harness.mjs';

// Issue #14: settings save feedback and draft/focus retention on the real
// DSH-native page. Failures and busy states are induced through Playwright
// route interception, so the page still runs its production fetch path.
const CONFIG = '**/dsh-intelligence-check/api/config';
const TARGET = '**/dsh-intelligence-check/api/target';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const mock = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url?.endsWith('/models')) {
    response.end(JSON.stringify({object: 'list', data: [{id: 'settings-model', object: 'model'}]}));
    return;
  }
  response.end('{}');
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const port = mock.address().port;

const {home, work, hosts, dshRun, installProfile, bootProfile, stopHost} = await createDshHarness({
  prefix: 'dsh-ic-settings',
  env: {DSH_IC_LOCAL_KEY: 'local-controlled-key'},
});
assert.ok(existsSync(backendBinary()), '缺少后台二进制：请先 go build -o bin/quality-check ./cmd/quality-check');

const patch = `${providerPatch({
  baseURL: `http://127.0.0.1:${port}/v1`,
  provider: 'settings-provider',
  displayName: 'Settings Provider',
  models: [{id: 'settings-model', name: 'Settings Model'}],
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

    const step = async (name, fn) => {
      await t.test(name, async () => {
        let page;
        try {
          page = await openNativePage(browser, host.login(), {tab: /模型监测/});
          await page.waitForFunction(() => document.querySelector('.dic-add select')?.options.length > 0, {}, {timeout: 10000});
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

      await openSettings(page);
      await checkInitialFocus(page);
      await page.getByRole('button', {name: '关闭设置'}).click();
      await modal(page).waitFor({state: 'detached', timeout: 5000});
    });

    assert.deepEqual(pageErrors, [], '页面脚本异常');
    assert.equal(failed, false, '设置行为回归存在失败项');
    console.log(`PASS: DSH ${version} 原生设置弹窗：失败保留草稿与修改、失败反馈、轮询不改写草稿、忙碌未执行不报成功、失败后重试生效、非首个输入跨轮询保持焦点、首次聚焦/Escape/关闭按钮`);
  } finally {
    if (browser) await browser.close();
    for (const host of hosts) await stopHost(host);
    await new Promise(resolve => mock.close(resolve));
    await rm(home, {recursive: true, force: true});
    await rm(work, {recursive: true, force: true});
  }
});
