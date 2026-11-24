import { randomBytes } from 'node:crypto';

/**
 * Chuoi VietQR (EMVCo MPM, chuyen nhanh NAPAS toi tai khoan - QRIBFTTA) va ma doi soat.
 * Module thuan (khong phu thuoc Nest/DB) de unit test.
 *
 * GIA DINH (can doi chieu voi dac ta VietQR/NAPAS chinh thuc + quet thu bang >= 3 app ngan hang that truoc khi
 * bat cho quan that, xem GD-06 cua dac ta 01):
 *  - Chi dung cac tag theo dac ta 01 muc 5.1: 00, 01, 38 (00 GUID, 01 {00 BIN, 01 so tai khoan}, 02 QRIBFTTA),
 *    53 = 704, 54 = so tien nguyen, 58 = VN, 62 {08 noi dung}, 63 CRC.
 *  - Khong them tag 52 (MCC), 59 (ten), 60 (thanh pho): nhieu app van doc duoc; neu app nao doi thi bo sung o day.
 *  - Do dai TLV tinh theo so ky tu ASCII (noi dung da chuan hoa khong dau nen 1 ky tu = 1 byte).
 */

/** Bang chu Crockford base32: khong co I, L, O, U */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_RE_SRC = 'IO[0-9A-HJKMNP-TV-Z]{8}';

export function tlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) throw new Error(`Tag không hợp lệ: ${tag}`);
  if (value.length > 99) throw new Error(`Giá trị tag ${tag} quá dài (${value.length} > 99)`);
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC16/CCITT-FALSE: da thuc 0x1021, khoi tao 0xFFFF, khong dao bit; tra 4 ky tu hex HOA */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Ma doi soat: IO + 8 ky tu Crockford base32 ngau nhien (crypto), 10 ky tu, chi chu in hoa va so */
export function generateIntentCode(): string {
  const bytes = randomBytes(8);
  let s = 'IO';
  for (let i = 0; i < 8; i++) s += CROCKFORD[bytes[i] & 31];
  return s;
}

/** Bo dau tieng Viet, in hoa, chi giu chu-so (app ngan hang co the chen/doi chu, bo khoang trang) */
export function normalizeContent(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Moi ung vien ma doi soat (ke ca chong lap) trong noi dung da chuan hoa */
export function extractCodeCandidates(normalized: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`(?=(${CODE_RE_SRC}))`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    out.add(m[1]);
    re.lastIndex = m.index + 1;
  }
  return Array.from(out);
}

export interface VietQrInput {
  /** BIN ngan hang 6 chu so (vi du 970436) */
  bin: string;
  accountNumber: string;
  /** So tien VND nguyen duong */
  amount: number;
  /** Noi dung chuyen khoan (chinh la ma doi soat) */
  content: string;
}

/** Dung chuoi VietQR dong (co so tien) */
export function buildVietQr(i: VietQrInput): string {
  if (!/^\d{6}$/.test(i.bin)) throw new Error('BIN ngân hàng phải gồm 6 chữ số');
  if (!/^[0-9A-Za-z]{1,19}$/.test(i.accountNumber)) throw new Error('Số tài khoản không hợp lệ (tối đa 19 ký tự chữ-số)');
  if (!Number.isInteger(i.amount) || i.amount <= 0) throw new Error('Số tiền phải là số nguyên dương');
  const content = normalizeContent(i.content).slice(0, 25);
  if (!content) throw new Error('Nội dung chuyển khoản trống');

  const member = tlv('00', i.bin) + tlv('01', i.accountNumber);
  const merchant = tlv('00', 'A000000727') + tlv('01', member) + tlv('02', 'QRIBFTTA');
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchant) +
    tlv('53', '704') +
    tlv('54', String(i.amount)) +
    tlv('58', 'VN') +
    tlv('62', tlv('08', content));
  const withCrcTag = body + '6304';
  return withCrcTag + crc16(withCrcTag);
}

/** Tach TLV mot cap (de test/doi chieu) */
export function parseTlv(s: string): { tag: string; value: string }[] {
  const out: { tag: string; value: string }[] = [];
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length) {
      throw new Error('Chuỗi TLV không hợp lệ');
    }
    out.push({ tag, value: s.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

export function verifyCrc(qr: string): boolean {
  if (qr.length < 8 || qr.slice(-8, -4) !== '6304') return false;
  return crc16(qr.slice(0, -4)) === qr.slice(-4);
}
