import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenErrors } from '../src/common/utils/validation-messages';

test('N5: thông báo mặc định được Việt hóa, thông báo Việt của DTO giữ nguyên', () => {
  const out = flattenErrors([
    { property: 'n', constraints: { isInt: 'n must be an integer number', max: 'n must not be greater than 10' } },
    { property: 's', constraints: { maxLength: 's must be shorter than or equal to 3 characters' } },
    { property: 'm', constraints: { isInt: 'Số tiền phải là số nguyên đồng' } },
    { property: 'items', children: [{ property: '0', children: [{ property: 'note', constraints: { isString: 'note must be a string' } }] }] },
  ] as any);
  assert.deepEqual(out, [
    'Trường "n" phải là số nguyên',
    'Trường "n" không được lớn hơn 10',
    'Trường "s" tối đa 3 ký tự',
    'Số tiền phải là số nguyên đồng',
    'Trường "items.0.note" phải là chuỗi ký tự',
  ]);
});
