import test from 'node:test';
import assert from 'node:assert/strict';
import { usageLabel, usageTotals } from '../internal/check/web/assets/ui.js';

test('missing usage is shown as unavailable, never as zero', () => {
  assert.equal(usageLabel({verdict: 'passed'}), '用量不可用');
  assert.equal(usageLabel({verdict: 'passed', usage: {}}), '用量不可用');
  assert.equal(usageLabel({verdict: 'passed', usage: {input_tokens: 12, output_tokens: 5}}), '17 tokens');
  assert.equal(usageLabel({verdict: 'passed', usage: {input_tokens: 12, output_tokens: 5, total_tokens: 17}}), '17 tokens');
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
