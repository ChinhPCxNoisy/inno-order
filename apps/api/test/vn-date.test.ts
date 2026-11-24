import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayRange, vnDayEnd } from '../src/common/utils/vn-date';

test('L13: ngày sai -> 400 (BadRequest), ngày đúng giữ nguyên', () => {
  for (const bad of ['abc', '2026-13-45', '2026-02-30', '', '2026-1-1', '2026-01-01T00:00']) {
    assert.throws(() => dayRange(bad), (e: any) => e.getStatus?.() === 400, bad);
  }
  assert.throws(() => vnDayEnd('xyz'), (e: any) => e.getStatus?.() === 400);
  assert.equal(dayRange('2026-11-24').start.toISOString(), '2026-11-23T17:00:00.000Z');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(dayRange().label));
});
