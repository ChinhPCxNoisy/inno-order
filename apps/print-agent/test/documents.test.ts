import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDocument, opsToText } from '../src/document/layout.js';
import { renderDocument, validateDocument } from '../src/document/render.js';
import { makeProfile } from '../src/escpos/profile.js';
import { decodeEscPos, renderPreviewText } from '../src/preview/decode.js';
import { buildSampleData } from '../src/samples.js';
import { buildBill, buildCancelTicket, buildKitchenTicket, buildTestPage, formatVnd } from '../src/templates/index.js';

const s = buildSampleData();
const text = (doc: ReturnType<typeof buildBill>, width: 58 | 80) => {
  const p = makeProfile(width);
  return opsToText(layoutDocument(doc, p), p.cols);
};

test('dinh dang tien VND', () => {
  assert.equal(formatVnd(1250000), '1.250.000');
  assert.equal(formatVnd(999), '999');
  assert.equal(formatVnd(-62000), '-62.000');
});

test('phieu bep: ban, don, dot goi, mon, tuy chon, ghi chu, khong in gia', () => {
  const t = text(buildKitchenTicket(s.kitchen), 80);
  for (const need of ['BÀN B05', 'Đơn #1042', '19:42', 'ĐỢT 2 - GỌI THÊM', '2 x Lẩu Thái hải sản', '+ Cay: Vừa', '>> ít hành, không ngò', '3 x Cơm chiên dương châu', 'GHI CHÚ: Khách dị ứng đậu phộng', 'Nguồn: QR khách']) {
    assert.ok(t.includes(need), `thieu "${need}" trong:\n${t}`);
  }
  assert.ok(!/\d\.\d{3}/.test(t)); // khong co gia
  assert.ok(t.includes('CAT GIAY'));
  // dot 1 thi khong co dong "DOT"
  const first = text(buildKitchenTicket({ ...s.kitchen, round: 1 }), 80);
  assert.ok(!first.includes('ĐỢT'));
});

test('phieu bep in lai co nhan IN LAI va so lan', () => {
  const t = text(buildKitchenTicket({ ...s.kitchen, reprint: { count: 2 } }), 58);
  assert.ok(t.split('\n')[0].includes('IN LẠI (lần 2)'));
});

test('phieu huy mon', () => {
  const t = text(buildCancelTicket(s.cancel), 58);
  for (const need of ['HỦY MÓN', 'BÀN B05', '- 1 x Cà phê sữa đá', 'Lý do: Khách đổi món', 'Người hủy: Nguyễn Thị Hương', 'KHÔNG LÀM MÓN NÀY NỮA']) {
    assert.ok(t.includes(need), `thieu "${need}"`);
  }
});

test('bill gop ban: don gop, tam tinh, giam gia, VAT, tong, thanh toan, QR', () => {
  const t = text(buildBill(s.bill), 80);
  for (const need of ['Quán Nhà Hương', 'HÓA ĐƠN THANH TOÁN', 'Đơn #1040', 'Đơn #1042 (đợt 2)', '500.000', 'Tạm tính', '622.000', '-62.000', 'VAT (8%)', '44.800', 'TỔNG CỘNG', '604.800đ', 'Tiền mặt', 'Khách đưa', '700.000', 'Tiền thối', '95.200', 'Cảm ơn', '[QR: https://innoorder.example/bill/HD-000123]']) {
    assert.ok(t.includes(need), `thieu "${need}" trong:\n${t}`);
  }
  const pre = text(buildBill({ ...s.bill, preBill: true, payments: [] }), 80);
  assert.ok(pre.includes('PHIẾU TẠM TÍNH'));
  assert.ok(!pre.includes('Tiền mặt'));
});

test('bill 58mm: khong dong nao vuot 32 cot, ten dai xuong dong, du cot gia', () => {
  const bill = structuredClone(s.bill);
  bill.orders[0].items[0].name = 'Lẩu Thái hải sản đặc biệt thập cẩm cho bốn người ăn';
  const p = makeProfile(58);
  const ops = layoutDocument(buildBill(bill), p);
  for (const o of ops) {
    if (o.op !== 'line') continue;
    assert.ok(Array.from(o.text).length <= Math.floor(32 / o.w), `dong qua rong (${o.w}x): "${o.text}"`);
  }
  const t = opsToText(ops, 32);
  assert.ok(t.includes('500.000'));
  assert.ok(t.includes('đặc biệt thập cẩm')); // xuong dong dung tu
});

test('phieu thu co dong mau tieu chi A8.1', () => {
  const t = text(buildTestPage({ printerName: 'Bếp', at: '2026-11-12T12:00:00Z' }), 80);
  assert.ok(t.includes('Hồ sơ: Nguyễn Thị Hương, Cà phê sữa đá'));
  assert.ok(t.includes('12/11/2026 19:00'));
});

test('ASCII: bo dau, khong con byte >= 0x80; giai ma ra dung', () => {
  const p = makeProfile(80, { encoding: 'ascii' });
  const bytes = renderDocument(buildKitchenTicket(s.kitchen), p);
  assert.ok(bytes.every((b) => b < 0x80));
  const t = renderPreviewText(decodeEscPos(bytes), { cols: 48 });
  assert.ok(t.includes('2 x Lau Thai hai san'));
  assert.ok(t.includes('BAN B05'));
});

test('CP1258: giai ma phieu ra dung tieng Viet co dau', () => {
  const p = makeProfile(80, { encoding: 'cp1258' });
  const bytes = renderDocument(buildKitchenTicket(s.kitchen), p);
  const t = renderPreviewText(decodeEscPos(bytes), { cols: 48 });
  assert.ok(t.includes('2 x Lẩu Thái hải sản'), t);
  assert.ok(t.includes('>> ít hành, không ngò'));
  assert.ok(t.includes('ĐỢT 2'));
});

test('raster: phieu bep ra anh 576 diem, co cat giay, khong con chu native', () => {
  const bytes = renderDocument(buildKitchenTicket(s.kitchen), makeProfile(80));
  const items = decodeEscPos(bytes);
  assert.equal(items.filter((i) => i.type === 'text').length, 0);
  const img = items.find((i) => i.type === 'image');
  assert.ok(img && img.type === 'image' && img.bitmap.width === 576 && img.bitmap.height > 300);
  assert.ok(items.some((i) => i.type === 'cut'));
});

test('tai lieu server gui (JSON thuan) hop le; du lieu doc hai bi tu choi hoac vo hieu hoa', () => {
  assert.throws(() => validateDocument({ v: 2, blocks: [] }));
  assert.throws(() => validateDocument({ v: 1, blocks: [{ t: 'exec', cmd: 'x' }] }));
  assert.throws(() => validateDocument({ v: 1, blocks: [{ t: 'qr', d: '' }] }));
  const doc = validateDocument({ v: 1, blocks: [{ t: 'text', s: 'a\u001b@b\u001dV\u0000c' }, { t: 'cut' }] });
  const bytes = renderDocument(doc, makeProfile(58, { encoding: 'ascii' }));
  // lenh ESC/POS nhung trong chu bi loai bo: chi con ESC @ khoi tao dau tien
  assert.equal(bytes.indexOf(Buffer.from([0x1b, 0x40])), 0);
  assert.equal(bytes.indexOf(Buffer.from([0x1b, 0x40]), 1), -1);
  assert.ok(bytes.includes(Buffer.from('a@bVc\n')));
});
