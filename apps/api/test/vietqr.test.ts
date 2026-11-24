import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildVietQr,
  crc16,
  extractCodeCandidates,
  generateIntentCode,
  normalizeContent,
  parseTlv,
  tlv,
  verifyCrc,
} from '../src/payments/vietqr';

test('CRC16/CCITT-FALSE: vector chuẩn "123456789" = 29B1', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(crc16(''), 'FFFF');
});

test('tlv: tag + độ dài 2 chữ số + giá trị', () => {
  assert.equal(tlv('00', '01'), '000201');
  assert.equal(tlv('58', 'VN'), '5802VN');
  assert.throws(() => tlv('1', 'x'));
  assert.throws(() => tlv('00', 'x'.repeat(100)));
});

test('buildVietQr: từng trường TLV đúng và CRC đúng', () => {
  const qr = buildVietQr({ bin: '970436', accountNumber: '0011004112233', amount: 245000, content: 'IO7K2M9XQ4' });
  // Dựng tay từng đoạn theo đặc tả 01 mục 5.1
  const member = '0006970436' + '0113' + '0011004112233';
  assert.equal(member, '00069704360113' + '0011004112233');
  const merchant = '0010A000000727' + '01' + String(member.length).padStart(2, '0') + member + '0208QRIBFTTA';
  const expectedBody =
    '000201' + '010212' + '38' + String(merchant.length).padStart(2, '0') + merchant + '5303704' + '540' + '6245000' + '5802VN' + '62' + '14' + '0810' + 'IO7K2M9XQ4';
  assert.equal(qr.slice(0, -8), expectedBody);
  assert.equal(qr.slice(-8, -4), '6304');
  assert.equal(qr.slice(-4), crc16(qr.slice(0, -4)));
  assert.ok(verifyCrc(qr));

  const top = parseTlv(qr);
  assert.deepEqual(top.map((t) => t.tag), ['00', '01', '38', '53', '54', '58', '62', '63']);
  const get = (t: string) => top.find((x) => x.tag === t)!.value;
  assert.equal(get('00'), '01');
  assert.equal(get('01'), '12');
  assert.equal(get('53'), '704');
  assert.equal(get('54'), '245000');
  assert.equal(get('58'), 'VN');
  const m38 = parseTlv(get('38'));
  assert.deepEqual(m38.map((t) => t.tag), ['00', '01', '02']);
  assert.equal(m38[0].value, 'A000000727');
  assert.equal(m38[2].value, 'QRIBFTTA');
  const bank = parseTlv(m38[1].value);
  assert.deepEqual(bank, [
    { tag: '00', value: '970436' },
    { tag: '01', value: '0011004112233' },
  ]);
  assert.deepEqual(parseTlv(get('62')), [{ tag: '08', value: 'IO7K2M9XQ4' }]);
});

test('verifyCrc phát hiện sửa số tiền hoặc CRC sai', () => {
  const qr = buildVietQr({ bin: '970415', accountNumber: '123456789', amount: 10000, content: 'IO00000000' });
  assert.ok(verifyCrc(qr));
  assert.ok(!verifyCrc(qr.replace('540510000', '540520000')));
  assert.ok(!verifyCrc(qr.slice(0, -1) + (qr.endsWith('0') ? '1' : '0')));
});

test('buildVietQr từ chối đầu vào xấu', () => {
  const ok = { bin: '970436', accountNumber: '123', amount: 1000, content: 'IOABCDEFGH' };
  assert.throws(() => buildVietQr({ ...ok, bin: '97043' }));
  assert.throws(() => buildVietQr({ ...ok, amount: 0 }));
  assert.throws(() => buildVietQr({ ...ok, amount: 10.5 }));
  assert.throws(() => buildVietQr({ ...ok, accountNumber: '12 34' }));
  assert.throws(() => buildVietQr({ ...ok, content: '   ' }));
});

test('generateIntentCode: IO + 8 ký tự Crockford, không trùng trong 5000 lần', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const c = generateIntentCode();
    assert.match(c, /^IO[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(c.length, 10);
    seen.add(c);
  }
  assert.equal(seen.size, 5000);
});

test('normalizeContent bỏ dấu, hoa, chỉ chữ-số', () => {
  assert.equal(normalizeContent('Thanh toán bàn Đỏ io7k-2m9x q4!'), 'THANHTOANBANDOIO7K2M9XQ4');
});

test('extractCodeCandidates: mã nằm giữa chữ khác, app đổi chữ thường/chèn khoảng trắng', () => {
  const n = normalizeContent('chuyen khoan io7k2m9xq4 cam on');
  assert.ok(extractCodeCandidates(n).includes('IO7K2M9XQ4'));
  assert.deepEqual(extractCodeCandidates(normalizeContent('khong co ma')), []);
  const two = extractCodeCandidates('IO7K2M9XQ4IO00000001');
  assert.ok(two.includes('IO7K2M9XQ4') && two.includes('IO00000001'));
});
