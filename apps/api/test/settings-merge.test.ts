import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeStoreSettings } from '../src/stores/settings-merge';

const owner = { canEditOwnerOnly: true };
const manager = { canEditOwnerOnly: false };
const current = {
  vatEnabled: false,
  payment: { customerCanPayQr: true, qrIntentTtlMinutes: 15 },
  pos: { allowWaiterMoveTable: true, discountLimits: { cashierMaxPercent: 10, cashierMaxAmount: null } },
  printing: { mode: 'AGENT', footerText: 'Cảm ơn' },
  legacyKey: 'x',
};

test('M5: đổi VAT không làm mất payment/pos/printing', () => {
  const r = mergeStoreSettings(current, { vatEnabled: true, vatRate: 10 }, owner) as any;
  assert.equal(r.vatEnabled, true);
  assert.equal(r.vatRate, 10);
  assert.equal(r.payment.customerCanPayQr, true);
  assert.equal(r.payment.qrIntentTtlMinutes, 15);
  assert.deepEqual(r.pos.discountLimits, { cashierMaxPercent: 10, cashierMaxAmount: null });
  assert.equal(r.printing.footerText, 'Cảm ơn');
  assert.equal(r.legacyKey, 'x');
});

test('merge sâu: chỉ đổi khóa con được gửi; không mutate đầu vào', () => {
  const snapshot = JSON.stringify(current);
  const r = mergeStoreSettings(current, { pos: { allowWaiterMoveTable: false } }, owner) as any;
  assert.equal(r.pos.allowWaiterMoveTable, false);
  assert.equal(r.pos.discountLimits.cashierMaxPercent, 10);
  assert.equal(JSON.stringify(current), snapshot);
});

test('form admin gửi lại cả khối cũ: giữ nguyên, khóa lạ bị bỏ qua', () => {
  const r = mergeStoreSettings(current, { ...current, evil: 1, payment: { ...current.payment, hack: true } }, owner) as any;
  assert.equal(r.evil, undefined);
  assert.equal(r.payment.hack, undefined);
  assert.equal(r.legacyKey, 'x');
});

test('discountLimits chỉ chủ quán sửa; quản lý bị bỏ qua; null = không giới hạn được giữ', () => {
  const m = mergeStoreSettings(current, { pos: { discountLimits: { cashierMaxPercent: 100 } } }, manager) as any;
  assert.equal(m.pos.discountLimits.cashierMaxPercent, 10);
  const o = mergeStoreSettings(current, { pos: { discountLimits: { cashierMaxPercent: null, cashierMaxAmount: 50000 } } }, owner) as any;
  assert.equal(o.pos.discountLimits.cashierMaxPercent, null);
  assert.equal(o.pos.discountLimits.cashierMaxAmount, 50000);
});

test('null xóa khóa; giá trị sai kiểu bị 400', () => {
  const r = mergeStoreSettings({ bannerUrl: 'a', printing: { mode: 'AGENT' } }, { bannerUrl: null, printing: { mode: null } }, owner) as any;
  assert.equal(r.bannerUrl, undefined);
  assert.equal(r.printing.mode, undefined);
  assert.throws(() => mergeStoreSettings({}, { vatRate: 'abc' }, owner), /vatRate/);
  assert.throws(() => mergeStoreSettings({}, { vatEnabled: 'yes' }, owner), /true\/false/);
  assert.throws(() => mergeStoreSettings({}, { printing: { mode: 'XYZ' } }, owner), /printing\.mode/);
  assert.throws(() => mergeStoreSettings({}, 'abc', owner), /đối tượng/);
});

test('N2: null ở mọi cấp, quản lý không xóa được khóa owner-only', () => {
  const m = (patch: unknown) => mergeStoreSettings(current, patch, manager) as any;
  const o = (patch: unknown) => mergeStoreSettings(current, patch, owner) as any;
  // quan ly: pos:null chi xoa khoa con thuong, giu discountLimits
  assert.deepEqual(m({ pos: null }).pos, { discountLimits: current.pos.discountLimits });
  assert.deepEqual(m({ pos: { discountLimits: null } }).pos.discountLimits, current.pos.discountLimits);
  assert.deepEqual(m({ pos: { discountLimits: { cashierMaxPercent: null } } }).pos.discountLimits, current.pos.discountLimits);
  // khoi khong co khoa owner-only: xoa binh thuong
  assert.equal(m({ payment: null }).payment, undefined);
  assert.equal(m({ printing: null }).printing, undefined);
  // chu quan xoa duoc tat ca
  assert.equal(o({ pos: null }).pos, undefined);
  assert.equal(o({ pos: { discountLimits: null } }).pos.discountLimits, undefined);
  assert.equal(o({ payment: null }).payment, undefined);
  assert.equal(o({ printing: null }).printing, undefined);
});
