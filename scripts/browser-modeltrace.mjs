import assert from 'node:assert/strict';

const model = 'shared-model';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function selectTraceTarget(page, provider) {
  await page.locator('#tab-fingerprint').click();
  await page.evaluate(providerId => {
    const select = document.querySelector('#traceModel');
    const option = [...select.options].find(item => item.textContent.startsWith(`${providerId} / shared-model`));
    if (!option) throw new Error(`missing trace target ${providerId}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }, provider);
}

async function latestBatch(page, provider) {
  const data = await page.evaluate(() => fetch('/api/state').then(response => response.json()));
  const records = data.state.results.filter(record => record.provider === provider && record.model === model && record.prompt === 'modeltrace');
  const batch = records.at(-1)?.batch;
  return {batch, results: records.filter(record => record.batch === batch)};
}

async function waitForBatch(page, provider) {
  const deadline = Date.now() + 60000;
  for (;;) {
    const snapshot = await latestBatch(page, provider);
    if (snapshot.batch && snapshot.results.length === 3 && snapshot.results.every(record => record.verdict !== 'running')) return snapshot;
    if (Date.now() > deadline) throw new Error(`ModelTrace batch did not finish: ${JSON.stringify(snapshot.results.map(record => record.verdict))}`);
    await wait(200);
  }
}

async function selectTestTarget(page, provider) {
  await page.locator('#tab-tests').click();
  await page.evaluate(providerId => {
    const select = document.querySelector('#model');
    const option = [...select.options].find(item => item.textContent.includes(`${providerId} / shared-model`));
    if (!option) throw new Error(`missing test target ${providerId}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  }, provider);
}

// A running quality check must not expose or accept ModelTrace cancellation.
export async function verifyModelTraceDoesNotCancelQualityCheck({page}) {
  await selectTestTarget(page, 'fixture-one');
  await page.locator('#prompt').selectOption('milk');
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#testAnswer').getAttribute('aria-busy') === 'true', {}, {timeout: 20000});
  const status = await page.evaluate(() => fetch('/api/action', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({provider: 'fixture-one', model: 'shared-model', action: 'cancel-modeltrace'}),
  }).then(response => response.status));
  assert.equal(status, 400, 'cancel-modeltrace 在无 ModelTrace 批次时被接受');
  await selectTraceTarget(page, 'fixture-one');
  await page.waitForFunction(() => document.querySelector('#traceRun').disabled, {}, {timeout: 15000});
  assert.equal(await page.locator('#traceCancel').isVisible(), false, '质量检测运行时仍显示 ModelTrace 取消按钮');
  await page.locator('#tab-tests').click();
  await page.waitForFunction(() => document.querySelector('#answerMeta').textContent.includes('通过'), {}, {timeout: 30000});
  assert.equal(await page.locator('#testAnswer').textContent(), '46.24 inches');
}

export async function verifyModelTrace({page, slow, one}) {
  // A complete batch keeps generation parameters, batch identity and raw answers,
  // and shows closed-set behavioural similarity rather than identity proof.
  await selectTraceTarget(page, 'fixture-one');
  await page.locator('#traceRun').click();
  await page.locator('#traceResults .trace-report').waitFor({timeout: 60000});
  assert.equal(await page.locator('#traceResults .trace-batch').textContent(), '批次已完成');
  const reportText = await page.locator('#traceResults').textContent();
  assert.match(reportText, /最相似候选/);
  assert.match(reportText, /闭集行为相似性排序/);
  assert.match(reportText, /不能证明模型身份/);
  assert.equal(await page.locator('#traceResults .trace-item .state').count(), 3);
  const complete = await waitForBatch(page, 'fixture-one');
  const counts = new Set();
  for (const result of complete.results) {
    assert.equal(result.verdict, 'manual');
    assert.equal(result.batch, complete.batch);
    assert.equal(result.provider, 'fixture-one');
    assert.equal(result.model, model);
    assert.ok(result.answer && result.answer.length > 0, 'raw ModelTrace answer missing');
    assert.ok(result.prompt_text && result.prompt_text.includes('1 到 355'), 'challenge prompt missing');
    assert.ok(result.expected_count >= 292 && result.expected_count <= 332, `unexpected challenge length ${result.expected_count}`);
    counts.add(result.expected_count);
  }
  assert.equal(counts.size, 3, 'challenge sizes reused within a batch');
  const traceRequests = one.requests.filter(request => request.trace);
  assert.equal(traceRequests.length, 3);
  assert.ok(traceRequests.every(request => request.max_tokens === 8192), 'ModelTrace generation parameters changed');

  // Invalid raw answers remain inspectable and are not attributed.
  await selectTraceTarget(page, 'fixture-two');
  await page.locator('#traceRun').click();
  await page.waitForFunction(() => document.querySelector('#traceResults .trace-batch')?.textContent === '批次已完成', {}, {timeout: 60000});
  await page.waitForFunction(() => /本轮无法归因/.test(document.querySelector('#traceResults').textContent), {}, {timeout: 30000});
  assert.match(await page.locator('#traceResults').textContent(), /没有可用回答/);
  const invalid = await waitForBatch(page, 'fixture-two');
  for (const result of invalid.results) {
    assert.equal(result.verdict, 'manual');
    assert.equal(result.answer, 'I cannot complete this task.');
  }

  // Cancelling a batch aborts the active host call and stops unstarted challenges.
  await selectTraceTarget(page, 'fixture-slow');
  const before = slow.requests.filter(request => request.trace).length;
  await page.locator('#traceRun').click();
  await page.locator('#traceCancel').waitFor({state: 'visible', timeout: 20000});
  await page.waitForFunction(() => document.querySelector('#traceResults .trace-batch')?.textContent === '批次进行中', {}, {timeout: 20000});
  for (let index = 0; index < 100 && slow.requests.filter(request => request.trace).length === before; index++) await wait(100);
  assert.ok(slow.requests.filter(request => request.trace).length > before, 'cancelled ModelTrace batch never reached the host model');
  const crossCancel = await page.evaluate(() => fetch('/api/action', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({provider: 'fixture-slow', model: 'shared-model', action: 'cancel-test'}),
  }).then(response => response.status));
  assert.equal(crossCancel, 400, 'cancel-test 在无质量检测时取消了 ModelTrace 批次');
  await page.locator('#traceCancel').click();
  await page.waitForFunction(() => document.querySelector('#traceResults .trace-batch')?.textContent === '批次已取消', {}, {timeout: 30000});
  const statuses = await page.locator('#traceResults .trace-item .state').allTextContents();
  assert.ok(statuses.includes('已取消'), `missing cancelled entry: ${statuses}`);
  assert.ok(statuses.includes('未开始'), `missing unstarted entry: ${statuses}`);
  const cancelled = await waitForBatch(page, 'fixture-slow');
  const cancelledEntry = cancelled.results.find(record => record.verdict === 'cancelled');
  assert.ok(cancelledEntry, `no cancelled entry: ${JSON.stringify(cancelled.results.map(record => record.verdict))}`);
  assert.equal(cancelledEntry.error, '检测已取消');
  const skipped = cancelled.results.filter(record => record.verdict === 'skipped');
  assert.equal(skipped.length, 2);
  assert.ok(skipped.every(record => record.error.includes('未开始')));
  assert.equal(slow.requests.filter(request => request.trace).length - before, 1, 'cancel did not stop unstarted challenges');
  assert.equal(cancelled.results.filter(record => record.verdict !== 'skipped').length, 1, 'unstarted requests counted as invoked');
  for (let index = 0; index < 50 && slow.cancelled.length === 0; index++) await wait(100);
  assert.ok(slow.cancelled.some(request => request.trace), '取消未传递到宿主模型调用');
}

export async function verifyModelTraceHistory(page) {
  await page.locator('#tab-history').click();
  await page.locator('#historyModel').selectOption('');
  await page.locator('#historyPrompt').selectOption('modeltrace');
  await page.locator('#historyVerdict').selectOption('skipped');
  await page.waitForFunction(() => document.querySelectorAll('#results details').length === 2, {}, {timeout: 15000});
  assert.match(await page.locator('#results').textContent(), /未开始/);
  await page.locator('#historyVerdict').selectOption('cancelled');
  await page.waitForFunction(() => document.querySelectorAll('#results details').length === 1, {}, {timeout: 15000});
  assert.match(await page.locator('#results').textContent(), /已取消/);
  await page.locator('#historyVerdict').selectOption('');
}
