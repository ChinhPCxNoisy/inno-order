import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Ma hoa AES-256-GCM cho bi mat luu trong DB (khoa API doi tac, bi mat webhook). Khong bao gio tra ra API/log.
 * Khoa: APP_ENCRYPTION_KEY (base64, 32 byte) neu co; khong co thi dan xuat tu JWT_SECRET (SHA-256 voi tien to rieng)
 * de khong phai sua .env - nen dat APP_ENCRYPTION_KEY rieng khi len production.
 */
function key(): Buffer {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (k) {
    const buf = Buffer.from(k, 'base64');
    if (buf.length === 32) return buf;
  }
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('Thiếu APP_ENCRYPTION_KEY hoặc JWT_SECRET để mã hóa bí mật');
  return createHash('sha256').update(`innoorder-secretbox:v1:${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  if (!enc.startsWith('v1:')) throw new Error('Định dạng bí mật không hợp lệ');
  const [iv, tag, ct] = enc.slice(3).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
