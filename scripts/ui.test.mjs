import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { usageLabel, usageTotals, traceBatchState, traceRunning } from '../internal/check/web/assets/ui.js';

test('ModelTrace batch state explains complete, failed and cancelled batches', () => {
  const manual = Array.from({length: 3}, () => ({verdict: 'manual'}));
  assert.equal(traceBatchState(manual), 'complete');
  assert.equal(traceBatchState([{verdict: 'running'}, {verdict: 'running'}, {verdict: 'running'}]), 'running');
  assert.equal(traceBatchState([{verdict: 'unavailable'}, {verdict: 'manual'}, {verdict: 'manual'}]), 'failed');
  assert.equal(traceBatchState([{verdict: 'cancelled'}, {verdict: 'skipped'}, {verdict: 'skipped'}]), 'cancelled');
  assert.equal(traceBatchState([{verdict: 'unavailable'}, {verdict: 'cancelled'}, {verdict: 'skipped'}]), 'cancelled');
  assert.equal(traceBatchState([{verdict: 'skipped'}, {verdict: 'skipped'}, {verdict: 'skipped'}]), 'cancelled');
  assert.equal(traceBatchState([{verdict: 'manual'}, {verdict: 'skipped'}]), 'cancelled');
  assert.equal(traceBatchState([{verdict: 'manual'}, {verdict: 'manual'}]), 'incomplete');
});

test('expired preview sessions point at the DSH entry', () => {
  const source = readFileSync(new URL('../internal/check/web/assets/html-preview.js', import.meta.url), 'utf8');
  assert.match(source, /DeepSeek Harness/);
  assert.doesNotMatch(source, /Magpie/);
});

test('ModelTrace cancel availability ignores quality checks', () => {
  assert.equal(traceRunning([{prompt: 'milk', verdict: 'running'}]), false);
  assert.equal(traceRunning([{prompt: 'milk', verdict: 'running'}, {prompt: 'modeltrace', verdict: 'running'}]), true);
  assert.equal(traceRunning([{prompt: 'modeltrace', verdict: 'manual'}]), false);
});

test('missing usage is shown as unavailable, never as zero', () => {
  assert.equal(usageLabel({verdict: 'passed'}), '用量不可用');
  assert.equal(usageLabel({verdict: 'passed', usage: {}}), '用量不可用');
  assert.equal(usageLabel({verdict: 'passed', usage: {input_tokens: 12, output_tokens: 5}}), '17 tokens');
  assert.equal(usageLabel({verdict: 'passed', usage: {input_tokens: 12, output_tokens: 5, total_tokens: 17}}), '17 tokens');
});

test('unstarted requests are not shown as missing usage', () => {
  assert.equal(usageLabel({verdict: 'skipped'}), '未开始');
  assert.deepEqual(usageTotals([
    {verdict: 'manual', usage: {input_tokens: 12, output_tokens: 5, total_tokens: 17}},
    {verdict: 'skipped'},
    {verdict: 'skipped'},
  ]), {total: 17, reported: 1, missing: 0});
});

test('usage totals separate reported records from missing ones', () => {
  const totals = usageTotals([
    {verdict: 'passed', usage: {input_tokens: 12, output_tokens: 5, total_tokens: 17}},
    {verdict: 'truncated', usage: {input_tokens: 2, output_tokens: 1}},
    {verdict: 'passed'},
    {verdict: 'running'},
  ]);
  assert.deepEqual(totals, {total: 20, reported: 2, missing: 1});
  assert.deepEqual(usageTotals([{verdict: 'passed'}]), {total: 0, reported: 0, missing: 1});
});
