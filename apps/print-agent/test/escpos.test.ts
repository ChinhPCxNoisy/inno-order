import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EscPosBuilder } from '../src/escpos/builder.js';
import { cmdCut, cmdDrawer, cmdQr } from '../src/escpos/commands.js';
import { getDefaultRasterizer } from '../src/escpos/glyphs.js';
import { makeProfile } from '../src/escpos/profile.js';
import { decodeCp1258, encodeCp1258, removeDiacritics } from '../src/escpos/vietnamese.js';
import { amountWidth, itemLines, kvLines, wrapText } from '../src/document/layout.js';
import { decodeEscPos } from '../src/preview/decode.js';

const ALPHABET =
  'aàáảãạ ăằắẳẵặ âầấẩẫậ eèéẻẽẹ êềếểễệ iìíỉĩị oòóỏõọ ôồốổỗộ ơờớởỡợ uùúủũụ ưừứửữự yỳýỷỹỵ đ ' +
  'AÀÁẢÃẠ ĂẰẮẲẴẶ ÂẦẤẨẪẬ EÈÉẺẼẸ ÊỀẾỂỄỆ IÌÍỈĨỊ OÒÓỎÕỌ ÔỒỐỔỖỘ ƠỜỚỞỠỢ UÙÚỦŨỤ ƯỪỨỬỮỰ YỲÝỶỸỴ Đ';

test('bo dau tieng Viet dung cach', () => {
  assert.equal(removeDiacritics('Nguyễn Thị Hương'), 'Nguyen Thi Huong');
  assert.equal(removeDiacritics('Đỗ Đình Đạt, đường'), 'Do Dinh Dat, duong');
  assert.equal(removeDiacritics('Lẩu Thái hải sản – 2 × 5.000₫'), 'Lau Thai hai san - 2 x 5.000d');
  assert.equal(removeDiacritics('ẶỢẤ'), 'AOA');
  assert.equal(removeDiacritics('a\u001bb'), 'a?b'); // ky tu dieu khien khong lot qua
});

test('CP1258: moi chu cai tieng Viet ma hoa roi giai ma lai dung', () => {
  const bytes = encodeCp1258(ALPHABET);
  assert.ok(bytes.every((b) => b < 0x80 || b >= 0x80)); // chi la byte
  assert.equal(decodeCp1258(bytes), ALPHABET.normalize('NFC'));
  // chu co dau chong duoc tach thanh chu goc + dau thanh roi
  assert.deepEqual([...encodeCp1258('ấ')], [0xe2, 0xec]); // a^ + dau sac roi (0xEC)
  assert.deepEqual([...encodeCp1258('ặ')], [0xe3, 0xf2]); // a( + dau nang roi (0xF2)
  assert.deepEqual([...encodeCp1258('à')], [0xe0]); // co san trong bang ma
});

test('lenh co ban: cat, ket tien, QR, khoi tao', () => {
  assert.deepEqual([...cmdCut('partial')], [0x1d, 0x56, 0x01]);
  assert.deepEqual([...cmdCut('full')], [0x1d, 0x56, 0x00]);
  assert.deepEqual([...cmdCut('partial_feed')], [0x1d, 0x56, 66, 0]);
  assert.equal(cmdCut('none').length, 0);
  assert.deepEqual([...cmdDrawer(0)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
  assert.deepEqual([...cmdDrawer(1)], [0x1b, 0x70, 0x01, 0x19, 0xfa]);
  const qr = cmdQr(Buffer.from('abc'), 6, 'M');
  assert.ok(qr.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x06, 0x00, 0x31, 0x50, 0x30, 0x61, 0x62, 0x63])));
  assert.ok(qr.subarray(qr.length - 8).equals(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])));
});

test('builder native: ESC @, can le, dam, co chu, cat, ket', () => {
  const b = new EscPosBuilder(makeProfile(80, { encoding: 'ascii', cutMode: 'partial', feedBeforeCut: 3 }));
  const bytes = b.init().line('Xin chào', { align: 'center', bold: true, w: 2, h: 2 }).cut().drawer().build();
  const hex = bytes.toString('hex');
  assert.ok(hex.startsWith('1b40'));
  assert.ok(hex.includes('1b6101')); // can giua
  assert.ok(hex.includes('1b4501')); // dam
  assert.ok(hex.includes('1d2111')); // 2x2
  assert.ok(hex.includes(Buffer.from('Xin chao\n').toString('hex'))); // bo dau
  assert.ok(hex.includes('1b6403' + '1d5601')); // day 3 dong roi cat
  assert.ok(hex.endsWith('1b7000' + '19fa'));
});

test('builder cp1258: gui ESC t va byte Windows-1258', () => {
  const b = new EscPosBuilder(makeProfile(58, { encoding: 'cp1258', codePage: 52 }));
  const bytes = b.init().line('Hương').build();
  assert.ok(bytes.subarray(0, 5).equals(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 52])));
  assert.equal(decodeCp1258(bytes.subarray(5, bytes.length - 1)), 'Hương');
});

test('do rong cot 58mm (32) va 80mm (48): moi dong mon dung bang be rong', () => {
  for (const cols of [32, 48]) {
    const lines = itemLines('12', 'Bánh mì thịt nướng đặc biệt nhiều pate thêm trứng ốp la', '1.250.000', ['2 x 625.000', 'Cay: Vừa'], cols);
    assert.ok(lines.length >= 3);
    for (const l of lines) assert.ok(Array.from(l).length <= cols, `dong vuot ${cols}: "${l}"`);
    assert.equal(Array.from(lines[0]).length, cols); // dong dau du cot: SL + ten + thanh tien
    assert.ok(lines[0].endsWith('1.250.000'));
    assert.ok(amountWidth(cols) >= 10);
  }
  const kv = kvLines('Tạm tính', '100.000', 32);
  assert.equal(kv.length, 1);
  assert.equal(Array.from(kv[0]).length, 32);
});

test('xuong dong khong cat giua tu, khong cat giua chu co dau', () => {
  assert.deepEqual(wrapText('Lẩu Thái hải sản đặc biệt', 12), ['Lẩu Thái hải', 'sản đặc biệt']);
  const long = wrapText('Nghiêu'.repeat(6), 10);
  for (const l of long) assert.ok(Array.from(l).length <= 10);
  assert.equal(long.join(''), 'Nghiêu'.repeat(6)); // khong mat/hu chu
  assert.deepEqual(wrapText('a b', 10, 2), ['a b']);
  const hang = wrapText('một hai ba bốn năm sáu', 10, 3);
  assert.ok(hang.slice(1).every((l) => l.startsWith('   ')));
});

test('raster: dau tieng Viet tao ra anh khac nhau, lenh GS v 0 dung kich thuoc', () => {
  const r = getDefaultRasterizer();
  const st = { bold: false, w: 1, h: 1 };
  const a = r.glyph('a', st);
  const aDot = r.glyph('ạ', st);
  const aHat = r.glyph('ấ', st);
  assert.notDeepEqual([...a.data], [...aDot.data]);
  assert.notDeepEqual([...aDot.data], [...aHat.data]);
  assert.ok(aHat.data.some((v) => v)); // co ve
  // ky tu thieu phong chu van ve duoc (dau hoi) chu khong nem loi
  assert.ok(r.glyph('☃', st).data.some((v) => v));

  const profile = makeProfile(80);
  const bytes = new EscPosBuilder(profile).init().line('Nguyễn Thị Hương').line('ĐỔI BÀN', { w: 2, h: 2, bold: true }).build();
  const items = decodeEscPos(bytes);
  const img = items.find((i) => i.type === 'image');
  assert.ok(img && img.type === 'image');
  assert.equal(img.bitmap.width, 576);
  assert.equal(img.bitmap.height, 28 + 56);
  assert.equal(items.filter((i) => i.type === 'image').length, 1); // gop thanh mot anh
});
