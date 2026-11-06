import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const identity = (provider, model) => `${provider}\u0000${model}`;
const model = 'shared-model';

async function state(page) {
  return page.evaluate(() => fetch('/api/state').then(response => response.json()));
}

async function records(page, provider, prompt) {
  const data = await state(page);
  return data.state.results.filter(record => record.provider === provider && record.model === model && record.prompt === prompt);
}

async function runAndWait(page, runPrompt, provider, prompt) {
  const before = (await records(page, provider, prompt)).length;
  await runPrompt(page, provider, prompt);
  const deadline = Date.now() + 30000;
  for (;;) {
    const matching = await records(page, provider, prompt);
    if (matching.length > before && matching.every(record => record.verdict !== 'running')) return matching.at(-1);
    if (Date.now() > deadline) throw new Error(`${provider}/${prompt} 检测未完成：${JSON.stringify(matching.map(record => record.verdict))}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function selectHistory(page, provider, prompt) {
  await page.locator('#tab-history').click();
  await page.locator('#historyModel').selectOption(identity(provider, model));
  await page.locator('#historyPrompt').selectOption(prompt);
  await page.waitForSelector('#results details');
}

async function historyText(page) {
  return page.locator('#results').textContent();
}

async function downloadJSON(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#exportHistory').click();
  const file = await pending;
  return {name: file.suggestedFilename(), data: JSON.parse(await readFile(await file.path(), 'utf8'))};
}

export async function verifyHistoryAndReview({page, context, runPrompt}) {
  // A second run of the same question on the same target must be kept as its own record.
  await runAndWait(page, runPrompt, 'fixture-one', 'milk');
  assert.equal((await records(page, 'fixture-one', 'milk')).length, 2, '同题多次运行未分别保留');

  await selectHistory(page, 'fixture-one', 'milk');
  assert.equal(await page.locator('#results details').count(), 2, '筛选未显示同题两次运行');
  const firstProviderText = await historyText(page);
  assert.match(firstProviderText, /fixture-one \/ shared-model/);
  assert.doesNotMatch(firstProviderText, /fixture-two/);
  assert.equal(await page.locator('#historyCount').textContent(), '2 条记录');

  await page.locator('#historyModel').selectOption(identity('fixture-two', model));
  await page.waitForFunction(() => {
    const records = [...document.querySelectorAll('#results details')];
    return records.length > 0 && records.every(record => record.textContent.includes('fixture-two / shared-model'));
  });
  const secondProviderText = await historyText(page);
  assert.match(secondProviderText, /fixture-two \/ shared-model/, '同名模型记录串到了其他 provider');
  assert.doesNotMatch(secondProviderText, /fixture-one/);

  // Same-question comparison keeps both runs distinguishable by provider + model.
  await page.locator('#historyModel').selectOption(identity('fixture-one', model));
  await page.waitForFunction(() => {
    const records = [...document.querySelectorAll('#results details')];
    return records.length > 0 && records.every(record => record.textContent.includes('fixture-one / shared-model') &&
      !record.textContent.includes('进行中')) && document.querySelectorAll('#compareA option').length === 3;
  });
  await page.locator('#answerCompare summary').click();
  const options = await page.locator('#compareA option').evaluateAll(items => items.slice(1).map(option => option.value));
  assert.equal(options.length, 2, '对比候选缺少同题两次运行');
  await page.locator('#compareA').selectOption(options[0]);
  await page.locator('#compareB').selectOption(options[1]);
  assert.match(await page.locator('#compareTextA').textContent(), /46\.24 inches/);
  assert.match(await page.locator('#compareTextB').textContent(), /46\.24 inches/);
  assert.match(await page.locator('#compareMetaA').textContent(), /fixture-one \/ shared-model/);
  assert.match(await page.locator('#compareMetaB').textContent(), /17 tokens/);
  await page.waitForTimeout(3200);
  assert.equal(await page.locator('#compareA').inputValue(), options[0], '轮询重置了对比选择');

  // Export honours the current filters and carries the distinguishable identity.
  const exported = await downloadJSON(page);
  assert.match(exported.name, /\.json$/);
  assert.equal(exported.data.results.length, 2, '导出忽略当前筛选');
  for (const record of exported.data.results) {
    assert.equal(record.provider, 'fixture-one', '导出丢失 provider 身份');
    assert.equal(record.model, model, '导出丢失 model 身份');
    assert.equal(record.prompt, 'milk');
    assert.ok(record.id);
  }
  assert.equal(Object.hasOwn(exported.data, 'config'), false, '导出泄露配置');

  // Raw-answer download and clipboard copy remain available.
  const href = await page.locator('#results a.download').first().getAttribute('href');
  const downloaded = await context.request.get(new URL(href, page.url()).href);
  assert.equal(downloaded.status(), 200);
  assert.match(await downloaded.text(), /46\.24 inches/);

  await page.locator('#tab-tests').click();
  await page.locator('#model').selectOption(identity('fixture-one', model));
  await page.locator('#prompt').selectOption('milk');
  await page.waitForFunction(() => document.querySelectorAll('#testRecord option').length === 3);
  const newest = await page.locator('#testRecord option').nth(1).getAttribute('value');
  const older = await page.locator('#testRecord option').last().getAttribute('value');
  await page.locator('#testRecord').selectOption(older);
  assert.equal(await page.locator('#answerReview select[name=decision]').inputValue(), 'pending');

  await page.locator('#answerReview select[name=decision]').selectOption('accepted');
  await page.locator('#answerReview textarea[name=note]').fill('人工评审与自动评估分开保存');
  await page.locator('#answerReview button').click();
  await page.waitForFunction(() => document.querySelector('#reviewStatus').textContent.includes('已确认通过'));
  assert.match(await page.locator('#answerMeta').textContent(), /通过/, '人工评审覆盖了自动评估');

  await page.locator('#testRecord').selectOption(newest);
  assert.equal(await page.locator('#answerReview select[name=decision]').inputValue(), 'pending', '切换记录串用了评审');
  assert.equal(await page.locator('#answerReview textarea[name=note]').inputValue(), '');
  await page.locator('#testRecord').selectOption(older);
  assert.equal(await page.locator('#answerReview select[name=decision]').inputValue(), 'accepted');
  assert.equal(await page.locator('#answerReview textarea[name=note]').inputValue(), '人工评审与自动评估分开保存');

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(page.url()).origin});
  await page.locator('#copyAnswer').click();
  await page.waitForFunction(() => document.querySelector('#message').textContent === '回答已复制');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#testAnswer').textContent());

  // Reopening the console reads the human review and the automatic verdict independently.
  await page.reload();
  await page.waitForSelector('#testRecord', {state: 'attached'});
  await page.locator('#tab-tests').click();
  await page.locator('#model').selectOption(identity('fixture-one', model));
  await page.locator('#prompt').selectOption('milk');
  await page.waitForFunction(id => Boolean(document.querySelector(`#testRecord option[value="${id}"]`)), older);
  await page.locator('#testRecord').selectOption(older);
  assert.equal(await page.locator('#answerReview select[name=decision]').inputValue(), 'accepted');
  assert.equal(await page.locator('#answerReview textarea[name=note]').inputValue(), '人工评审与自动评估分开保存');
  assert.match(await page.locator('#answerMeta').textContent(), /通过/);
  return {reviewed: older, newest};
}

export async function verifyHistoryAfterRestart({page, reviewed}) {
  await page.locator('#tab-history').click();
  await page.locator('#historyModel').selectOption(identity('fixture-one', model));
  await page.locator('#historyPrompt').selectOption('milk');
  await page.waitForFunction(id => [...document.querySelectorAll('#results details')].some(details => details.dataset.id === id), reviewed);
  assert.equal(await page.locator('#results details').count(), 2, '重启后同题记录丢失');
  const details = page.locator(`#results details[data-id="${reviewed}"]`);
  await details.locator('summary').click();
  assert.match(await details.textContent(), /人工审核：确认通过 \/ 人工评审与自动评估分开保存/, '重启后人工评审丢失');
  assert.match(await details.textContent(), /46\.24 inches/, '重启后原文丢失');

  const exported = await downloadJSON(page);
  const record = exported.data.results.find(item => item.id === reviewed);
  assert.ok(record, '重启后导出丢失记录');
  assert.equal(record.provider, 'fixture-one');
  assert.equal(record.review, 'accepted');
  assert.equal(record.review_note, '人工评审与自动评估分开保存');

  await page.locator('#tab-tests').click();
  await page.locator('#model').selectOption(identity('fixture-one', model));
  await page.locator('#prompt').selectOption('milk');
  await page.waitForFunction(id => Boolean(document.querySelector(`#testRecord option[value="${id}"]`)), reviewed);
  await page.locator('#testRecord').selectOption(reviewed);
  assert.equal(await page.locator('#answerReview select[name=decision]').inputValue(), 'accepted', '重启后测试页评审丢失');
  assert.match(await page.locator('#answerMeta').textContent(), /通过/);
}
