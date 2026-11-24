import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcLineTotal, calcTotals } from '../src/common/utils/totals';
import { roundAmount } from '../src/common/utils/money';
import { priceItems, PricingMenuItem } from '../src/orders/order-pricing';
import { offerDiscountAmount } from '../src/offers/offer-rules';

const bunBo: PricingMenuItem = {
  id: 'm1',
  name: 'Bún bò',
  price: 55000,
  active: true,
  category: { active: true },
  options: [
    { groupName: 'Cỡ', optionName: 'Lớn', extraPrice: 10000, isRequired: true },
    { groupName: 'Cỡ', optionName: 'Nhỏ', extraPrice: 0, isRequired: true },
    { groupName: 'Thêm', optionName: 'Trứng', extraPrice: 5000, isRequired: false },
    { groupName: 'Thêm2', optionName: 'Chả', extraPrice: 7000, isRequired: false },
  ],
};
const menu = new Map([[bunBo.id, bunBo]]);

test('H1: phụ thu option nhân số lượng: 2 x (55.000 + 10.000) = 130.000', () => {
  assert.equal(calcLineTotal(55000, [10000], 2), 130000);
  const r = priceItems(menu, [{ menuItemId: 'm1', quantity: 2, options: [{ groupName: 'Cỡ', optionName: 'Lớn' }] }]);
  assert.equal(r.lines[0].lineTotal, 130000);
  assert.equal(r.subtotal, 130000);
});

test('nhiều option, số lượng 3, nhiều dòng', () => {
  const r = priceItems(menu, [
    {
      menuItemId: 'm1',
      quantity: 3,
      options: [
        { groupName: 'Cỡ', optionName: 'Lớn' },
        { groupName: 'Thêm', optionName: 'Trứng' },
        { groupName: 'Thêm2', optionName: 'Chả' },
      ],
    },
    { menuItemId: 'm1', quantity: 1, options: [{ groupName: 'Cỡ', optionName: 'Nhỏ' }] },
  ]);
  assert.equal(r.lines[0].lineTotal, 3 * (55000 + 10000 + 5000 + 7000)); // 231.000
  assert.equal(r.lines[1].lineTotal, 55000);
  assert.equal(r.subtotal, 231000 + 55000);
});

test('option bắt buộc thiếu / trùng nhóm / không tồn tại bị từ chối', () => {
  assert.throws(() => priceItems(menu, [{ menuItemId: 'm1', quantity: 1 }]), /chọn Cỡ/);
  assert.throws(
    () =>
      priceItems(menu, [
        { menuItemId: 'm1', quantity: 1, options: [{ groupName: 'Cỡ', optionName: 'Lớn' }, { groupName: 'Cỡ', optionName: 'Nhỏ' }] },
      ]),
    /chỉ được chọn 1/,
  );
  assert.throws(
    () => priceItems(menu, [{ menuItemId: 'm1', quantity: 1, options: [{ groupName: 'Cỡ', optionName: 'XL' }] }]),
    /không còn tồn tại/,
  );
});

test('VAT bật/tắt, giảm giá, tổng luôn là số nguyên đồng', () => {
  assert.deepEqual(calcTotals(130000, 0, {}), { vatAmount: 0, totalAmount: 130000 });
  assert.deepEqual(calcTotals(130000, 0, { vatEnabled: true, vatRate: 10 }), { vatAmount: 13000, totalAmount: 143000 });
  // VAT tính sau giảm giá
  assert.deepEqual(calcTotals(130000, 26000, { vatEnabled: true, vatRate: 10 }), { vatAmount: 10400, totalAmount: 114400 });
  // VAT lẻ làm tròn đồng (1.005 * 10% = 100,5 -> 101)
  const t = calcTotals(1005, 0, { vatEnabled: true, vatRate: 10 });
  assert.equal(t.vatAmount, 101);
  assert.ok(Number.isInteger(t.totalAmount));
  assert.equal(calcTotals(100050, 0, { rounding: 'nearest_100' }).totalAmount, 100100);
  assert.equal(roundAmount(1000.4, 'none'), 1000);
});

test('giảm theo % làm tròn đồng; hủy một phần tính lại từ các dòng còn lại', () => {
  const offer = {
    code: 'X',
    discountType: 'PERCENT' as const,
    value: 15,
    maxDiscount: null,
    minSubtotal: 0,
    startsAt: new Date(0),
    endsAt: null,
    totalLimit: null,
    usedCount: 0,
    stackable: true,
    active: true,
    extraTerms: null,
  };
  assert.equal(offerDiscountAmount(offer, 130000), 19500);
  assert.equal(offerDiscountAmount({ ...offer, value: 0.5 }, 90001), 450); // 450,005 -> 450
  assert.equal(offerDiscountAmount({ ...offer, value: 33.33 }, 1001), 334); // 333,6633 -> 334
  const r = priceItems(menu, [
    { menuItemId: 'm1', quantity: 2, options: [{ groupName: 'Cỡ', optionName: 'Lớn' }] },
    { menuItemId: 'm1', quantity: 1, options: [{ groupName: 'Cỡ', optionName: 'Nhỏ' }] },
  ]);
  const remaining = r.lines.slice(1).reduce((s, l) => s + l.lineTotal, 0); // huy dong 1 -> con 55.000
  assert.equal(calcTotals(remaining, 0, { vatEnabled: true, vatRate: 8 }).totalAmount, 59400);
});
